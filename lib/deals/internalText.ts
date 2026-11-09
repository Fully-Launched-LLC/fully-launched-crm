import { money } from "@/lib/deals/money";
import type { InternalDoc } from "@/lib/deals/internal";
import { DEAL_BRANCH_NAMES, type DealBranch } from "@/lib/deals/types";

const monthLabel = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
};

export { monthLabel };

// Text blocks for the Google Doc export of the internal deal doc.
export function internalDocBlocks(d: InternalDoc, client: string, members: { id: string; name: string }[]) {
  const who = (id: string | null) => members.find((m) => m.id === id)?.name ?? "Unassigned";
  return [
    {
      heading: `${client}: Internal Deal Doc`,
      lines: [
        `Computed ${new Date().toISOString().slice(0, 10)} from the CRM (the CRM page is the source of truth).`,
        `Based on: ${d.selection === "signed" ? "the client's signed selections" : "the default selections"}.`,
      ],
    },
    {
      heading: "Price breakdown",
      lines: d.breakdown.map(
        (b) =>
          `${DEAL_BRANCH_NAMES[b.branch as DealBranch] ?? b.branch}: ${money(b.one_time)} one-time, ${money(b.monthly)}/month${
            b.hourly.length ? `, hourly: ${b.hourly.map((h) => `${h.label} ${money(h.rate)}/hr`).join(", ")}` : ""
          }`
      ),
    },
    {
      heading: "Expected cash by month (12 months)",
      lines: d.months.map(
        (m) =>
          `${monthLabel(m.month)}: cash ${money(m.cash)}, commission ${money(m.commission)}, earn-up ${money(m.earnUp)}`
      ),
    },
    {
      heading: "Payouts",
      lines: [
        `Commission to ${who(d.ownerId)} (${d.settings.commission_pct}% of deal value, accrued as cash is collected): ${money(d.totals.commission)}`,
        `Earn-up pool (${d.settings.earn_up_pct}% of deal value, accrued as cash is collected, through ${d.settings.earn_up_ends}): ${money(d.totals.earnUp)}`,
      ],
    },
    {
      heading: "Labor and margin",
      lines: [
        d.labor.projectRate == null
          ? "Labor: project hourly rate not set (Settings > Deal Desk)"
          : `Labor: ${d.labor.projectHours ?? 0} est. project hours x ${money(d.labor.projectRate)} = ${money(d.labor.project ?? 0)}`,
        `12-month cash: ${money(d.totals.cash)}`,
        d.totals.margin == null ? "Margin: incomplete (project hourly rate not set)" : `Margin: ${money(d.totals.margin)}`,
      ],
    },
  ];
}
