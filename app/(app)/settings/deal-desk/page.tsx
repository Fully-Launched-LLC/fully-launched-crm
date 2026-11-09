import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeamMember } from "@/lib/auth";
import type { DealSettings } from "@/lib/deals/types";
import DealDeskSettings from "@/components/settings/DealDeskSettings";

const docLink = (id: string | undefined) => (id ? `https://docs.google.com/document/d/${id}/edit` : null);

export default async function DealDeskSettingsPage() {
  const me = await getCurrentTeamMember();
  // Frontend gate; RLS on deal_settings (Admin update, migration 037) is the real one.
  if (me?.role !== "Admin") redirect("/dashboard");

  const supabase = createClient();
  const { data } = await supabase.from("deal_settings").select("*").eq("id", true).maybeSingle();

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
      <p className="mt-1 text-sm text-neutral-500">Deal Desk. Admin only.</p>
      <div className="mt-6">
        <DealDeskSettings
          initial={(data ?? null) as DealSettings | null}
          memberId={me.id}
          templates={[
            { label: "CRM Master Proposal", url: docLink(process.env.GOOGLE_DOCS_PROPOSAL_TEMPLATE_ID) },
            { label: "CRM Master SOW", url: docLink(process.env.GOOGLE_DOCS_SOW_TEMPLATE_ID) },
          ]}
        />
      </div>
    </div>
  );
}
