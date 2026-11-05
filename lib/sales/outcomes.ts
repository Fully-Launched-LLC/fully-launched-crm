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
  | "call_no_answer"
  | "call_talked"
  | "emailed"
  | "visited"
  | "interested"
  | "not_interested"
  | "bad_fit";

export type Outcome = {
  key: OutcomeKey;
  label: string;
  short: string; // row chips
  // "last": the business's most recent touch channel (an answer comes back
  // on the channel we used), else "other".
  channel: string | "last";
  direction: "outbound" | "inbound";
  outcome: string | null;
};

export const OUTCOMES: Outcome[] = [
  { key: "call_no_answer", label: "Called (no answer)", short: "No answer", channel: "cold_call", direction: "outbound", outcome: "no_answer" },
  { key: "call_talked", label: "Called (talked)", short: "Talked", channel: "cold_call", direction: "outbound", outcome: null },
  { key: "emailed", label: "Emailed", short: "Emailed", channel: "email", direction: "outbound", outcome: "sent" },
  { key: "visited", label: "Visited", short: "Visited", channel: "in_person", direction: "outbound", outcome: null },
  { key: "interested", label: "Interested", short: "Interested", channel: "last", direction: "inbound", outcome: "interested" },
  { key: "not_interested", label: "Not interested", short: "Not interested", channel: "last", direction: "inbound", outcome: "not_interested" },
  { key: "bad_fit", label: "Bad fit", short: "Bad fit", channel: "last", direction: "outbound", outcome: "bad_fit" },
];

export const outcomeByKey = (k: OutcomeKey) => OUTCOMES.find((o) => o.key === k)!;

// Hidden from search results by default ("Show already contacted").
export const HIDDEN_OUTCOMES: OutcomeKey[] = ["not_interested", "bad_fit"];

export function resolveChannel(o: Outcome, lastChannel: string | null | undefined): string {
  return o.channel === "last" ? lastChannel || "other" : o.channel;
}

// The latest touch on a business, as shown inline and in History.
export type LatestTouch = {
  channel: string;
  direction: string;
  outcome: string | null;
  summary: string | null;
  touched_by: string | null;
  touched_at: string;
};

// A touch back to the outcome that logged it (also reads touches logged
// before Sales, e.g. voicemail or replied).
export function classifyTouch(t: Pick<LatestTouch, "channel" | "outcome">): { key: OutcomeKey | null; label: string } {
  const o = t.outcome;
  if (o === "interested" || o === "meeting_booked" || o === "meeting_held") return { key: "interested", label: "Interested" };
  if (o === "not_interested") return { key: "not_interested", label: "Not interested" };
  if (o === "bad_fit") return { key: "bad_fit", label: "Bad fit" };
  if (t.channel === "voicemail" || ((t.channel === "cold_call") && o === "no_answer"))
    return { key: "call_no_answer", label: "Called (no answer)" };
  if (t.channel === "cold_call") return { key: "call_talked", label: "Called (talked)" };
  if (t.channel === "email") return { key: "emailed", label: "Emailed" };
  if (t.channel === "in_person") return { key: "visited", label: "Visited" };
  const ch = TOUCH_CHANNEL_LABELS[t.channel] ?? t.channel;
  return { key: null, label: o ? `${ch}: ${TOUCH_OUTCOME_LABELS[o] ?? o}` : ch };
}

// Badge class (lead-finder.css .st-*).
export const OUTCOME_CLASS: Record<OutcomeKey | "moved" | "other", string> = {
  call_no_answer: "st-new",
  call_talked: "st-contacted",
  emailed: "st-contacted",
  visited: "st-contacted",
  interested: "st-interested",
  not_interested: "st-nofit",
  bad_fit: "st-dead",
  moved: "st-converted",
  other: "st-replied",
};

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
