import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeamMember } from "@/lib/auth";
import type { SavedAudit } from "@/lib/lead-finder/types";
import type { TeamMember } from "@/lib/types";
import { LEAD_LIST_COLUMNS } from "@/lib/leads/list";
import { existingFromLead, type SalesLeadRow } from "@/lib/sales/fromLead";
import type { LatestTouch } from "@/lib/sales/outcomes";
import AuditReport from "@/components/lead-finder/AuditReport";
import { asMode } from "@/lib/sales/searchModes";
import { SalesFlagsProvider } from "@/components/sales/SalesFlags";
import { salesFlags } from "@/lib/sales/flags";

export const metadata: Metadata = { title: "Business dossier" };

// The business dossier (Run audit in Sales), components/lead-finder/AuditReport.tsx.
// Outside the (app) layout, like /clock, so "Print client report" prints
// only the client-facing part. Login still required (middleware).
//   ?place=<google place id>&type=<search type>&lead=<leads.id, optional>
//   &mode=<search focus, optional: default branch for email drafts + call script>
// With a record that already has a saved audit, the saved one is shown (no
// Google call) until "Run again".
export default async function AuditPage({
  searchParams,
}: {
  searchParams: { place?: string; type?: string; lead?: string; mode?: string };
}) {
  const me = await getCurrentTeamMember();
  if (!me) {
    return (
      <p style={{ padding: 16, fontSize: 14 }}>
        Your login isn&apos;t on the team roster. Ask an Admin to add you on the Team page.
      </p>
    );
  }
  const supabase = createClient();
  const { data: members } = await supabase.from("team_members").select("*").order("name");

  let saved: SavedAudit | null = null;
  let existing = null;
  let sourceDetail = "Audit";
  if (searchParams.lead) {
    const [{ data: lead }, { data: touches }] = await Promise.all([
      supabase.from("leads").select(LEAD_LIST_COLUMNS + ", scan_tags, audit").eq("id", searchParams.lead).maybeSingle(),
      supabase
        .from("lead_touches")
        .select("channel, direction, outcome, summary, touched_by, touched_at, details")
        .eq("lead_id", searchParams.lead)
        .order("touched_at", { ascending: false })
        .limit(1),
    ]);
    if (lead) {
      const row = lead as unknown as SalesLeadRow & { audit: SavedAudit | null };
      existing = existingFromLead(row, ((touches ?? [])[0] as LatestTouch | undefined) ?? null);
      sourceDetail = row.source_detail ?? "Audit";
      const a = row.audit;
      if (a && a.version === 1 && a.place) saved = a;
    }
  }

  return (
    <SalesFlagsProvider flags={salesFlags()}>
      <AuditReport
      placeId={searchParams.place ?? saved?.place.id ?? ""}
      type={searchParams.type ?? saved?.type ?? ""}
      me={me}
      members={(members ?? []) as TeamMember[]}
      saved={saved}
      initialExisting={existing}
      sourceDetail={sourceDetail}
      mode={asMode(searchParams.mode)}
      />
    </SalesFlagsProvider>
  );
}
