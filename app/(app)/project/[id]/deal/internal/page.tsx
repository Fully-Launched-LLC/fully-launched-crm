import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentTeamMember } from "@/lib/auth";
import { computeInternal } from "@/lib/deals/internal";
import { monthLabel } from "@/lib/deals/internalText";
import { money } from "@/lib/deals/money";
import { loadDeal, companyName } from "@/lib/deals/server";
import { DEAL_BRANCH_NAMES, type DealBranch, type Selections } from "@/lib/deals/types";
import ExportInternalButton from "@/components/deals/ExportInternalButton";

export const dynamic = "force-dynamic";

// Internal Deal Doc: computed live, team only. Never linked from the public
// sign flow or included in any signing payload.
export default async function InternalDealDocPage({ params }: { params: { id: string } }) {
  const member = await getCurrentTeamMember();
  if (!member) redirect(`/login?next=/project/${params.id}/deal/internal`);

  const db = createClient();
  const { data: dealRow } = await db
    .from("deals")
    .select("id")
    .eq("project_id", params.id)
    .neq("status", "void")
    .maybeSingle();
  if (!dealRow) notFound();
  const bundle = await loadDeal(db, dealRow.id);
  if (!bundle) notFound();

  const { data: sig } = await createAdminClient()
    .from("deal_signatures")
    .select("selections")
    .eq("deal_id", bundle.deal.id)
    .not("signed_at", "is", null)
    .maybeSingle();
  const { data: members } = await db.from("team_members").select("id, name");
  const who = (id: string | null) => (members ?? []).find((m) => m.id === id)?.name ?? "Unassigned";
  const d = computeInternal(bundle.deal, bundle.items, bundle.settings, (sig?.selections as Selections) ?? null);

  const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500";
  const td = "px-3 py-2 text-sm text-foreground";
  const tdr = `${td} text-right tabular-nums`;

  return (
    <div className="p-8">
      <Link href={`/project/${params.id}?view=deal`} className="text-sm text-accent hover:underline">
        Back to the Deal Desk
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-foreground">{companyName(bundle)}: Internal Deal Doc</h1>
        <span className="rounded-full border border-neutral-300 px-2 py-0.5 text-xs text-neutral-600">Team only</span>
        <div className="ml-auto">
          <ExportInternalButton dealId={bundle.deal.id} />
        </div>
      </div>
      <p className="mt-1 text-sm text-neutral-500">
        Computed live from the line items and Settings &gt; Deal Desk. Based on{" "}
        {d.selection === "signed" ? "the client's signed selections" : "the default selections (not signed yet)"}.
      </p>

      <section className="mt-6 rounded-lg border border-neutral-200 p-5">
        <h2 className="text-sm font-semibold text-foreground">Price breakdown</h2>
        <table className="mt-3 w-full">
          <thead>
            <tr>
              <th className={th}>Branch</th>
              <th className={`${th} text-right`}>One-time</th>
              <th className={`${th} text-right`}>Monthly</th>
              <th className={th}>Hourly rates</th>
            </tr>
          </thead>
          <tbody>
            {d.breakdown.map((b) => (
              <tr key={b.branch} className="border-t border-neutral-100">
                <td className={td}>{DEAL_BRANCH_NAMES[b.branch as DealBranch] ?? b.branch}</td>
                <td className={tdr}>{money(b.one_time)}</td>
                <td className={tdr}>{money(b.monthly)}</td>
                <td className={td}>{b.hourly.map((h) => `${h.label} ${money(h.rate)}/hr`).join(", ") || "None"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-6 rounded-lg border border-neutral-200 p-5">
        <h2 className="text-sm font-semibold text-foreground">Expected cash by month</h2>
        <p className="mt-1 text-xs text-neutral-500">
          50% of one-time items in the target start month ({monthLabel(d.startMonth)}), 50% in the target launch month (
          {monthLabel(d.launchMonth)}), monthly items from the launch month.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr>
                <th className={th}>Month</th>
                <th className={`${th} text-right`}>Cash</th>
                <th className={`${th} text-right`}>Commission</th>
                <th className={`${th} text-right`}>Earn-up pool</th>
                <th className={`${th} text-right`}>Tool builder</th>
              </tr>
            </thead>
            <tbody>
              {d.months.map((m) => (
                <tr key={m.month} className="border-t border-neutral-100">
                  <td className={td}>{monthLabel(m.month)}</td>
                  <td className={tdr}>{money(m.cash)}</td>
                  <td className={tdr}>{money(m.commission)}</td>
                  <td className={tdr}>{money(m.earnUp)}</td>
                  <td className={tdr}>{money(m.toolBuilder)}</td>
                </tr>
              ))}
              <tr className="border-t border-neutral-300 font-semibold">
                <td className={td}>12 months</td>
                <td className={tdr}>{money(d.totals.cash)}</td>
                <td className={tdr}>{money(d.totals.commission)}</td>
                <td className={tdr}>{money(d.totals.earnUp)}</td>
                <td className={tdr}>{money(d.totals.toolBuilder)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-6 rounded-lg border border-neutral-200 p-5 lg:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Payouts</h2>
          <ul className="mt-2 space-y-1 text-sm text-foreground">
            <li>
              Commission ({d.settings.commission_pct}% of cash collected) to {who(d.ownerId)}: {money(d.totals.commission)}
            </li>
            <li>
              Earn-up pool ({d.settings.earn_up_pct}% of cash collected, through {d.settings.earn_up_ends}):{" "}
              {money(d.totals.earnUp)}
            </li>
            <li>
              Tool builder ({d.settings.tool_builder_pct}% of productized tool revenue) to {who(d.toolBuilderId)}:{" "}
              {money(d.totals.toolBuilder)}
            </li>
          </ul>
          <p className="mt-2 text-xs text-neutral-500">Basis: {d.basis}</p>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">Labor and margin</h2>
          <ul className="mt-2 space-y-1 text-sm text-foreground">
            <li>
              Management: {d.labor.managementHours ?? 0} h x {money(d.labor.managementRate)} = {money(d.labor.management)}
            </li>
            <li>
              {d.labor.projectRate == null ? (
                <span className="text-amber-700">Project hourly rate not set (Settings &gt; Deal Desk)</span>
              ) : (
                <>
                  Project: {d.labor.projectHours ?? 0} h x {money(d.labor.projectRate)} = {money(d.labor.project ?? 0)}
                </>
              )}
            </li>
            <li className="pt-2 font-semibold">
              Margin:{" "}
              {d.totals.margin == null ? (
                <span className="text-amber-700">incomplete</span>
              ) : (
                money(d.totals.margin)
              )}
            </li>
          </ul>
          <p className="mt-2 text-xs text-neutral-500">
            Margin = 12-month cash minus commission, earn-up, tool builder share and estimated labor.
          </p>
        </div>
      </section>
    </div>
  );
}
