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
