import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lead } from "@/lib/types";

// The one shared lead upsert, now a thin wrapper over the database
// functions from migration 018 (public.upsert_lead / upsert_leads /
// find_lead_matches). Matching lives only in the database:
//   order google_place_id, cid, email, domain, phone_digits; email/domain/
//   phone never join two records that both carry a different place id or
//   cid (chain locations); the oldest lead wins among soft-key candidates.
//   mode "skip":  a match is reported and left alone (Lead Finder adds,
//                 manual adds).
//   mode "merge": fill empty fields only, union branch_fit, merge
//                 external_ids (existing keys win). Never touches status,
//                 owner, found_by, project_id or company (CSV imports).
// Runs with whatever client it's given (server or browser), so RLS applies
// as the signed-in user. Outside sources (Apify, GrokBot, Claude research)
// can call the same RPCs directly.

export type MatchKey = "google_place_id" | "cid" | "email" | "domain" | "phone";

export type LeadInput = Partial<
  Omit<Lead, "id" | "created_at" | "updated_at" | "name" | "phone_digits" | "last_touch_at" | "project_id">
> & { company: string };

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

type RpcResult = {
  index?: number;
  lead_id: string | null;
  action: "inserted" | "merged" | "skipped";
  matched_on: MatchKey | null;
  reason: string | null;
};

const BATCH = 200; // upsert_leads takes up to 500; smaller keeps each call well under the statement timeout

function toOutcome(r: RpcResult, index: number): UpsertOutcome {
  return {
    index,
    result: r.action,
    leadId: r.lead_id,
    matchedOn: r.matched_on ?? undefined,
    reason: r.reason ?? undefined,
  };
}

export async function upsertLead(
  supabase: SupabaseClient,
  lead: LeadInput,
  mode: "merge" | "skip"
): Promise<UpsertOutcome> {
  const { data, error } = await supabase.rpc("upsert_lead", { p: { mode, lead } });
  if (error) throw new Error(error.message);
  return toOutcome(data as RpcResult, 0);
}

export async function upsertLeads(
  supabase: SupabaseClient,
  leads: LeadInput[],
  opts: { mode: "merge" | "skip"; onProgress?: (done: number, total: number) => void }
): Promise<UpsertSummary> {
  const outcomes: UpsertOutcome[] = [];
  for (let from = 0; from < leads.length; from += BATCH) {
    const chunk = leads.slice(from, from + BATCH);
    const { data, error } = await supabase.rpc("upsert_leads", { p: { mode: opts.mode, leads: chunk } });
    if (error) throw new Error(error.message);
    const res = data as { results: RpcResult[] };
    res.results.forEach((r) => outcomes.push(toOutcome(r, from + (r.index ?? 0))));
    opts.onProgress?.(Math.min(leads.length, from + BATCH), leads.length);
  }
  return {
    inserted: outcomes.filter((o) => o.result === "inserted").length,
    merged: outcomes.filter((o) => o.result === "merged").length,
    skipped: outcomes.filter((o) => o.result === "skipped").length,
    outcomes,
  };
}

// Which of these lead-shaped objects are already leads (read-only).
// Same rule as the upsert. Returns one entry per input, in order.
export type LeadKeysInput = {
  google_place_id?: string | null;
  external_ids?: Record<string, string> | null;
  email?: string | null;
  domain?: string | null;
  website?: string | null;
  phone?: string | null;
};

export async function findLeadMatches(
  supabase: SupabaseClient,
  inputs: LeadKeysInput[]
): Promise<({ leadId: string; matchedOn: MatchKey } | null)[]> {
  const out: ({ leadId: string; matchedOn: MatchKey } | null)[] = [];
  for (let from = 0; from < inputs.length; from += 300) {
    const { data, error } = await supabase.rpc("find_lead_matches", { p: inputs.slice(from, from + 300) });
    if (error) throw new Error(error.message);
    (data as { lead_id: string | null; matched_on: MatchKey | null }[]).forEach((m) =>
      out.push(m.lead_id ? { leadId: m.lead_id, matchedOn: m.matched_on! } : null)
    );
  }
  return out;
}
