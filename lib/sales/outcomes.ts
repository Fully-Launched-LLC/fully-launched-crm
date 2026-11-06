import type { Branch } from "@/lib/theme";
import { TOUCH_CHANNEL_LABELS, TOUCH_OUTCOME_LABELS } from "@/lib/leads/labels";

// Sales (/sales): which leads rows count as Sales businesses, and the
// one-click outcomes. No schema of its own: a business is a leads row, an
// outcome is a lead_touches row (migration 017 channels/outcomes).

// Every leads row shows in Leads (search matches and History), whatever its
// source (lead_finder, personal_network, etsy, manual, referral, ...).

export type OutcomeKey =
  | "no_answer"
  | "left_voicemail"
  | "not_available"
  | "visited"
  | "interested"
  | "not_interested"
  | "not_now"
  | "dead"
  | "booked_call"
  | "not_now_email"
  | "emailed"
  | "connection_sent"
  | "connected"
  | "messaged";

export type OutcomeGroup = "call" | "email" | "linkedin";
export const OUTCOME_GROUPS: [OutcomeGroup, string][] = [
  ["call", "Call result"],
  ["email", "Email"],
  ["linkedin", "LinkedIn"],
];

// How a touch reads in rows, History and timelines. Includes outcomes the
// buttons no longer log (Called (talked), Visited, Bad fit) so older
// touches still show correctly.
// staff_no: Not interested said by front desk / staff (details.said_no_by).
export type DisplayKey = Exclude<OutcomeKey, "not_now_email"> | "staff_no" | "talked" | "bad_fit" | "meeting" | "other";

export type Outcome = {
  key: OutcomeKey;
  label: string;
  group: OutcomeGroup;
  // "last": the business's most recent touch channel (an answer comes back
  // on the channel we used), else cold_call.
  channel: string | "last";
  direction: "outbound" | "inbound";
  outcome: string | null;
  // Opens Move to Interested after saving (when the user may edit).
  opensMove?: boolean;
  // Opens a small form before saving; not offered in the bulk bar.
  //   not_available: who we spoke with, role, what they said, email
  //   who_said_no:   Owner / decision maker, or Front desk / staff
  //   revisit:       revisit date (1, 3, 6 months, pick a date)
  //   dead:          reason
  //   talked_to:     who did you talk to (Owner / Staff -> details.talked_to)
  form?: "not_available" | "who_said_no" | "revisit" | "dead" | "talked_to";
  // The toast offers a follow-up (next_action "Follow up: call" / "email" / "LinkedIn").
  followUp?: "call" | "email" | "linkedin";
  // Side preview: opens the Draft email modal instead of saving; its "Mark
  // as sent" logs it. (The bulk bar logs it directly.)
  opensDraft?: boolean;
  // After saving, ask for the business owner's LinkedIn profile if empty.
  asksLinkedin?: boolean;
};

// Migrations 023/024. Only Interested and Booked call open Move to Interested.
export const OUTCOMES: Outcome[] = [
  // CALL RESULT
  { key: "no_answer", label: "No answer", group: "call", channel: "cold_call", direction: "outbound", outcome: "no_answer", followUp: "call" },
  { key: "left_voicemail", label: "Left voicemail", group: "call", channel: "voicemail", direction: "outbound", outcome: null, followUp: "call" },
  // Reached someone, not the decision maker. details {spoke_with, role, email}; the note is what they said.
  { key: "not_available", label: "Not available", group: "call", channel: "cold_call", direction: "outbound", outcome: "not_available", form: "not_available", followUp: "call" },
  { key: "visited", label: "Visited", group: "call", channel: "in_person", direction: "outbound", outcome: "sent", followUp: "call" },
  { key: "interested", label: "Interested", group: "call", channel: "cold_call", direction: "inbound", outcome: "interested", opensMove: true, form: "talked_to" },
  // details.said_no_by owner | staff (required). Staff + owner not reached -> Reach the owner.
  { key: "not_interested", label: "Not interested", group: "call", channel: "cold_call", direction: "inbound", outcome: "not_interested", form: "who_said_no" },
  // Migration 029. Revisit date -> next_action "Revisit" + next_action_at.
  { key: "not_now", label: "Not now", group: "call", channel: "cold_call", direction: "inbound", outcome: "not_now", form: "revisit" },
  // Migration 029. details.dead_reason; excluded from every other History section.
  { key: "dead", label: "Dead", group: "call", channel: "cold_call", direction: "outbound", outcome: "dead", form: "dead" },
  // meeting_booked: the touch trigger sets status interested.
  { key: "booked_call", label: "Booked call", group: "call", channel: "cold_call", direction: "outbound", outcome: "meeting_booked", opensMove: true },
  // EMAIL. details {to}.
  { key: "emailed", label: "Emailed", group: "email", channel: "email", direction: "outbound", outcome: "sent", opensDraft: true, followUp: "email" },
  { key: "not_now_email", label: "Not now", group: "email", channel: "email", direction: "inbound", outcome: "not_now", form: "revisit" },
  // LINKEDIN
  { key: "connection_sent", label: "Connection sent", group: "linkedin", channel: "linkedin_connect", direction: "outbound", outcome: "sent", asksLinkedin: true, followUp: "linkedin" },
  { key: "connected", label: "Connected", group: "linkedin", channel: "linkedin_connect", direction: "outbound", outcome: "connected", asksLinkedin: true },
  { key: "messaged", label: "Messaged", group: "linkedin", channel: "linkedin_dm", direction: "outbound", outcome: "sent", asksLinkedin: true, followUp: "linkedin" },
];

export const outcomeByKey = (k: OutcomeKey) => OUTCOMES.find((o) => o.key === k)!;

// "Stopped" businesses: shown strongly dimmed in results, and logging on
// them asks to confirm first (with clients, i.e. moved to Interested).
// bad_fit: older touches only. Dead is dimmed most and sorted last.
export const STOP_OUTCOMES: DisplayKey[] = ["not_interested", "bad_fit", "dead"];

export const DEAD_REASONS = ["Wrong number", "Closed", "Bounced email", "Not a real business", "Other"];

export function resolveChannel(o: Outcome, lastChannel: string | null | undefined): string {
  return o.channel === "last" ? lastChannel || "cold_call" : o.channel;
}

// The latest touch on a business, as shown inline and in History.
export type LatestTouch = {
  channel: string;
  direction: string;
  outcome: string | null;
  summary: string | null;
  touched_by: string | null;
  touched_at: string;
  // Migration 023: Not available {spoke_with, role, email}, Emailed {to}.
  details?: TouchDetails | null;
  // Migration 030: timeline entries that aren't outreach (note, reassigned,
  // released, removed_from_pipeline, project_lost). Null for real touches.
  event?: string | null;
};

// Does this touch count as the business's latest outcome? Notes,
// reassignments and releases don't; Removed from pipeline / Project lost do
// when they carry an outcome (not_now / not_interested).
export function isOutcomeTouch(t: Pick<LatestTouch, "event" | "outcome">): boolean {
  return !t.event || !!t.outcome;
}

export type TouchDetails = {
  spoke_with?: string;
  role?: string;
  email?: string;
  to?: string | null; // Emailed: address; reassigned: new owner id
  said_no_by?: "owner" | "staff"; // Not interested
  talked_to?: "owner" | "staff"; // Interested / older call outcomes
  dead_reason?: string; // Dead
  // Migration 030/033 events
  reason?: string; // removed_from_pipeline
  note?: string | null;
  project_name?: string;
  branch?: string | null;
  revisit?: string | null;
  from?: string | null; // reassigned / released: previous owner id
  from_project?: string;
};

// A touch back to the outcome that logged it (also reads touches logged
// before these buttons: Called (talked), Bad fit, voicemail, replied, ...).
export function classifyTouch(t: Pick<LatestTouch, "channel" | "outcome"> & { details?: TouchDetails | null }): { key: DisplayKey; label: string } {
  const o = t.outcome;
  if (o === "dead") return { key: "dead", label: "Dead" };
  if (o === "not_now") return { key: "not_now", label: "Not now" };
  if (o === "not_interested" && t.details?.said_no_by === "staff") return { key: "staff_no", label: "Not interested (front desk)" };
  if (o === "meeting_booked") return { key: "booked_call", label: "Booked call" };
  // Meetings logged from Granola (migration 022): channel meeting, meeting_held.
  if (o === "meeting_held") return { key: "meeting", label: "Meeting held" };
  if (o === "interested") return { key: "interested", label: "Interested" };
  if (o === "not_interested") return { key: "not_interested", label: "Not interested" };
  if (o === "bad_fit") return { key: "bad_fit", label: "Bad fit" };
  if (o === "not_available") return { key: "not_available", label: "Not available" };
  if (t.channel === "voicemail") return { key: "left_voicemail", label: "Left voicemail" };
  if (t.channel === "cold_call" && o === "no_answer") return { key: "no_answer", label: "No answer" };
  if (t.channel === "linkedin_connect" && o === "connected") return { key: "connected", label: "Connected" };
  if (t.channel === "linkedin_connect" && (o === "sent" || !o)) return { key: "connection_sent", label: "Connection sent" };
  if (t.channel === "linkedin_dm" && (o === "sent" || !o)) return { key: "messaged", label: "Messaged" };
  if (t.channel === "cold_call" && !o) return { key: "talked", label: "Called (talked)" };
  if (t.channel === "email" && (o === "sent" || !o)) return { key: "emailed", label: "Emailed" };
  if (t.channel === "in_person" && (o === "sent" || !o)) return { key: "visited", label: "Visited" };
  const ch = TOUCH_CHANNEL_LABELS[t.channel] ?? t.channel;
  return { key: "other", label: o ? `${ch}: ${TOUCH_OUTCOME_LABELS[o] ?? o}` : ch };
}

// Badge class (lead-finder.css .st-*).
export const OUTCOME_CLASS: Record<DisplayKey | "moved", string> = {
  no_answer: "st-new",
  not_now: "st-new",
  staff_no: "st-nofit",
  dead: "st-dead",
  left_voicemail: "st-new",
  not_available: "st-new",
  connection_sent: "st-contacted",
  connected: "st-contacted",
  messaged: "st-contacted",
  talked: "st-contacted",
  emailed: "st-contacted",
  visited: "st-contacted",
  interested: "st-interested",
  booked_call: "st-interested",
  meeting: "st-replied",
  not_interested: "st-nofit",
  bad_fit: "st-dead",
  moved: "st-converted",
  other: "st-replied",
};

// A touch as a plain sentence for History, timelines and the Latest outcome
// column: "Called Nov 5 · Not available · spoke with Crystal (front desk) ·
// Luke", "Emailed Nov 5 · hello@business.com · Luke". Parts so the outcome
// can be styled; join with " · ".
const CHANNEL_VERB: Record<string, string> = {
  cold_call: "Called",
  voicemail: "Called",
  email: "Emailed",
  in_person: "Visited",
  meeting: "Met",
  text: "Texted",
  linkedin_dm: "LinkedIn",
  linkedin_connect: "LinkedIn",
  loom: "Sent a Loom",
};

export function describeTouch(
  t: LatestTouch,
  memberName: (id: string | null) => string
): { lead: string; outcome: string | null; key: DisplayKey; detail: string | null; who: string } {
  // Timeline entries that aren't outreach (migrations 030, 032, 033).
  if (t.event) {
    const d = t.details ?? {};
    const date = shortDate(t.touched_at);
    const who = t.touched_by ? memberName(t.touched_by) : "automatic";
    const name = (id: string | null | undefined) => (id ? memberName(id) : "nobody");
    switch (t.event) {
      case "reassigned":
        return { lead: `Reassigned ${date}`, outcome: null, key: "other", detail: `${name(d.from)} to ${name(d.to)}`, who };
      case "released":
        return { lead: `Released ${date}`, outcome: null, key: "other", detail: `was ${name(d.from)}`, who };
      case "removed_from_pipeline":
        return {
          lead: `Removed from pipeline ${date}`,
          outcome: d.reason ?? null,
          key: t.outcome ? classifyTouch(t).key : "other",
          // "Removed from pipeline Nov 6 · Just networking · <note> · Luke"
          detail: [d.note, d.revisit ? `revisit ${shortDate(d.revisit + "T12:00:00")}` : null].filter(Boolean).join(" · ") || null,
          who,
        };
      case "project_lost":
        return { lead: `Project lost ${date}`, outcome: null, key: "not_interested", detail: d.branch ?? null, who };
      default:
        return { lead: `Note ${date}`, outcome: null, key: "other", detail: null, who };
    }
  }
  const c = classifyTouch(t);
  const verb = CHANNEL_VERB[t.channel] ?? "Contacted";
  const lead = `${verb} ${shortDate(t.touched_at)}`;
  // The verb already says it for these.
  const redundant = (c.key === "emailed" && t.channel === "email") || (c.key === "visited" && t.channel === "in_person") || (c.key === "meeting" && t.channel === "meeting");
  const outcome = redundant ? null : c.key === "talked" ? "Talked" : c.label;
  const d = t.details ?? {};
  const detail = d.spoke_with
    ? `spoke with ${d.spoke_with}${d.role ? ` (${d.role})` : ""}`
    : d.to
      ? d.to
      : d.dead_reason
        ? d.dead_reason
        : d.talked_to
          ? `talked to ${d.talked_to === "owner" ? "the owner" : "staff"}`
          : null;
  return { lead, outcome, key: c.key, detail, who: memberName(t.touched_by) };
}

// "Nov 5" in the viewer's timezone (client components only).
export const shortDate = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso));

// Scanner tag <-> branch, for branch tags in History.
export const BRANCH_TAG: Record<Branch, "website" | "social" | "ecom" | "ai"> = {
  Websites: "website",
  Media: "social",
  Ecommerce: "ecom",
  AI: "ai",
};
