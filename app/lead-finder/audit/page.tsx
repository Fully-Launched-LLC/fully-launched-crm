import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeamMember } from "@/lib/auth";
import type { SavedAudit } from "@/lib/lead-finder/types";
import AuditReport from "@/components/lead-finder/AuditReport";

export const metadata: Metadata = { title: "Online Presence Audit" };

// Matteo's audit page (his audit.html), opened in a new tab from the Lead
// Finder detail panel. Outside the (app) layout, like /clock, so "Print
// client audit" prints only the audit. Login still required (middleware).
//   ?place=<google place id>&type=<search type>&lead=<leads.id, optional>
// With a lead that already has a saved audit, the saved one is shown (no
// Google call) until "Run again".
export default async function AuditPage({
  searchParams,
}: {
  searchParams: { place?: string; type?: string; lead?: string };
}) {
  const member = await getCurrentTeamMember();
  if (!member) {
    return (
      <p style={{ padding: 16, fontSize: 14 }}>
        Your login isn&apos;t on the team roster. Ask an Admin to add you on the Team page.
      </p>
    );
  }

  let saved: SavedAudit | null = null;
  let leadId: string | null = null;
  let recordOwner: { name: string | null; edited: boolean } | null = null;
  if (searchParams.lead) {
    const { data } = await createClient()
      .from("leads")
      .select("id, audit, contact_name, title")
      .eq("id", searchParams.lead)
      .maybeSingle();
    if (data) {
      leadId = data.id;
      recordOwner = { name: data.contact_name, edited: !!data.title && data.title !== "Possible owner" };
      const a = data.audit as SavedAudit | null;
      if (a && a.version === 1 && a.place) saved = a;
    }
  }

  return (
    <AuditReport
      placeId={searchParams.place ?? saved?.place.id ?? ""}
      type={searchParams.type ?? saved?.type ?? ""}
      leadId={leadId}
      memberId={member.id}
      saved={saved}
      recordOwner={recordOwner}
    />
  );
}
