import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TeamMember } from "@/lib/types";
import { COST_PER_SEARCH, locationPhrase, searchPages } from "@/lib/lead-finder/sweep";
import { googleTextSearch, type GooglePlace } from "@/lib/lead-finder/google";
import { mapLimit, scanPlace, SCAN_CONCURRENCY } from "@/lib/lead-finder/scanner";
import { findLeadMatches } from "@/lib/leads/upsert";
import { isOutcomeTouch, type LatestTouch } from "@/lib/sales/outcomes";
import { asMode } from "@/lib/sales/searchModes";
import type {
  ExistingLead,
  LeadFinderRun,
  RunProgress,
  RunResult,
  ScannedPlace,
  SearchParams,
} from "@/lib/lead-finder/types";

// Lead Finder runs on Vercel. Matteo's server kept runs in an in-memory
// Map and kept working after replying; a serverless function is frozen after
// its response, so here every run lives in lead_finder_runs /
// lead_finder_results and the browser drives it one step at a time
// (POST /api/lead-finder/runs/[id]/step) until it's done. Refreshing, or
// another team member opening the run, picks up from the database.
//
// One step (route maxDuration 60s):
//   search phase  Google searches until STEP_BUDGET_MS is used up (the next
//                 page of the quick search). done_searches advances by
//                 compare-and-set, so two tabs never run the same batch.
//   scan phase    8 unscanned results at a time (Matteo's concurrency),
//                 again until the budget is used; a hard deadline caps every
//                 website fetch so the step always ends before the timeout.
// A lease (params.lease_until) keeps two steppers off the same run; a step
// that dies leaves a lease that expires on its own.
//
// Quick search only: area sweeps were removed Nov 2026. Old sweep runs stay
// readable (results, labels) but can't be created or stepped.

export const STEP_BUDGET_MS = 20_000; // start no new batch after this
const SCAN_DEADLINE_MS = 48_000; // every fetch in a step ends by this
const LEASE_MS = 58_000;

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function isAdminOrManager(member: TeamMember): boolean {
  return member.role === "Admin" || member.role === "Manager";
}

function canStep(member: TeamMember, run: LeadFinderRun): boolean {
  return isAdminOrManager(member) || run.run_by === member.id;
}

// ---------------------------------------------------------------------------
// Create

export type CreateRunBody =
  | { kind: "search"; mode?: string; state: string; city?: string; zip?: string; type: string; depth?: number; services?: string[] }
  // Area sweeps were removed; the API answers 400.
  | { kind: "sweep" };

export async function createRun(supabase: SupabaseClient, member: TeamMember, body: CreateRunBody): Promise<LeadFinderRun> {
  if (body.kind !== "search") {
    throw new HttpError(400, (body.kind as string) === "sweep" ? "Area sweeps were removed" : "Unknown run type.");
  }
  const state = (body.state || "").trim();
  const city = (body.city || "").trim();
  const zip = (body.zip || "").trim();
  const services = Array.isArray(body.services) ? body.services.map(String) : [];

  const type = (body.type || "").trim();
  if (!state || !type) throw new HttpError(400, "Choose a state and enter a business type to search.");
  const depth = Math.min(60, Math.max(20, Number(body.depth) || 20));
  const pages = searchPages(depth);
  const params: SearchParams = {
    mode: asMode(body.mode),
    state, city, zip, type, depth, services,
    label: `${type} · ${locationPhrase(state, city, zip)}`,
    next_page_token: null,
    lease_until: null,
  };
  const insert = {
    kind: "search",
    params,
    planned_searches: pages,
    est_cost: +(pages * COST_PER_SEARCH).toFixed(2),
    run_by: member.id,
  };

  const { data, error } = await supabase.from("lead_finder_runs").insert(insert).select("*").single();
  if (error) throw new HttpError(error.code === "42501" ? 403 : 500, error.message);
  return data as LeadFinderRun;
}

// ---------------------------------------------------------------------------
// Read

export async function getRun(supabase: SupabaseClient, id: string): Promise<LeadFinderRun> {
  const { data, error } = await supabase.from("lead_finder_runs").select("*").eq("id", id).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, "That run was not found.");
  return data as LeadFinderRun;
}

export async function runProgress(supabase: SupabaseClient, run: LeadFinderRun): Promise<RunProgress> {
  const [found, scanned] = await Promise.all([
    supabase.from("lead_finder_results").select("google_place_id", { count: "exact", head: true }).eq("run_id", run.id),
    supabase
      .from("lead_finder_results")
      .select("google_place_id", { count: "exact", head: true })
      .eq("run_id", run.id)
      .not("scanned_at", "is", null),
  ]);
  return {
    status: run.status,
    done_searches: run.done_searches,
    planned_searches: run.planned_searches,
    found: found.count ?? 0,
    scanned: scanned.count ?? 0,
    error: run.error,
  };
}

// ---------------------------------------------------------------------------
// Step

async function acquireLease(supabase: SupabaseClient, run: LeadFinderRun): Promise<LeadFinderRun | null> {
  const now = new Date();
  const params = { ...run.params, lease_until: new Date(now.getTime() + LEASE_MS).toISOString() };
  const { data, error } = await supabase
    .from("lead_finder_runs")
    .update({ params, status: "running" })
    .eq("id", run.id)
    .in("status", ["queued", "running"])
    // ISO strings (always UTC "Z") compare correctly as text.
    .or(`params->>lease_until.is.null,params->>lease_until.lt."${now.toISOString()}"`)
    .select("*");
  if (error) throw new HttpError(500, error.message);
  return (data?.[0] as LeadFinderRun) ?? null;
}

async function releaseLease(supabase: SupabaseClient, runId: string) {
  const { data } = await supabase.from("lead_finder_runs").select("params").eq("id", runId).single();
  if (!data) return;
  await supabase
    .from("lead_finder_runs")
    .update({ params: { ...(data.params as object), lease_until: null } })
    .eq("id", runId);
}

async function saveFound(supabase: SupabaseClient, runId: string, found: { place: GooglePlace; type: string }[]) {
  const rows = found
    .filter((f) => f.place.businessStatus !== "CLOSED_PERMANENTLY")
    .map((f) => ({ run_id: runId, google_place_id: f.place.id, search_type: f.type, payload: f.place }));
  if (!rows.length) return;
  // First search to find a place keeps it (Matteo's found Map did the same).
  const { error } = await supabase
    .from("lead_finder_results")
    .upsert(rows, { onConflict: "run_id,google_place_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

// Advance done_searches only if nobody else did (compare-and-set).
async function advanceSearches(
  supabase: SupabaseClient,
  run: LeadFinderRun,
  patch: { done_searches: number; planned_searches?: number; params?: unknown }
): Promise<LeadFinderRun | null> {
  const { data, error } = await supabase
    .from("lead_finder_runs")
    .update(patch)
    .eq("id", run.id)
    .eq("done_searches", run.done_searches)
    .select("*");
  if (error) throw new Error(error.message);
  return (data?.[0] as LeadFinderRun) ?? null;
}

async function searchBatch(supabase: SupabaseClient, run: LeadFinderRun): Promise<LeadFinderRun | null> {
  if (run.kind !== "search") throw new Error("Area sweeps were removed");
  const p = run.params as SearchParams;
  const body: Record<string, unknown> = { textQuery: `${p.type} in ${locationPhrase(p.state, p.city, p.zip)}`, pageSize: 20 };
  if (p.next_page_token) body.pageToken = p.next_page_token;
  const page = await googleTextSearch(body);
  await saveFound(supabase, run.id, page.places.map((place) => ({ place, type: p.type })));
  const done = run.done_searches + 1;
  return advanceSearches(supabase, run, {
    done_searches: done,
    // No next page: Google has nothing more, so the search is complete.
    planned_searches: page.nextPageToken ? run.planned_searches : done,
    params: { ...p, next_page_token: page.nextPageToken ?? null },
  });
}

async function scanBatch(supabase: SupabaseClient, run: LeadFinderRun, deadline: number): Promise<number> {
  const { data, error } = await supabase
    .from("lead_finder_results")
    .select("google_place_id, search_type, payload")
    .eq("run_id", run.id)
    .is("scanned_at", null)
    .order("created_at")
    .limit(SCAN_CONCURRENCY);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  await mapLimit(rows, SCAN_CONCURRENCY, async (r) => {
    let payload: unknown;
    try {
      payload = await scanPlace(r.payload as GooglePlace, r.search_type || "", { deadline });
    } catch (e) {
      // Matteo dropped businesses whose scan threw; keep the row, flagged,
      // so it isn't retried forever and doesn't show in results.
      payload = { ...(r.payload as object), scanFailed: (e as Error).message || "Scan failed" };
    }
    await supabase
      .from("lead_finder_results")
      .update({ payload, scanned_at: new Date().toISOString() })
      .eq("run_id", run.id)
      .eq("google_place_id", r.google_place_id);
  });
  return rows.length;
}

async function finish(supabase: SupabaseClient, run: LeadFinderRun) {
  const { count } = await supabase
    .from("lead_finder_results")
    .select("google_place_id", { count: "exact", head: true })
    .eq("run_id", run.id)
    .not("scanned_at", "is", null)
    .is("payload->>scanFailed", null);
  await supabase
    .from("lead_finder_runs")
    .update({ status: "done", result_count: count ?? 0, finished_at: new Date().toISOString() })
    .eq("id", run.id)
    .eq("status", "running");
}

export async function stepRun(
  supabase: SupabaseClient,
  member: TeamMember,
  runId: string
): Promise<{ progress: RunProgress; busy: boolean }> {
  const started = Date.now();
  const initial = await getRun(supabase, runId);
  if (!canStep(member, initial)) throw new HttpError(403, "Only the person who started this run, or an Admin or Manager, can run it.");
  if (!["queued", "running"].includes(initial.status)) {
    return { progress: await runProgress(supabase, initial), busy: false };
  }

  let run = await acquireLease(supabase, initial);
  if (!run) return { progress: await runProgress(supabase, await getRun(supabase, runId)), busy: true };

  try {
    // Search phase.
    while (run.done_searches < run.planned_searches && Date.now() - started < STEP_BUDGET_MS) {
      const next = await searchBatch(supabase, run);
      if (!next) break; // someone else advanced it; stop and let them
      run = next;
    }
    // Scan phase (only once every search is done).
    if (run.done_searches >= run.planned_searches) {
      const deadline = started + SCAN_DEADLINE_MS;
      let scanned = -1;
      while (Date.now() - started < STEP_BUDGET_MS && scanned !== 0) {
        scanned = await scanBatch(supabase, run, deadline);
      }
      if (scanned === 0) await finish(supabase, run);
    }
  } catch (e) {
    await supabase
      .from("lead_finder_runs")
      .update({ status: "failed", error: (e as Error).message || "The run failed.", finished_at: new Date().toISOString() })
      .eq("id", runId);
  } finally {
    await releaseLease(supabase, runId);
  }

  return { progress: await runProgress(supabase, await getRun(supabase, runId)), busy: false };
}

export async function cancelRun(supabase: SupabaseClient, member: TeamMember, runId: string): Promise<LeadFinderRun> {
  const run = await getRun(supabase, runId);
  if (!canStep(member, run)) throw new HttpError(403, "Only the person who started this run, or an Admin or Manager, can cancel it.");
  const { data, error } = await supabase
    .from("lead_finder_runs")
    .update({ status: "cancelled", finished_at: new Date().toISOString() })
    .eq("id", runId)
    .in("status", ["queued", "running"])
    .select("*");
  if (error) throw new HttpError(500, error.message);
  return (data?.[0] as LeadFinderRun) ?? run;
}

// ---------------------------------------------------------------------------
// Results

type ResultRow = { google_place_id: string; search_type: string | null; payload: ScannedPlace & { scanFailed?: string } };

async function scannedResults(supabase: SupabaseClient, runId: string): Promise<ResultRow[]> {
  const rows: ResultRow[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("lead_finder_results")
      .select("google_place_id, search_type, payload")
      .eq("run_id", runId)
      .not("scanned_at", "is", null)
      .order("created_at")
      .range(from, from + page - 1);
    if (error) throw new HttpError(500, error.message);
    const batch = (data ?? []) as ResultRow[];
    rows.push(...batch.filter((r) => !r.payload.scanFailed));
    if (batch.length < page) break;
  }
  return rows;
}

// Every result is checked against existing leads with the database's match
// rule (find_lead_matches, migration 018: place id, cid, email, domain,
// phone, chain rule) so nobody contacts a business twice. Every source is
// attached (lead_finder, personal_network, etsy, manual, ...).
export async function runResults(supabase: SupabaseClient, runId: string): Promise<RunResult[]> {
  const rows = await scannedResults(supabase, runId);
  const found = await findLeadMatches(
    supabase,
    rows.map((r) => {
      const p = r.payload;
      return {
        google_place_id: p.id,
        external_ids: p.cid ? { cid: p.cid } : null,
        email: p.emails?.[0] ?? null,
        website: p.website || null,
        phone: p.phone !== "No phone listed" ? p.phone : null,
      };
    })
  );

  type LeadRow = {
    id: string;
    company: string | null;
    contact_name: string | null;
    title: string | null;
    email: string | null;
    phone: string | null;
    owner_email: string | null;
    owner_phone: string | null;
    contact_linkedin: string | null;
    company_linkedin: string | null;
    status: string;
    owner: string | null;
    source: string | null;
    project_id: string | null;
    next_action: string | null;
    next_action_at: string | null;
  };
  const ids = Array.from(new Set(found.filter(Boolean).map((m) => m!.leadId)));
  const byId = new Map<string, LeadRow>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase
      .from("leads")
      .select("id, company, contact_name, title, email, phone, owner_email, owner_phone, contact_linkedin, company_linkedin, status, owner, source, project_id, next_action, next_action_at")
      .in("id", ids.slice(i, i + 100));
    if (error) throw new HttpError(500, error.message);
    (data ?? []).forEach((l) => byId.set(l.id, l as LeadRow));
  }
  const matches = found.map((m) => (m && byId.has(m.leadId) ? { row: byId.get(m.leadId)!, on: m.matchedOn } : null));

  // Latest touch (outcome, who, when, note) for the matched businesses.
  const leadIds = Array.from(new Set(matches.filter(Boolean).map((m) => m!.row.id)));
  const latest = new Map<string, LatestTouch>();
  for (let i = 0; i < leadIds.length; i += 100) {
    const { data } = await supabase
      .from("lead_touches")
      .select("lead_id, channel, direction, outcome, summary, touched_by, touched_at, details, event")
      .in("lead_id", leadIds.slice(i, i + 100))
      .order("touched_at", { ascending: false });
    (data ?? []).forEach((t) => {
      if (!latest.has(t.lead_id) && isOutcomeTouch(t)) {
        latest.set(t.lead_id, {
          channel: t.channel,
          direction: t.direction,
          outcome: t.outcome,
          summary: t.summary,
          touched_by: t.touched_by,
          touched_at: t.touched_at,
          details: t.details ?? null,
          event: t.event ?? null,
        });
      }
    });
  }

  return rows.map((r, i) => {
    const m = matches[i];
    const existing: ExistingLead | null = m
      ? {
          id: m.row.id,
          company: m.row.company,
          contact_name: m.row.contact_name,
          title: m.row.title,
          email: m.row.email,
          phone: m.row.phone,
          owner_email: m.row.owner_email,
          owner_phone: m.row.owner_phone,
          contact_linkedin: m.row.contact_linkedin,
          company_linkedin: m.row.company_linkedin,
          status: m.row.status,
          owner: m.row.owner,
          project_id: m.row.project_id,
          next_action: m.row.next_action,
          next_action_at: m.row.next_action_at,
          last_touch: latest.get(m.row.id) ?? null,
          matched_on: m.on,
        }
      : null;
    return { google_place_id: r.google_place_id, search_type: r.search_type, place: r.payload, existing };
  });
}
