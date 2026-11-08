// Internal Deal Doc: computed in code (no Claude call), team only. Shown live
// on /project/[id]/deal/internal and snapshotted at approval as a
// deal_documents row (kind internal, source computed).
import { round2, sortItems, totals } from "@/lib/deals/money";
import type { Deal, DealLineItem, DealSettings, Selections } from "@/lib/deals/types";

export type CashMonth = {
  month: string; // YYYY-MM
  oneTime: number;
  monthly: number;
  cash: number;
  productized: number; // cash from is_productized_tool items
  commission: number;
  earnUp: number;
  toolBuilder: number;
};

export type InternalDoc = {
  basis: string;
  selection: "signed" | "default";
  breakdown: { branch: string; one_time: number; monthly: number; hourly: { label: string; rate: number }[] }[];
  months: CashMonth[];
  totals: { cash: number; commission: number; earnUp: number; toolBuilder: number; labor: number | null; margin: number | null };
  labor: {
    managementHours: number | null;
    managementRate: number;
    projectHours: number | null;
    projectRate: number | null;
    management: number;
    project: number | null;
  };
  marginIncomplete: boolean;
  settings: DealSettings;
  ownerId: string | null;
  toolBuilderId: string | null;
  startMonth: string;
  launchMonth: string;
};

const ym = (d: string) => d.slice(0, 7);
function addMonths(m: string, n: number): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function computeInternal(
  deal: Deal,
  items: DealLineItem[],
  settings: DealSettings,
  signed?: Selections | null
): InternalDoc {
  const chosen: Selections = signed ?? {
    items: items.filter((i) => !i.optional || i.selected_by_default).map((i) => i.id),
  };
  // Tiers by default: the selected_by_default one (or the first) per branch.
  if (!signed) {
    const seen = new Set<string>();
    chosen.items = chosen.items.filter((id) => {
      const it = items.find((i) => i.id === id)!;
      if (!it.tier_name) return true;
      if (seen.has(it.branch)) return false;
      const tiers = items.filter((i) => i.branch === it.branch && i.tier_name);
      const pick = tiers.find((t) => t.selected_by_default) ?? tiers[0];
      if (pick.id !== id) return false;
      seen.add(it.branch);
      return true;
    });
  }
  const ids = new Set(chosen.items);
  const picked = sortItems(items.filter((i) => ids.has(i.id)));

  const breakdown = Array.from(new Set(picked.map((i) => i.branch))).map((branch) => {
    const list = picked.filter((i) => i.branch === branch);
    const t = totals(list);
    return {
      branch,
      one_time: t.oneTime,
      monthly: t.monthly,
      hourly: t.hourly.map((h) => ({ label: h.label, rate: Number(h.amount) })),
    };
  });

  const today = new Date().toISOString().slice(0, 10);
  const startMonth = ym(deal.target_start ?? deal.target_launch ?? deal.date_issued ?? today);
  const launchMonth = ym(deal.target_launch ?? deal.target_start ?? deal.date_issued ?? today);
  const earnEnds = ym(settings.earn_up_ends);

  const months: CashMonth[] = [];
  for (let n = 0; n < 12; n++) {
    const m = addMonths(startMonth, n);
    let oneTime = 0;
    let monthly = 0;
    let productized = 0;
    for (const i of picked) {
      let cash = 0;
      if (i.kind === "one_time") {
        if (m === startMonth) cash += Number(i.amount) / 2;
        if (m === launchMonth) cash += Number(i.amount) / 2;
        oneTime += cash;
      } else if (i.kind === "monthly" && m >= launchMonth) {
        cash = Number(i.amount);
        monthly += cash;
      }
      if (i.is_productized_tool) productized += cash;
    }
    const cash = round2(oneTime + monthly);
    months.push({
      month: m,
      oneTime: round2(oneTime),
      monthly: round2(monthly),
      cash,
      productized: round2(productized),
      commission: round2((cash * settings.commission_pct) / 100),
      earnUp: m <= earnEnds ? round2((cash * settings.earn_up_pct) / 100) : 0,
      toolBuilder: deal.tool_builder_id ? round2((productized * settings.tool_builder_pct) / 100) : 0,
    });
  }
  // A launch more than 12 months after the start would drop the second half;
  // say so through the month list (it simply isn't in the window).

  const sum = (k: keyof CashMonth) => round2(months.reduce((s, m) => s + (m[k] as number), 0));
  const management = round2((deal.est_management_hours ?? 0) * settings.management_hourly_rate);
  const projectRate = settings.project_hourly_rate;
  const project = projectRate == null ? null : round2((deal.est_project_hours ?? 0) * projectRate);
  const labor = project == null ? null : round2(management + project);
  const cash = sum("cash");
  const commission = sum("commission");
  const earnUp = sum("earnUp");
  const toolBuilder = sum("toolBuilder");
  const margin = labor == null ? null : round2(cash - commission - earnUp - toolBuilder - labor);

  return {
    basis: `Earn-up pool: ${settings.earn_up_pct}% of cash collected each month, through ${settings.earn_up_ends}. Commission: ${settings.commission_pct}% of cash collected each month, to the deal owner. Tool builder: ${settings.tool_builder_pct}% of cash from productized tool items.`,
    selection: signed ? "signed" : "default",
    breakdown,
    months,
    totals: { cash, commission, earnUp, toolBuilder, labor, margin },
    labor: {
      managementHours: deal.est_management_hours,
      managementRate: settings.management_hourly_rate,
      projectHours: deal.est_project_hours,
      projectRate,
      management,
      project,
    },
    marginIncomplete: projectRate == null,
    settings,
    ownerId: deal.owner_id,
    toolBuilderId: deal.tool_builder_id,
    startMonth,
    launchMonth,
  };
}
