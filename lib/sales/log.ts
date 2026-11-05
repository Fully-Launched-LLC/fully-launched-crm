import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExistingLead, ScannedPlace } from "@/lib/lead-finder/types";
import { leadFromScan } from "@/lib/lead-finder/toLead";
import { upsertLeads } from "@/lib/leads/upsert";
import { resolveChannel, type LatestTouch, type Outcome, type TouchDetails } from "@/lib/sales/outcomes";

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
          email: it.place.emails[0] ?? null,
          phone: it.place.phone && it.place.phone !== "No phone listed" ? it.place.phone : null,
          contact_linkedin: null,
          company_linkedin: it.place.socialLinks?.LinkedIn ?? null,
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
    // Company LinkedIn from the website scan: upsert_lead doesn't know the
    // 021 columns, so new records get it through update_business_contact.
    await Promise.all(
      Array.from(records.values())
        .filter((r) => r.created && r.existing.company_linkedin)
        .map((r) =>
          supabase.rpc("update_business_contact", { p_lead_id: r.existing.id, p_fields: { company_linkedin: r.existing.company_linkedin } })
        )
    );
  }
  return { records, failed };
}

export async function logOutcome(
  supabase: SupabaseClient,
  meId: string,
  items: LogItem[],
  outcome: Outcome,
  sourceDetail: string,
  // Not available form / Mark as sent: the note and structured details
  // (migration 023), same for every item.
  extra?: { summary?: string | null; details?: TouchDetails | null }
): Promise<LogResult> {
  const { records, failed } = await ensureRecords(supabase, meId, items, sourceDetail);
  const keys = items.map((x) => x.key).filter((k) => records.has(k));
  const it = (k: string) => items.find((x) => x.key === k);
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
          summary: extra?.summary?.trim() || null,
          details:
            outcome.key === "emailed" && !extra?.details
              ? rec.email || it(k)?.place.emails[0]
                ? { to: rec.email || it(k)!.place.emails[0] }
                : null
              : extra?.details ?? null,
        };
      })
    )
    .select("id, lead_id, channel, direction, outcome, summary, touched_by, touched_at, details");
  if (error) {
    keys.forEach((k) => failed.push({ key: k, reason: error.message }));
    return { saved: [], failed };
  }

  const byLead = new Map<string, LatestTouch & { id: string }>();
  ((data ?? []) as unknown as (LatestTouch & { id: string; lead_id: string })[]).forEach((t) => byLead.set(t.lead_id, t));
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

// Contact info edit (side preview, audit page): the person at the business
// (contact_name, title, email, phone). Any team member, whoever the record is
// assigned to: update_business_contact (migration 020, SECURITY DEFINER,
// only those four columns). Saves the business first if it has no record.
// If the record was deleted meanwhile (a stale page), it is saved again from
// the scan and the edit retried once.
export type ContactFields = {
  contact_name?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  contact_linkedin?: string | null;
  company_linkedin?: string | null;
};

export async function saveBusinessContact(
  supabase: SupabaseClient,
  meId: string,
  item: LogItem,
  fields: ContactFields,
  sourceDetail: string
): Promise<{ existing: ExistingLead | null; error: string | null }> {
  const clean: ContactFields = {};
  (Object.keys(fields) as (keyof ContactFields)[]).forEach((k) => {
    const v = (fields[k] ?? "").trim() || null;
    // LinkedIn links pasted without the scheme.
    clean[k] = v && (k === "contact_linkedin" || k === "company_linkedin") && !/^https?:\/\//i.test(v) ? "https://" + v : v;
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    const { records, failed } = await ensureRecords(
      supabase,
      meId,
      [{ ...item, existing: attempt ? null : item.existing }],
      sourceDetail
    );
    if (failed.length) return { existing: null, error: failed[0].reason };
    const rec = records.get(item.key)!.existing;
    const { data, error } = await supabase.rpc("update_business_contact", { p_lead_id: rec.id, p_fields: clean });
    if (error?.code === "P0002" && attempt === 0) continue; // record gone: save it again, retry
    if (error) return { existing: rec, error: error.message };
    const d = data as Pick<ExistingLead, "contact_name" | "title" | "email" | "phone" | "contact_linkedin" | "company_linkedin">;
    return {
      existing: {
        ...rec,
        contact_name: d.contact_name,
        title: d.title,
        email: d.email,
        phone: d.phone,
        contact_linkedin: d.contact_linkedin,
        company_linkedin: d.company_linkedin,
      },
      error: null,
    };
  }
  return { existing: null, error: "This business record no longer exists." };
}

// A leads update that came back with no rows: either RLS refused it, or the
// record is gone (e.g. deleted while this page was open). Admin/Manager pass
// every RLS check, so for them it's always the latter.
export async function zeroRowsReason(supabase: SupabaseClient, leadId: string): Promise<string> {
  const { data } = await supabase.from("leads").select("id").eq("id", leadId).maybeSingle();
  return data
    ? "Not saved. Only the team member it's assigned to (or an Admin/Manager) can change this."
    : "Not saved: this business record no longer exists (it was deleted). Reload the page.";
}

// Next action on a record (Not now's "Revisit" date, Dead clears it). A leads
// update, so the 017 RLS rule applies; returns an error message or null.
export async function setNextAction(
  supabase: SupabaseClient,
  leadId: string,
  next_action: string | null,
  next_action_at: string | null
): Promise<string | null> {
  const { data, error } = await supabase.from("leads").update({ next_action, next_action_at }).eq("id", leadId).select("id");
  if (error) return error.message;
  if (!data?.length) return zeroRowsReason(supabase, leadId);
  return null;
}

// 9:00 local, `months` from today.
export function monthsFromNow(months: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  d.setHours(9, 0, 0, 0);
  return d;
}
