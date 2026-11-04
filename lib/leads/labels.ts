import type { LeadStatus } from "@/lib/types";

export const LEAD_STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "replied",
  "interested",
  "converted",
  "not_interested",
  "dead",
];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  replied: "Replied",
  interested: "Interested",
  converted: "Converted",
  not_interested: "Not interested",
  dead: "Dead",
};

// lead_touches.channel (migration 017).
export const TOUCH_CHANNEL_LABELS: Record<string, string> = {
  linkedin_connect: "LinkedIn connect",
  linkedin_dm: "LinkedIn DM",
  email: "Email",
  cold_call: "Cold call",
  voicemail: "Voicemail",
  text: "Text",
  loom: "Loom",
  in_person: "In person",
  meeting: "Meeting",
  other: "Other",
};

// "3d ago", "2h ago", "just now". For last-touch columns.
export function relativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d}d ago`;
  return `${Math.round(d / 30)}mo ago`;
}

// leads.source (migration 018 check constraint). Change both together.
export const LEAD_SOURCES = [
  "lead_finder",
  "manual",
  "referral",
  "personal_network",
  "csv_import",
  "etsy",
  "apify",
  "grokbot",
  "claude",
  "happenstance",
  "gojiberry",
  "heyreach",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  lead_finder: "Lead Finder",
  manual: "Manual",
  referral: "Referral",
  personal_network: "Personal network",
  csv_import: "CSV import",
  etsy: "Etsy",
  apify: "Apify",
  grokbot: "GrokBot",
  claude: "Claude research",
  happenstance: "Happenstance",
  gojiberry: "Gojiberry",
  heyreach: "HeyReach",
};

export const sourceLabel = (s: string | null | undefined) =>
  (s && LEAD_SOURCE_LABELS[s as LeadSource]) || s || "";

// lead_touches.outcome / direction (migration 017).
export const TOUCH_OUTCOMES = [
  "sent",
  "no_answer",
  "no_reply",
  "replied",
  "interested",
  "not_interested",
  "bad_fit",
  "bounced",
  "meeting_booked",
  "meeting_held",
] as const;
export const TOUCH_OUTCOME_LABELS: Record<string, string> = {
  sent: "Sent",
  no_answer: "No answer",
  no_reply: "No reply",
  replied: "Replied",
  interested: "Interested",
  not_interested: "Not interested",
  bad_fit: "Bad fit",
  bounced: "Bounced",
  meeting_booked: "Meeting booked",
  meeting_held: "Meeting held",
};
export const TOUCH_CHANNELS = Object.keys(TOUCH_CHANNEL_LABELS);
