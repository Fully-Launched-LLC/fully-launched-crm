import { createClient } from "@/lib/supabase/server";
import type { TeamMember } from "@/lib/types";

// The signed-in user's team_members row. Uses the database's identity rule
// (current_team_member_id(): confirmed auth email matched to the roster
// email, case-insensitively), so the app and RLS always agree on who you
// are. Returns null if there's no session, no matching roster entry, or the
// entry is archived.
export async function getCurrentTeamMember(): Promise<TeamMember | null> {
  const supabase = createClient();
  const { data: id } = await supabase.rpc("current_team_member_id");
  if (!id) return null;

  const { data } = await supabase
    .from("team_members")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  // An archived member (migration 044) is off the team: no role in the app
  // (Team, Finance, Transactions and every other role check see null).
  const member = (data as TeamMember) ?? null;
  return member && !member.archived_at ? member : null;
}
