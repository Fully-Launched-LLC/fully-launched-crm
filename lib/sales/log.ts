import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExistingLead, ScannedPlace } from "@/lib/lead-finder/types";
import { leadFromScan } from "@/lib/lead-finder/toLead";
import { upsertLeads } from "@/lib/leads/upsert";
import { resolveChannel, type LatestTouch, type Outcome } from "@/lib/sales/outcomes";

// Logging an outcome in Sales (search rows, bulk bar, detail panel).
// A business with no record is saved first through upsert_leads (mode skip,
// source lead_finder, owner = found_by = me), so a business someone else
// saved a moment ago is matched, not duplicated. Then one lead_touches row
// per business, as me; the touch trigger (migration 017) stamps
// last_touch_at and moves leads.status. Runs in the browser, so RLS applies.

export type LogItem = {
  key: string; // caller's id for the row (place id)
  place: ScannedPlace;
  searchType: string | null;
  existing: ExistingLead | null;
};

export type LogResult = {
  saved: { key: string; existing: ExistingLead }[];
  failed: { key: string; reason: string }[];
};

export async function logOutcome(
  supabase: SupabaseClient,
  meId: string,
  items: LogItem[],
  outcome: Outcome,
  note: string,
  sourceDetail: string
): Promise<LogResult> {
  const failed: LogResult["failed"] = [];
  const records = new Map<string, ExistingLead>();
  items.forEach((it) => it.existing && records.set(it.key, it.existing));

  const missing = items.filter((it) => !it.existing);
  if (missing.length) {
    const summary = await upsertLeads(
      supabase,
      missing.map((it) => leadFromScan(it.place, { searchType: it.searchType, sourceDetail, memberId: meId })),
      { mode: "skip" }
    );
    summary.outcomes.forEach((o) => {
      const it = missing[o.index];
      if (!o.leadId) {
        failed.push({ key: it.key, reason: o.reason ?? "Could not save this business." });
        return;
      }
      records.set(it.key, {
        id: o.leadId,
        company: it.place.name,
        status: "new",
        owner: o.result === "inserted" ? meId : null,
        project_id: null,
        next_action: null,
        next_action_at: null,
        last_touch: null,
        matched_on: o.matchedOn ?? "google_place_id",
      });
    });
  }

  const keys = items.map((it) => it.key).filter((k) => records.has(k));
  if (!keys.length) return { saved: [], failed };

  const summary = note.trim() || null;
  const { data, error } = await supabase
    .from("lead_touches")
    .insert(
      keys.map((k) => {
        const rec = records.get(k)!;
        return {
          lead_id: rec.id,
          channel: resolveChannel(outcome, rec.last_touch?.channel),
          direction: outcome.direction,
          outcome: outcome.outcome,
          summary,
          touched_by: meId,
        };
      })
    )
    .select("lead_id, channel, direction, outcome, summary, touched_by, touched_at");
  if (error) {
    keys.forEach((k) => failed.push({ key: k, reason: error.message }));
    return { saved: [], failed };
  }

  const byLead = new Map<string, LatestTouch>();
  (data ?? []).forEach((t) =>
    byLead.set(t.lead_id, {
      channel: t.channel,
      direction: t.direction,
      outcome: t.outcome,
      summary: t.summary,
      touched_by: t.touched_by,
      touched_at: t.touched_at,
    })
  );
  const saved = keys.map((k) => {
    const rec = records.get(k)!;
    return { key: k, existing: { ...rec, last_touch: byLead.get(rec.id) ?? rec.last_touch } };
  });
  return { saved, failed };
}
