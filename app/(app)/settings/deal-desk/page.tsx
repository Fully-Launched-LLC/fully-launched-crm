import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeamMember } from "@/lib/auth";
import type { DealSettings } from "@/lib/deals/types";
import { driveHealth } from "@/lib/deals/google";
import DealDeskSettings from "@/components/settings/DealDeskSettings";

const docLink = (id: string | undefined) => (id ? `https://docs.google.com/document/d/${id}/edit` : null);

export default async function DealDeskSettingsPage() {
  const me = await getCurrentTeamMember();
  // Frontend gate; RLS on deal_settings (Admin update, migration 037) is the real one.
  if (me?.role !== "Admin") redirect("/dashboard");

  const supabase = createClient();
  const [{ data }, health] = await Promise.all([
    supabase.from("deal_settings").select("*").eq("id", true).maybeSingle(),
    driveHealth().catch((e) => [{ label: "Google", ok: false, detail: e instanceof Error ? e.message : String(e) }]),
  ]);

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
      <section className="mt-6 rounded-lg border border-neutral-200 p-5">
        <h2 className="text-base font-semibold text-foreground">Google Drive check</h2>
        <p className="mt-1 text-sm text-neutral-500">Looked up with the service account each time this page loads.</p>
        <ul className="mt-3 space-y-1 text-sm">
          {health.map((h) => (
            <li key={h.label + h.detail} className={h.ok ? "text-green-700" : "text-red-700"}>
              {h.ok ? "OK" : "Problem"}: {h.label}. {h.detail}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
