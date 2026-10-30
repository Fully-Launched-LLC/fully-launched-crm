import { createClient } from "@/lib/supabase/server";
import { getCurrentTeamMember } from "@/lib/auth";
import { parsePayRange } from "@/lib/timeclock";
import type { TeamMember } from "@/lib/types";
import TeamTabs from "@/components/team/TeamTabs";
import Timesheets from "@/components/team/Timesheets";

export default async function TimesheetsPage({
  searchParams,
}: {
  // ?from=YYYY-MM-DD&to=YYYY-MM-DD (America/Chicago days, inclusive).
  // Missing or invalid -> this week.
  searchParams: { from?: string; to?: string };
}) {
  const teamMember = await getCurrentTeamMember();
  // Everyone can review everyone's time (RLS: team read). Approve and edit
  // are Admin-only; the UI hides them, the database enforces it.
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
        Clocked time by person and type. Management time counts toward pay once
        an Admin approves it.
      </p>

      <TeamTabs />

      <div className="mt-6">
        <Timesheets
          members={(members ?? []) as TeamMember[]}
          isAdmin={isAdmin}
          currentMemberId={teamMember?.id ?? null}
          range={parsePayRange(searchParams.from, searchParams.to)}
        />
      </div>
    </div>
  );
}
