import type { Branch, Source } from "@/lib/theme";
import type { TeamMember } from "@/lib/types";

// Move to Interested (Leads drawer): helpers shared by the dialog.

// Project owner default: the team member who leads that branch
// (team_members.lead_branches, migration 017).
export function defaultOwnerFor(branch: Branch | "", members: TeamMember[]): string | null {
  if (!branch) return null;
  return members.find((m) => (m.lead_branches ?? []).includes(branch))?.id ?? null;
}

// projects.source is a fixed list (projects_source_check); leads.source is
// the lead's origin. Map what has an equivalent, else use how the first touch
// happened, else leave it empty.
export function projectSourceFor(
  leadSource: string | null,
  firstTouch: { channel: string; direction: string } | null
): Source | null {
  if (leadSource === "referral") return "Referral";
  if (leadSource === "personal_network") return "Relationship";
  if (!firstTouch) return null;
  if (firstTouch.direction === "inbound") return "Inbound";
  if (firstTouch.channel === "cold_call" || firstTouch.channel === "voicemail") return "Cold Call";
  if (firstTouch.channel === "email") return "Email";
  if (firstTouch.channel.startsWith("linkedin")) return "LinkedIn";
  return null;
}
