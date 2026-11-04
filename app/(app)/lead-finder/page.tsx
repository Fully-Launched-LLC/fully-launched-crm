import { createClient } from "@/lib/supabase/server";
import { getCurrentTeamMember } from "@/lib/auth";
import type { TeamMember } from "@/lib/types";
import type { LeadFinderRun } from "@/lib/lead-finder/types";
import LeadFinder from "@/components/lead-finder/LeadFinder";

// Lead Finder: search Google for local businesses, scan their websites, and
// add the good ones to the shared lead list. Everyone can run a quick
// search; area sweeps are Admin/Manager (RLS enforces both). ?run=<id> opens
// a run, so a refresh or another team member sees the same progress.
export default async function LeadFinderPage({
  searchParams,
}: {
  searchParams: { run?: string };
}) {
  const teamMember = await getCurrentTeamMember();
  const supabase = createClient();
  const [{ data: members }, { data: runs }, { data: mine }] = await Promise.all([
    supabase.from("team_members").select("*").order("name"),
    supabase
      .from("lead_finder_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(15),
    // This user's most recent run: reopened when there's no ?run= and the
    // browser has no remembered last run.
    teamMember
      ? supabase
          .from("lead_finder_runs")
          .select("id")
          .eq("run_by", teamMember.id)
          .order("created_at", { ascending: false })
          .limit(1)
      : Promise.resolve({ data: [] as { id: string }[] }),
  ]);

  // Matteo's full-bleed dark layout (components/lead-finder/lead-finder.css),
  // under the CRM top nav.
  return (
    <LeadFinder
      member={teamMember}
      members={(members ?? []) as TeamMember[]}
      recentRuns={(runs ?? []) as LeadFinderRun[]}
      initialRunId={searchParams.run ?? null}
      fallbackRunId={mine?.[0]?.id ?? null}
    />
  );
}
