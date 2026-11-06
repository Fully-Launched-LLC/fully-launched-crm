import { classifyTouch, isOutcomeTouch, type DisplayKey, type LatestTouch } from "@/lib/sales/outcomes";

// History > Businesses sections (tabs with counts). A business can be in
// more than one (e.g. Warm and Follow up today); Dead is in no other section.
// Change CLAUDE.md (Sales > History sections) with this file.

export type SectionKey =
  | "follow_up"
  | "in_progress"
  | "no_next_step"
  | "warm"
  | "reach_owner"
  | "moved"
  | "not_now"
  | "not_interested"
  | "dead"
  | "clients";

export const SECTIONS: [SectionKey, string][] = [
  ["follow_up", "Follow up today"],
  ["in_progress", "In progress"],
  ["no_next_step", "No next step"],
  ["warm", "Warm"],
  ["reach_owner", "Reach the owner"],
  ["moved", "Moved to project"],
  ["not_now", "Not now"],
  ["not_interested", "Not interested"],
  ["dead", "Dead"],
  ["clients", "Clients"],
];

// Contacted and waiting on us.
export const CONTACTED_KEYS: DisplayKey[] = [
  "no_answer", "left_voicemail", "not_available", "emailed", "visited", "connection_sent", "connected", "messaged", "talked",
];

// Owner reached: any touch where we spoke with the business owner.
export function reachedOwner(t: Pick<LatestTouch, "channel" | "outcome" | "details">): boolean {
  const k = classifyTouch(t).key;
  if (k === "interested" || k === "booked_call" || k === "connected" || k === "messaged") return true;
  if (k === "not_interested" || k === "bad_fit") return true; // said by the owner (or older, unspecified)
  return t.details?.talked_to === "owner";
}

// What History needs per business, from all its touches (newest first).
export type TouchSummary = {
  latest: LatestTouch | null;
  ownerReached: boolean;
  staffSaidNo: boolean;
  // Last gatekeeper we logged (Not available / staff Not interested).
  gatekeeper: { name: string | null; role: string | null } | null;
  // Outreach since the last reply or positive outcome (auto-suggest Not now).
  attemptsWithoutReply: number;
};

const POSITIVE = ["replied", "interested", "meeting_booked", "meeting_held"];

export function summarizeTouches(all: LatestTouch[]): TouchSummary {
  // Notes, reassignments and releases aren't outcomes.
  const touches = all.filter(isOutcomeTouch);
  let ownerReached = false;
  let staffSaidNo = false;
  let gatekeeper: TouchSummary["gatekeeper"] = null;
  let attempts = 0;
  let sawPositive = false;
  for (const t of touches) {
    if (reachedOwner(t)) ownerReached = true;
    if (t.outcome === "not_interested" && t.details?.said_no_by === "staff") staffSaidNo = true;
    if (!gatekeeper && (t.details?.spoke_with || t.details?.said_no_by === "staff"))
      gatekeeper = { name: t.details?.spoke_with ?? null, role: t.details?.role ?? (t.details?.said_no_by === "staff" ? "front desk" : null) };
    if (!sawPositive) {
      if (POSITIVE.includes(t.outcome ?? "") || t.direction === "inbound") sawPositive = true;
      else if (t.direction === "outbound" && !t.details?.dead_reason) attempts++;
    }
  }
  return { latest: touches[0] ?? null, ownerReached, staffSaidNo, gatekeeper, attemptsWithoutReply: attempts };
}

export type SectionInput = {
  summary: TouchSummary;
  // The company has a project still in the pipeline (projects.lead_id, any
  // stage but Lost). Lost projects don't count: the company is back in History.
  hasProject: boolean;
  nextActionAt: string | null;
  // A project at Signed / In Progress / Subscriber / Complete.
  isClient: boolean;
};

function endOfToday(now = new Date()): number {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function sectionsFor(b: SectionInput): SectionKey[] {
  const k = b.summary.latest ? classifyTouch(b.summary.latest).key : null;
  if (k === "dead") return ["dead"];
  const out: SectionKey[] = [];
  const due = b.nextActionAt ? new Date(b.nextActionAt).getTime() : null;
  const eod = endOfToday();
  if (due != null && due <= eod) out.push("follow_up");
  const contacted = !!k && CONTACTED_KEYS.includes(k);
  if (contacted && due != null && due > eod) out.push("in_progress");
  if (contacted && due == null) out.push("no_next_step");
  if ((k === "interested" || k === "booked_call") && !b.hasProject) out.push("warm");
  const reachOwner = b.summary.staffSaidNo && !b.summary.ownerReached && !b.hasProject;
  if (reachOwner) out.push("reach_owner");
  if (b.hasProject) out.push("moved");
  if (k === "not_now") out.push("not_now");
  if (!reachOwner && (k === "not_interested" || k === "bad_fit" || k === "staff_no")) out.push("not_interested");
  if (b.isClient) out.push("clients");
  return out;
}

// Search results: dimming level from the latest touch alone (results don't
// load every touch). staff_no reads as "Front desk said no · owner not reached".
export type ResultState = "none" | "contacted" | "staff_no" | "stopped" | "dead";
export function resultState(latest: LatestTouch | null, projectId: string | null): ResultState {
  if (projectId) return "stopped";
  if (!latest) return "none";
  const k = classifyTouch(latest).key;
  if (k === "dead") return "dead";
  if (k === "staff_no") return "staff_no";
  if (k === "not_interested" || k === "bad_fit") return "stopped";
  return "contacted";
}
