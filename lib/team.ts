import {
  MEMBER_COLORS,
  UNKNOWN_MEMBER_COLOR,
  type MemberColor,
  type Role,
} from "@/lib/theme";
import type { TeamMember } from "@/lib/types";

// team_members RLS and the transactions policy both match
// auth.jwt() ->> 'email' exactly, and Supabase login emails are lowercase —
// a mixed-case roster email would silently fail every Admin check.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// id -> pill classes, from each member's stored color (team_members.color,
// migration 043). No stored color: gray.
export function memberColors(members: TeamMember[]): Map<string, string> {
  return new Map(
    members.map((m) => [
      m.id,
      (m.color && MEMBER_COLORS[m.color as MemberColor]) || UNKNOWN_MEMBER_COLOR,
    ])
  );
}

// Archived members (team_members.archived_at, migration 044) are off the
// team: left out of every picker, filter, the Team page and default-owner
// lookups. Keep passing the full roster wherever names are resolved, so
// history (time entries, closed projects, lead touches) still shows them.
export function isArchived(m: Pick<TeamMember, "archived_at">): boolean {
  return !!m.archived_at;
}

export function activeMembers<T extends Pick<TeamMember, "archived_at">>(members: T[]): T[] {
  return members.filter((m) => !isArchived(m));
}

// Picker options: active members, plus any archived member who is already
// selected (so the current value still shows and can be cleared, but an
// archived member can't be newly picked).
export function pickableMembers<T extends Pick<TeamMember, "id" | "archived_at">>(
  members: T[],
  selected: (string | null | undefined)[] = []
): T[] {
  return members.filter((m) => !isArchived(m) || selected.includes(m.id));
}

export function countAdmins(members: TeamMember[]): number {
  return members.filter((m) => m.role === "Admin").length;
}

// UI mirror of the DB guards from migration 005 (the DB is the real gate):
// - you can't change your own role (would let an Admin lock themselves out
//   of this page mid-edit)
// - the only Admin can't be demoted (ensure_an_admin_remains trigger)
export type RoleLock =
  | { kind: "none" }
  | { kind: "self"; reason: string }
  | { kind: "lastAdmin"; reason: string; disabledRoles: Role[] };

export function roleLock(
  member: TeamMember,
  currentUserId: string | null,
  adminCount: number
): RoleLock {
  // Checked first: since only Admins can open /team, the sole Admin is
  // always the viewer, and the more specific last-Admin reason should win
  // over the generic self lock.
  if (member.role === "Admin" && adminCount <= 1) {
    return {
      kind: "lastAdmin",
      reason: "Only Admin — promote someone else to Admin first.",
      disabledRoles: ["Manager", "Salesperson"],
    };
  }
  if (member.id === currentUserId) {
    return { kind: "self", reason: "You can't change your own role." };
  }
  return { kind: "none" };
}

// Postgres error codes -> something readable. Falls back to the raw message.
export function friendlyTeamError(error: {
  code?: string;
  message: string;
}): string {
  switch (error.code) {
    case "23505":
      return "A team member with that email already exists.";
    case "23514":
      return error.message.includes("Admin must remain")
        ? "At least one Admin must remain on the team."
        : error.message;
    case "42501":
      return "Only Admins can change the team.";
    default:
      return error.message;
  }
}
