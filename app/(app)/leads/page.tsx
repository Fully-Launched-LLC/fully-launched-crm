import { createClient } from "@/lib/supabase/server";
import { getCurrentTeamMember } from "@/lib/auth";
import type { TeamMember } from "@/lib/types";
import { LEAD_LIST_COLUMNS, type LeadListRow } from "@/lib/leads/list";
import LeadsBoard from "@/components/leads/LeadsBoard";

// The shared lead list: everyone sees every lead. Filters, claim, bulk
// actions, quick-log and the lead drawer live in components/leads/. New
// leads come from the Lead Finder, manual adds and CSV imports, all through
// the database upsert (migration 018).
export default async function LeadsPage({ searchParams }: { searchParams: { lead?: string } }) {
  const supabase = createClient();
  const me = await getCurrentTeamMember();

  const leads: LeadListRow[] = [];
  const page = 1000; // PostgREST's default max rows
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("leads")
      .select(LEAD_LIST_COLUMNS)
      .order("created_at", { ascending: false })
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as unknown as LeadListRow[];
    leads.push(...batch);
    if (batch.length < page) break;
  }

  const { data: members } = await supabase.from("team_members").select("*").order("created_at").order("id");

  return (
    <div className="p-8">
      <LeadsBoard
        initialLeads={leads}
        members={(members ?? []) as TeamMember[]}
        me={me}
        initialOpenId={searchParams.lead ?? null}
      />
    </div>
  );
}
