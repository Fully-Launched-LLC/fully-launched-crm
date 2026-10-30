import { createClient } from "@/lib/supabase/server";
import type { TeamMember } from "@/lib/types";

// The signed-in user's team_members row. Uses the database's identity rule
// (current_team_member_id(): confirmed auth email matched to the roster
// email, case-insensitively), so the app and RLS always agree on who you
// are. Returns null if there's no session or no matching roster entry.
export async function getCurrentTeamMember(): Promise<TeamMember | null> {
  const supabase = createClient();
  const { data: id } = await supabase.rpc("current_team_member_id");
  if (!id) return null;

  const { data } = await supabase
    .from("team_members")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  return (data as TeamMember) ?? null;
}
