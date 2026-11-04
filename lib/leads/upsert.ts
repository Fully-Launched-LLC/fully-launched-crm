import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lead } from "@/lib/types";
import {
  LeadIndex,
  normalizeDomain,
  normalizeEmail,
  phoneDigits,
  type LeadKeys,
  type MatchKey,
} from "@/lib/leads/match";

// The one shared upsert for leads: Lead Finder adds, CSV import and manual
// adds all go through upsertLeads(). Runs with the caller's session, so RLS
// applies (a Salesperson can't merge into a lead someone else owns; that row
// comes back "skipped").
//
// Matching: lib/leads/match.ts (place id, cid, email, domain, phone; the soft
// keys never join two different locations).
//   mode "skip":  a match is reported and left alone (Lead Finder adds:
//                 nobody re-adds or re-contacts an existing lead).
//   mode "merge": fill empty fields only, union branch_fit, merge
//                 external_ids (existing keys win). Never touches status,
//                 owner, found_by or project_id.

export type LeadInput = Partial<
  Omit<Lead, "id" | "created_at" | "updated_at" | "name" | "phone_digits" | "domain" | "last_touch_at">
> & { company: string; domain?: string | null };

export type UpsertOutcome = {
  index: number;
  result: "inserted" | "merged" | "skipped";
  leadId: string | null;
  matchedOn?: MatchKey;
  reason?: string;
};

export type UpsertSummary = {
  inserted: number;
  merged: number;
  skipped: number;
  outcomes: UpsertOutcome[];
};

// Columns loaded for matching and merging. audit is left out (it can hold a
// base64 screenshot).
const INDEX_COLUMNS =
  "id, company, status, owner, last_touch_at, google_place_id, external_ids, email, domain, phone_digits, " +
  "contact_name, title, phone, website, address, city, state, industry, category, branch_fit, source, source_detail, " +
  "maps_url, rating, review_count, website_status, scan_tags, lead_score, priority_score, uses_servicetitan, notes, " +
  "next_action, next_action_at";

export type IndexedLead = LeadKeys & {
  id: string;
  company: string | null;
  status: string;
  owner: string | null;
  last_touch_at: string | null;
  external_ids: Record<string, string>;
  [field: string]: unknown;
};

export function keysOf(input: {
  google_place_id?: string | null;
  external_ids?: Record<string, string> | null;
  email?: string | null;
  domain?: string | null;
  website?: string | null;
  phone?: string | null;
}): LeadKeys {
  return {
    google_place_id: input.google_place_id || null,
    cid: input.external_ids?.cid || null,
    email: normalizeEmail(input.email),
    domain: normalizeDomain(input.domain || input.website),
    phone_digits: phoneDigits(input.phone),
  };
}

export async function loadLeadIndex(supabase: SupabaseClient): Promise<LeadIndex<IndexedLead>> {
  const rows: IndexedLead[] = [];
  const page = 1000; // PostgREST's default max rows
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("leads")
      .select(INDEX_COLUMNS)
      .order("created_at")
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as unknown as IndexedLead[];
    batch.forEach((r) => rows.push({ ...r, cid: r.external_ids?.cid ?? null }));
    if (batch.length < page) break;
  }
  return new LeadIndex(rows);
}

const MERGE_SKIP = new Set(["status", "owner", "found_by", "project_id", "branch_fit", "external_ids", "company", "google_place_id"]);

function isEmpty(v: unknown): boolean {
  return (
    v === null ||
    v === undefined ||
    (typeof v === "string" && v.trim() === "") ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0)
  );
}

// Fields to write onto `existing` so it gains what `incoming` knows.
export function mergePatch(existing: Record<string, unknown>, incoming: LeadInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(incoming)) {
    if (MERGE_SKIP.has(field) || isEmpty(value)) continue;
    if (isEmpty(existing[field])) patch[field] = value;
  }
  if (!existing.google_place_id && incoming.google_place_id) patch.google_place_id = incoming.google_place_id;
  const fit = new Set([...((existing.branch_fit as string[]) ?? []), ...(incoming.branch_fit ?? [])]);
  if (fit.size !== ((existing.branch_fit as string[]) ?? []).length) patch.branch_fit = Array.from(fit);
  const ids = { ...(incoming.external_ids ?? {}), ...((existing.external_ids as Record<string, string>) ?? {}) };
  if (Object.keys(ids).length !== Object.keys((existing.external_ids as object) ?? {}).length) patch.external_ids = ids;
  return patch;
}

export async function upsertLeads(
  supabase: SupabaseClient,
  incoming: LeadInput[],
  opts: { mode: "merge" | "skip"; index?: LeadIndex<IndexedLead> }
): Promise<UpsertSummary> {
  const index = opts.index ?? (await loadLeadIndex(supabase));
  const outcomes: UpsertOutcome[] = [];
  // New rows from this batch, indexed too so duplicates inside one batch
  // (two CSV rows for the same business) collapse into one insert.
  const pending: { row: LeadInput; keys: LeadKeys; indexes: number[] }[] = [];
  const pendingIndex = new LeadIndex<LeadKeys & { id: string }>();
  const merges = new Map<string, { patch: Record<string, unknown>; indexes: number[]; on: MatchKey }>();

  incoming.forEach((row, i) => {
    const keys = keysOf(row);
    const hit = index.find(keys);
    if (hit) {
      if (opts.mode === "skip") {
        outcomes.push({ index: i, result: "skipped", leadId: hit.row.id, matchedOn: hit.on, reason: "Already a lead" });
        return;
      }
      const prior = merges.get(hit.row.id);
      const base = { ...hit.row, ...(prior?.patch ?? {}) };
      const patch = { ...(prior?.patch ?? {}), ...mergePatch(base, row) };
      merges.set(hit.row.id, { patch, indexes: [...(prior?.indexes ?? []), i], on: hit.on });
      return;
    }
    const dup = pendingIndex.find(keys);
    if (dup) {
      const p = pending[Number(dup.row.id)];
      if (opts.mode === "skip") {
        outcomes.push({ index: i, result: "skipped", leadId: null, matchedOn: dup.on, reason: "Duplicate in this batch" });
        return;
      }
      Object.assign(p.row, mergePatch(p.row as Record<string, unknown>, row));
      p.indexes.push(i);
      return;
    }
    pendingIndex.add({ ...keys, id: String(pending.length) });
    pending.push({ row: { ...row }, keys, indexes: [i] });
  });

  // Merges: one update per existing lead. Zero rows back means RLS blocked
  // it (a Salesperson and a lead someone else owns).
  for (const [leadId, m] of Array.from(merges.entries())) {
    if (Object.keys(m.patch).length === 0) {
      m.indexes.forEach((i) => outcomes.push({ index: i, result: "merged", leadId, matchedOn: m.on, reason: "Nothing new to add" }));
      continue;
    }
    const { data, error } = await supabase.from("leads").update(m.patch).eq("id", leadId).select("id");
    const ok = !error && (data?.length ?? 0) > 0;
    m.indexes.forEach((i) =>
      outcomes.push(
        ok
          ? { index: i, result: "merged", leadId, matchedOn: m.on }
          : { index: i, result: "skipped", leadId, matchedOn: m.on, reason: error?.message ?? "Owned by someone else" }
      )
    );
  }

  // Inserts: one batch; if it fails (a unique place id/cid that appeared
  // since the index was loaded), fall back to one at a time.
  if (pending.length) {
    const rows = pending.map((p) => p.row);
    const { data, error } = await supabase.from("leads").insert(rows).select("id");
    if (!error && data && data.length === rows.length) {
      pending.forEach((p, n) =>
        p.indexes.forEach((i, k) =>
          outcomes.push({ index: i, result: k === 0 ? "inserted" : "merged", leadId: data[n].id })
        )
      );
    } else {
      for (const p of pending) {
        const one = await supabase.from("leads").insert(p.row).select("id").single();
        p.indexes.forEach((i, k) =>
          outcomes.push(
            one.error
              ? {
                  index: i,
                  result: "skipped",
                  leadId: null,
                  reason: one.error.code === "23505" ? "Already a lead (added by someone just now)" : one.error.message,
                }
              : { index: i, result: k === 0 ? "inserted" : "merged", leadId: one.data.id }
          )
        );
      }
    }
  }

  outcomes.sort((a, b) => a.index - b.index);
  return {
    inserted: outcomes.filter((o) => o.result === "inserted").length,
    merged: outcomes.filter((o) => o.result === "merged").length,
    skipped: outcomes.filter((o) => o.result === "skipped").length,
    outcomes,
  };
}
