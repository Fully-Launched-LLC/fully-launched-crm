import { createClient } from "@/lib/supabase/server";
import { getCurrentTeamMember } from "@/lib/auth";
import type { TeamMember } from "@/lib/types";
import TeamManager from "@/components/team/TeamManager";
import TeamDirectory from "@/components/team/TeamDirectory";
import TeamTabs from "@/components/team/TeamTabs";

export default async function TeamPage() {
  const teamMember = await getCurrentTeamMember();
  // Admins manage the roster; everyone else gets a read-only directory with
  // booking links. Only the UI differs — writes to team_members are
  // Admin-only in RLS (migration 005) regardless.
  const isAdmin = teamMember?.role === "Admin";

  const supabase = createClient();
  const { data: members } = await supabase
    .from("team_members")
    .select("*")
    .order("name");

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-foreground">Team</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {isAdmin
          ? "Manage the roster, roles, and Cal.com booking links."
          : "Cal.com booking links for booking a client call with the right person."}
      </p>

      <TeamTabs />

      <div className="mt-6">
        {isAdmin ? (
          <TeamManager
            initialMembers={(members ?? []) as TeamMember[]}
            currentUserId={teamMember.id}
          />
        ) : (
          <TeamDirectory members={(members ?? []) as TeamMember[]} />
        )}
      </div>
    </div>
  );
}
