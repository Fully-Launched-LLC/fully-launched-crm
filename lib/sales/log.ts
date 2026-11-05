import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExistingLead, ScannedPlace } from "@/lib/lead-finder/types";
import { leadFromScan } from "@/lib/lead-finder/toLead";
import { upsertLeads } from "@/lib/leads/upsert";
import { resolveChannel, type LatestTouch, type Outcome } from "@/lib/sales/outcomes";

// Writes from Sales (search rows, bulk bar, detail panel, audit page). Runs
// in the browser, so RLS applies.
//   ensureRecords: a business with no record is saved through upsert_leads
//     (mode skip, source lead_finder, owner = found_by = me), so a business a
//     teammate saved a second ago is matched, not duplicated.
//   logOutcome: ensureRecords, then one lead_touches row per business, as
//     me, saved on the first click. The touch trigger (migration 017) stamps
//     last_touch_at and moves leads.status.
//   undoOutcome / noteOutcome: the toast's Undo (within 10 seconds) and
//     Add note.

export type LogItem = {
  key: string; // caller's id for the row (place id)
  place: ScannedPlace;
  searchType: string | null;
  existing: ExistingLead | null;
};

export type SavedOutcome = {
  key: string;
  existing: ExistingLead; // after the touch
  prev: ExistingLead | null; // before (null: the record was created by this save)
  touchId: string;
};

export type LogResult = { saved: SavedOutcome[]; failed: { key: string; reason: string }[] };

export async function ensureRecords(
  supabase: SupabaseClient,
  meId: string,
  items: LogItem[],
  sourceDetail: string
): Promise<{ records: Map<string, { existing: ExistingLead; created: boolean }>; failed: LogResult["failed"] }> {
  const failed: LogResult["failed"] = [];
  const records = new Map<string, { existing: ExistingLead; created: boolean }>();
  items.forEach((it) => it.existing && records.set(it.key, { existing: it.existing, created: false }));

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
        created: o.result === "inserted",
        existing: {
          id: o.leadId,
          company: it.place.name,
          contact_name: it.place.ownerName,
          title: it.place.ownerName ? "Possible owner" : null,
          status: "new",
          owner: o.result === "inserted" ? meId : null,
          project_id: null,
          next_action: null,
          next_action_at: null,
          last_touch: null,
          matched_on: o.matchedOn ?? "google_place_id",
        },
      });
    });
  }
  return { records, failed };
}

export async function logOutcome(
  supabase: SupabaseClient,
  meId: string,
  items: LogItem[],
  outcome: Outcome,
  sourceDetail: string
): Promise<LogResult> {
  const { records, failed } = await ensureRecords(supabase, meId, items, sourceDetail);
  const keys = items.map((it) => it.key).filter((k) => records.has(k));
  if (!keys.length) return { saved: [], failed };

  const { data, error } = await supabase
    .from("lead_touches")
    .insert(
      keys.map((k) => {
        const rec = records.get(k)!.existing;
        return {
          lead_id: rec.id,
          channel: resolveChannel(outcome, rec.last_touch?.channel),
          direction: outcome.direction,
          outcome: outcome.outcome,
          touched_by: meId,
        };
      })
    )
    .select("id, lead_id, channel, direction, outcome, summary, touched_by, touched_at");
  if (error) {
    keys.forEach((k) => failed.push({ key: k, reason: error.message }));
    return { saved: [], failed };
  }

  const byLead = new Map<string, LatestTouch & { id: string }>();
  (data ?? []).forEach((t) => byLead.set(t.lead_id, t as LatestTouch & { id: string }));
  const saved: SavedOutcome[] = [];
  keys.forEach((k) => {
    const { existing: rec, created } = records.get(k)!;
    const t = byLead.get(rec.id);
    if (!t) return failed.push({ key: k, reason: "Not saved." });
    const { id, ...touch } = t;
    saved.push({
      key: k,
      prev: created ? null : rec,
      touchId: id,
      existing: { ...rec, status: statusAfter(rec.status, outcome), last_touch: touch },
    });
  });
  return { saved, failed };
}

// What the touch trigger does to leads.status, close enough for display
// until the next reload.
function statusAfter(status: string, o: Outcome): string {
  if (status === "converted") return status;
  if (o.outcome === "not_interested" || o.outcome === "bad_fit") return "not_interested";
  if (o.outcome === "interested" || o.outcome === "meeting_booked") return "interested";
  return status === "new" ? "contacted" : status;
}

// Undo: delete the touches, then put each record back. A record this save
// created is deleted: RLS allows it for its creator within 10 minutes once
// it has no touches (migration 019), and for Admins. If that's refused
// (e.g. a teammate touched it meanwhile) it stays, reset to New. Returns the state each key should go back to (null:
// no record any more).
export async function undoOutcome(
  supabase: SupabaseClient,
  saved: SavedOutcome[]
): Promise<{ restored: { key: string; existing: ExistingLead | null }[]; error: string | null }> {
  const ids = saved.map((s) => s.touchId);
  const { data, error } = await supabase.from("lead_touches").delete().in("id", ids).select("id");
  if (error) return { restored: [], error: error.message };
  if ((data ?? []).length < ids.length) return { restored: [], error: "Could not undo: the touch was already changed." };

  const restored: { key: string; existing: ExistingLead | null }[] = [];
  const created = saved.filter((s) => !s.prev);
  let deleted = new Set<string>();
  if (created.length) {
    const { data: gone } = await supabase.from("leads").delete().in("id", created.map((s) => s.existing.id)).select("id");
    deleted = new Set((gone ?? []).map((g) => g.id as string));
  }
  for (const s of saved) {
    if (!s.prev && deleted.has(s.existing.id)) {
      restored.push({ key: s.key, existing: null });
      continue;
    }
    const back: ExistingLead = s.prev ?? { ...s.existing, status: "new", last_touch: null };
    await supabase
      .from("leads")
      .update({ status: back.status, last_touch_at: back.last_touch?.touched_at ?? null })
      .eq("id", back.id);
    restored.push({ key: s.key, existing: back });
  }
  return { restored, error: null };
}

export async function noteOutcome(supabase: SupabaseClient, saved: SavedOutcome[], note: string): Promise<string | null> {
  const ids = saved.map((s) => s.touchId);
  const { data, error } = await supabase.from("lead_touches").update({ summary: note.trim() || null }).in("id", ids).select("id");
  if (error) return error.message;
  if ((data ?? []).length < ids.length) return "The note wasn't saved on every touch.";
  return null;
}

// Owner name edit (detail panel, audit page): saves the business first if
// it has no record, then writes contact_name. RLS: owner, unowned, or
// Admin/Manager; a blocked update returns no rows.
export async function saveOwnerName(
  supabase: SupabaseClient,
  meId: string,
  item: LogItem,
  name: string,
  sourceDetail: string
): Promise<{ existing: ExistingLead | null; error: string | null }> {
  const clean = name.trim() || null;
  const { records, failed } = await ensureRecords(
    supabase,
    meId,
    [{ ...item, place: { ...item.place, ownerName: clean } }],
    sourceDetail
  );
  if (failed.length) return { existing: null, error: failed[0].reason };
  const rec = records.get(item.key)!.existing;
  const { data, error } = await supabase
    .from("leads")
    .update({ contact_name: clean, title: clean ? "Owner" : null })
    .eq("id", rec.id)
    .select("id");
  if (error) return { existing: rec, error: error.message };
  if (!data?.length) return { existing: rec, error: "Not saved. Only the business's owner or an Admin/Manager can change it." };
  return { existing: { ...rec, contact_name: clean, title: clean ? "Owner" : null }, error: null };
}
