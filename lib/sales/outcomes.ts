import type { Branch } from "@/lib/theme";
import { TOUCH_CHANNEL_LABELS, TOUCH_OUTCOME_LABELS } from "@/lib/leads/labels";

// Sales (/sales): which leads rows count as Sales businesses, and the
// one-click outcomes. No schema of its own: a business is a leads row, an
// outcome is a lead_touches row (migration 017 channels/outcomes).

// leads.source values shown anywhere in Sales (search matches, History).
// Add "apify", "etsy", ... here when those imports start; nothing else
// changes. Legacy outreach (personal_network, etsy, manual, ...) stays out.
export const SALES_SOURCES = ["lead_finder"] as const;
export const isSalesSource = (s: string | null | undefined) =>
  !!s && (SALES_SOURCES as readonly string[]).includes(s);

export type OutcomeKey =
  | "no_answer"
  | "not_available"
  | "emailed"
  | "visited"
  | "interested"
  | "not_interested"
  | "booked_call";

// How a touch reads in rows, History and timelines. Includes outcomes the
// buttons no longer log (Called (talked), Bad fit) so older touches still
// show correctly.
export type DisplayKey = OutcomeKey | "talked" | "bad_fit" | "meeting" | "other";

export type Outcome = {
  key: OutcomeKey;
  label: string;
  // "last": the business's most recent touch channel (an answer comes back
  // on the channel we used), else cold_call.
  channel: string | "last";
  direction: "outbound" | "inbound";
  outcome: string;
  // Opens Move to Interested after saving (when the user may edit).
  opensMove?: boolean;
  // Opens a small form before saving (who we spoke with). Not in the bulk bar.
  needsForm?: boolean;
  // The toast offers a follow-up (next_action "Follow up: call" / "email").
  followUp?: "call" | "email";
};

export const OUTCOMES: Outcome[] = [
  { key: "no_answer", label: "No answer", channel: "cold_call", direction: "outbound", outcome: "no_answer", followUp: "call" },
  // Reached someone, not the decision maker (migration 023). details:
  // {spoke_with, role, email}; the summary is what they said.
  { key: "not_available", label: "Not available", channel: "cold_call", direction: "outbound", outcome: "not_available", needsForm: true, followUp: "call" },
  { key: "emailed", label: "Emailed", channel: "email", direction: "outbound", outcome: "sent", followUp: "email" },
  { key: "visited", label: "Visited", channel: "in_person", direction: "outbound", outcome: "sent" },
  { key: "interested", label: "Interested", channel: "last", direction: "inbound", outcome: "interested", opensMove: true },
  { key: "not_interested", label: "Not interested", channel: "last", direction: "inbound", outcome: "not_interested" },
  // meeting_booked: the touch trigger sets status interested.
  { key: "booked_call", label: "Booked call", channel: "cold_call", direction: "outbound", outcome: "meeting_booked", opensMove: true },
];

export const outcomeByKey = (k: OutcomeKey) => OUTCOMES.find((o) => o.key === k)!;

// Hidden from search results by default ("Show already contacted").
// bad_fit: older touches only.
export const HIDDEN_OUTCOMES: DisplayKey[] = ["not_interested", "bad_fit"];

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
};

export type TouchDetails = { spoke_with?: string; role?: string; email?: string; to?: string };

// A touch back to the outcome that logged it (also reads touches logged
// before these buttons: Called (talked), Bad fit, voicemail, replied, ...).
export function classifyTouch(t: Pick<LatestTouch, "channel" | "outcome">): { key: DisplayKey; label: string } {
  const o = t.outcome;
  if (o === "meeting_booked") return { key: "booked_call", label: "Booked call" };
  // Meetings logged from Granola (migration 022): channel meeting, meeting_held.
  if (o === "meeting_held") return { key: "meeting", label: "Meeting held" };
  if (o === "interested") return { key: "interested", label: "Interested" };
  if (o === "not_interested") return { key: "not_interested", label: "Not interested" };
  if (o === "bad_fit") return { key: "bad_fit", label: "Bad fit" };
  if (o === "not_available") return { key: "not_available", label: "Not available" };
  if (t.channel === "voicemail" || (t.channel === "cold_call" && o === "no_answer")) return { key: "no_answer", label: "No answer" };
  if (t.channel === "cold_call" && !o) return { key: "talked", label: "Called (talked)" };
  if (t.channel === "email" && (o === "sent" || !o)) return { key: "emailed", label: "Emailed" };
  if (t.channel === "in_person" && (o === "sent" || !o)) return { key: "visited", label: "Visited" };
  const ch = TOUCH_CHANNEL_LABELS[t.channel] ?? t.channel;
  return { key: "other", label: o ? `${ch}: ${TOUCH_OUTCOME_LABELS[o] ?? o}` : ch };
}

// Badge class (lead-finder.css .st-*).
export const OUTCOME_CLASS: Record<DisplayKey | "moved", string> = {
  no_answer: "st-new",
  not_available: "st-new",
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
  linkedin_dm: "Messaged on LinkedIn",
  linkedin_connect: "Connected on LinkedIn",
  loom: "Sent a Loom",
};

export function describeTouch(
  t: LatestTouch,
  memberName: (id: string | null) => string
): { lead: string; outcome: string | null; key: DisplayKey; detail: string | null; who: string } {
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
