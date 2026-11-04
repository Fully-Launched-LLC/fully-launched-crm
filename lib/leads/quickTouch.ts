// One-click touches (Leads drawer and bulk "Log touch"). Each becomes one
// lead_touches row logged as the current user; the touch trigger (migration
// 017) then sets last_touch_at and moves the status (e.g. Interested).
// channel "last": the lead's most recent touch channel (a reply comes back
// on the channel we used), else "other".

export type QuickTouch = {
  key: string;
  label: string;
  channel: string | "last";
  direction: "outbound" | "inbound";
  outcome: string | null;
};

export const QUICK_TOUCHES: QuickTouch[] = [
  { key: "linkedin_sent", label: "LinkedIn sent", channel: "linkedin_dm", direction: "outbound", outcome: "sent" },
  { key: "email_sent", label: "Email sent", channel: "email", direction: "outbound", outcome: "sent" },
  { key: "call_no_answer", label: "Cold call: no answer", channel: "cold_call", direction: "outbound", outcome: "no_answer" },
  { key: "call_talked", label: "Cold call: talked", channel: "cold_call", direction: "outbound", outcome: null },
  { key: "voicemail", label: "Voicemail", channel: "voicemail", direction: "outbound", outcome: null },
  { key: "replied", label: "Replied", channel: "last", direction: "inbound", outcome: "replied" },
  { key: "interested", label: "Interested", channel: "last", direction: "inbound", outcome: "interested" },
  { key: "not_interested", label: "Not interested", channel: "last", direction: "inbound", outcome: "not_interested" },
  { key: "bad_fit", label: "Bad fit", channel: "last", direction: "outbound", outcome: "bad_fit" },
];

export function resolveChannel(q: QuickTouch, lastChannel: string | null | undefined): string {
  return q.channel === "last" ? lastChannel || "other" : q.channel;
}

// Outcomes that offer "Move to Interested" right after logging.
export const CONVERT_OUTCOMES = ["interested", "meeting_booked"];
