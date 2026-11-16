// Team > Finance (migration 041). Pure functions only: the page loads the
// rows, everything here turns them into the P&L, client, pipeline and KPI
// numbers. Dates are "YYYY-MM-DD" calendar days (America/Chicago, the pay
// timezone; the caller passes `today`).

import type { Stage } from "@/lib/theme";

// ---------------------------------------------------------------------------
// Input shapes (the columns Finance reads)

export type FinanceProject = {
  id: string;
  client_name: string;
  branch: string | null;
  stage: Stage;
  build: boolean;
  build_value: number | null;
  subscription: boolean;
  subscription_value: number | null;
  // Subscription start: months billed count from here.
  deliver_date: string | null;
  payment_status: string | null;
  salesperson: string[];
  win_probability: number | null;
  expected_sub_months: number | null;
  related_party: boolean;
  created_at: string;
};

export type FinanceTransaction = {
  id: string;
  project_id: string | null;
  amount: number;
  date: string;
  payer: string | null;
  payee: string | null;
  notes: string | null;
};

export type FinanceTimeEntry = {
  project_id: string | null;
  entry_type: string;
  clock_in: string;
  clock_out: string | null;
  approved_at: string | null;
  net_minutes: number;
};

export type Expense = {
  id: string;
  name: string;
  monthly_amount: number;
  owner: string | null;
  category: "tools" | "sales" | "other";
  active: boolean;
  start_date: string | null;
  notes: string | null;
  created_at: string;
};

export type FinanceSettings = {
  project_hourly_rate: number | null;
  assumed_labor_pct: number;
  payment_fee_pct: number;
  commission_pct: number;
  default_sub_months: number;
  stage_probability: Record<string, number>;
};

export const DEFAULT_FINANCE_SETTINGS: FinanceSettings = {
  project_hourly_rate: 60,
  assumed_labor_pct: 32.5,
  payment_fee_pct: 2.5,
  commission_pct: 10,
  default_sub_months: 12,
  stage_probability: { Interested: 20, Negotiation: 60, Signed: 90 },
};

// Labor % above this is over target (target 25 to 40% of revenue).
export const LABOR_PCT_LIMIT = 40;

export const PIPELINE_STAGES: Stage[] = ["Interested", "Negotiation", "Signed"];

// ---------------------------------------------------------------------------
// Periods

export type PeriodKind = "all" | "90d" | "ytd" | "next12";

export const PERIOD_OPTIONS: { value: PeriodKind; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "90d", label: "Last 90 days" },
  { value: "ytd", label: "Year to date" },
  { value: "next12", label: "Next 12 months pipeline" },
];

export type Period = {
  kind: PeriodKind;
  start: string;
  end: string;
  months: number;
  // next12: looks forward (recurring + pipeline), nothing collected yet.
  forward: boolean;
};

const DAY_MS = 86_400_000;
const AVG_MONTH_DAYS = 365.25 / 12;

function dayNumber(date: string) {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function addDays(date: string, days: number) {
  return new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function resolvePeriod(kind: PeriodKind, today: string, earliest: string | null): Period {
  let start: string;
  let end = today;
  switch (kind) {
    case "90d":
      start = addDays(today, -89);
      break;
    case "ytd":
      start = `${today.slice(0, 4)}-01-01`;
      break;
    case "next12":
      return { kind, start: today, end: addDays(today, 364), months: 12, forward: true };
    default:
      start = earliest && earliest < today ? earliest.slice(0, 10) : today;
      end = today;
  }
  const days = dayNumber(end) - dayNumber(start) + 1;
  return { kind, start, end, months: round2(days / AVG_MONTH_DAYS), forward: false };
}

export function inPeriod(date: string, period: Pick<Period, "start" | "end">) {
  const d = date.slice(0, 10);
  return d >= period.start && d <= period.end;
}

// ---------------------------------------------------------------------------
// Building blocks

// Client payments: payee is null (payouts to team members carry a payee).
export function isClientPayment(t: Pick<FinanceTransaction, "payee">) {
  return t.payee == null;
}

export function revenueCollected(txs: Pick<FinanceTransaction, "amount" | "payee">[]) {
  return round2(txs.filter(isClientPayment).reduce((s, t) => s + Number(t.amount || 0), 0));
}

export function collectedByProject(txs: FinanceTransaction[]) {
  const map = new Map<string, number>();
  for (const t of txs) {
    if (!isClientPayment(t) || !t.project_id) continue;
    map.set(t.project_id, (map.get(t.project_id) ?? 0) + Number(t.amount || 0));
  }
  return map;
}

// Hours that count toward pay (project entries always, management once
// approved), closed entries only, by project. Optionally limited to entries
// clocked in during `period`.
export function approvedHoursByProject(
  entries: FinanceTimeEntry[],
  period?: Pick<Period, "start" | "end">
) {
  const map = new Map<string, number>();
  for (const e of entries) {
    if (!e.project_id || e.clock_out === null) continue;
    if (e.entry_type === "management" && e.approved_at === null) continue;
    if (period && !inPeriod(e.clock_in, period)) continue;
    map.set(e.project_id, (map.get(e.project_id) ?? 0) + e.net_minutes / 60);
  }
  return map;
}

export type LaborScenario = 25 | 32.5 | 40 | "actual";

export const LABOR_SCENARIOS: { value: LaborScenario; label: string }[] = [
  { value: 25, label: "25%" },
  { value: 32.5, label: "32.5%" },
  { value: 40, label: "40%" },
  { value: "actual", label: "Actual hours" },
];

export type LaborMethod = "actual" | "assumed";

// Labor for one project: approved hours x rate when hours are logged (and a
// rate is set), otherwise revenue x the assumed %. A fixed % scenario applies
// that % to every project.
export function projectLabor(args: {
  revenue: number;
  hours: number;
  hourlyRate: number | null;
  assumedPct: number;
  scenario: LaborScenario;
}): { labor: number; method: LaborMethod } {
  const { revenue, hours, hourlyRate, assumedPct, scenario } = args;
  if (scenario !== "actual") {
    return { labor: round2((revenue * scenario) / 100), method: "assumed" };
  }
  if (hours > 0 && hourlyRate != null) {
    return { labor: round2(hours * hourlyRate), method: "actual" };
  }
  return { labor: round2((revenue * assumedPct) / 100), method: "assumed" };
}

export type PnL = {
  revenue: number;
  labor: number;
  fees: number;
  grossProfit: number;
  grossMarginPct: number | null;
  commission: number;
  contribution: number;
  overhead: number | null;
  netProfit: number;
  marginPct: number | null;
};

// Gross profit = revenue - labor - payment fees. Contribution = gross profit
// - commission. Net = contribution - overhead (null overhead = not charged,
// e.g. the pipeline column).
export function buildPnL(args: {
  revenue: number;
  labor: number;
  feePct: number;
  commissionPct: number;
  overhead: number | null;
}): PnL {
  const { revenue, labor, feePct, commissionPct, overhead } = args;
  const fees = round2((revenue * feePct) / 100);
  const grossProfit = round2(revenue - labor - fees);
  const commission = round2((revenue * commissionPct) / 100);
  const contribution = round2(grossProfit - commission);
  const netProfit = round2(contribution - (overhead ?? 0));
  return {
    revenue: round2(revenue),
    labor: round2(labor),
    fees,
    grossProfit,
    grossMarginPct: revenue > 0 ? round2((grossProfit / revenue) * 100) : null,
    commission,
    contribution,
    overhead: overhead == null ? null : round2(overhead),
    netProfit,
    marginPct: revenue > 0 ? round2((netProfit / revenue) * 100) : null,
  };
}

export function monthlyOverhead(expenses: Pick<Expense, "monthly_amount" | "active" | "category">[], category?: Expense["category"]) {
  return round2(
    expenses
      .filter((e) => e.active && (!category || e.category === category))
      .reduce((s, e) => s + Number(e.monthly_amount || 0), 0)
  );
}

// Monthly invoices due from deliver_date through today (the first month
// counts as soon as it starts). No start date or a future one: 0.
export function monthsBilled(deliverDate: string | null, today: string) {
  if (!deliverDate || deliverDate.slice(0, 10) > today) return 0;
  const [sy, sm, sd] = deliverDate.slice(0, 10).split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let months = (ty - sy) * 12 + (tm - sm);
  if (td < sd) months -= 1;
  return Math.max(0, months) + 1;
}

export function buildValueOf(p: Pick<FinanceProject, "build" | "build_value">) {
  return p.build ? Number(p.build_value ?? 0) : 0;
}

export function subValueOf(p: Pick<FinanceProject, "subscription" | "subscription_value">) {
  return p.subscription ? Number(p.subscription_value ?? 0) : 0;
}

// What should have been collected: build value + months billed x monthly.
export function expectedCollected(p: FinanceProject, today: string) {
  return round2(buildValueOf(p) + monthsBilled(p.deliver_date, today) * subValueOf(p));
}

const BILLING_STAGES: Stage[] = ["Signed", "In Progress", "Subscriber", "Complete"];

export type Mismatch = { project: FinanceProject; collected: number; expected: number };

// Projects whose collected total doesn't match build value + months billed x
// subscription. Only projects that are billing (Signed onward, or any money
// received); Lost and pipeline projects with nothing collected are skipped.
export function collectionMismatches(
  projects: FinanceProject[],
  collected: Map<string, number>,
  today: string
): Mismatch[] {
  const out: Mismatch[] = [];
  for (const p of projects) {
    const got = round2(collected.get(p.id) ?? 0);
    if (!BILLING_STAGES.includes(p.stage) && got === 0) continue;
    const expected = expectedCollected(p, today);
    if (Math.abs(got - expected) >= 1) out.push({ project: p, collected: got, expected });
  }
  return out;
}

// After recording a payment: collected (incl. the new one) >= build value ->
// Paid, otherwise Deposit Paid. No build value: leave the status alone.
export function paymentStatusAfter(collectedTotal: number, buildValue: number | null) {
  if (!buildValue || buildValue <= 0) return null;
  return collectedTotal >= buildValue ? "Paid" : "Deposit Paid";
}

// ---------------------------------------------------------------------------
// Pipeline and recurring

export function subMonths(p: Pick<FinanceProject, "expected_sub_months">, settings: FinanceSettings) {
  return p.expected_sub_months ?? settings.default_sub_months;
}

export function pipelineValue(p: FinanceProject, settings: FinanceSettings) {
  return round2(buildValueOf(p) + subValueOf(p) * subMonths(p, settings));
}

export function winProbability(p: FinanceProject, settings: FinanceSettings) {
  if (p.win_probability != null) return { pct: Number(p.win_probability), source: "project" as const };
  return { pct: Number(settings.stage_probability[p.stage] ?? 0), source: "stage" as const };
}

export type PipelineRow = {
  project: FinanceProject;
  value: number;
  probability: number;
  probabilitySource: "project" | "stage";
  weighted: number;
};

export function pipelineRows(projects: FinanceProject[], settings: FinanceSettings): PipelineRow[] {
  return projects
    .filter((p) => PIPELINE_STAGES.includes(p.stage))
    .map((p) => {
      const value = pipelineValue(p, settings);
      const { pct, source } = winProbability(p, settings);
      return { project: p, value, probability: pct, probabilitySource: source, weighted: round2((value * pct) / 100) };
    })
    .sort((a, b) => b.weighted - a.weighted);
}

// Active subscribers: monthly x remaining months. Remaining = expected
// length - months billed when the project sets one, else the default
// (12). `capMonths` limits it (next 12 months view).
export function forwardRecurring(
  p: FinanceProject,
  settings: FinanceSettings,
  today: string,
  capMonths?: number
) {
  if (p.stage !== "Subscriber") return 0;
  const monthly = subValueOf(p);
  if (monthly <= 0) return 0;
  let remaining =
    p.expected_sub_months != null
      ? Math.max(0, p.expected_sub_months - monthsBilled(p.deliver_date, today))
      : settings.default_sub_months;
  if (capMonths != null) remaining = Math.min(remaining, capMonths);
  return round2(monthly * remaining);
}

// ---------------------------------------------------------------------------
// Clients

export function clientKey(name: string) {
  return name.trim().toLowerCase();
}

export type ClientRow = {
  key: string;
  name: string;
  branches: string[];
  projectIds: string[];
  collected: number;
  allTimeCollected: number;
  mrr: number;
  forward: number;
  labor: number;
  laborMethod: "actual" | "assumed" | "mixed";
  laborPct: number | null;
  fees: number;
  grossMargin: number;
  grossMarginPct: number | null;
  relatedParty: boolean;
  firstCreatedAt: string;
};

export type FinanceInput = {
  projects: FinanceProject[];
  transactions: FinanceTransaction[];
  timeEntries: FinanceTimeEntry[];
  expenses: Expense[];
  settings: FinanceSettings;
  period: PeriodKind;
  scenario: LaborScenario;
  today: string;
};

export type FinanceModel = {
  period: Period;
  collected: PnL;
  pipeline: PnL;
  weightedPipeline: number;
  pipelineRows: PipelineRow[];
  clients: ClientRow[];
  unassignedRevenue: number;
  forwardRecurringTotal: number;
  allTimeCollected: number;
  ltv: number | null;
  cac: number | null;
  ltvToCac: number | null;
  newClients: number;
  acquisitionSpend: number;
  mismatches: Mismatch[];
  monthlyOverhead: number;
};

export function computeFinance(input: FinanceInput): FinanceModel {
  const { projects, transactions, timeEntries, expenses, settings, scenario, today } = input;
  const payments = transactions.filter(isClientPayment);
  const earliest = payments.reduce<string | null>(
    (min, t) => (min === null || t.date < min ? t.date.slice(0, 10) : min),
    null
  );
  const period = resolvePeriod(input.period, today, earliest);
  // A forward period has no collected cash: its first column is the next 12
  // months of recurring revenue, and LTV/CAC use all time.
  const backPeriod = period.forward ? resolvePeriod("all", today, earliest) : period;

  const periodPayments = period.forward ? [] : payments.filter((t) => inPeriod(t.date, period));
  const collectedPeriod = collectedByProject(periodPayments);
  const collectedAll = collectedByProject(payments);
  const hours = approvedHoursByProject(timeEntries, period.forward ? undefined : period);
  const rate = settings.project_hourly_rate;

  // Group projects into clients by name.
  const groups = new Map<string, FinanceProject[]>();
  for (const p of projects) {
    const key = clientKey(p.client_name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  const clients: ClientRow[] = [];
  let laborTotal = 0;
  for (const [key, ps] of Array.from(groups.entries())) {
    let collected = 0;
    let allTime = 0;
    let mrr = 0;
    let forward = 0;
    let labor = 0;
    const methods = new Set<LaborMethod>();
    for (const p of ps) {
      const fwd12 = forwardRecurring(p, settings, today, 12);
      const rev = period.forward ? fwd12 : collectedPeriod.get(p.id) ?? 0;
      collected += rev;
      allTime += collectedAll.get(p.id) ?? 0;
      if (p.stage === "Subscriber") mrr += subValueOf(p);
      forward += forwardRecurring(p, settings, today);
      if (rev > 0) {
        const l = projectLabor({
          revenue: rev,
          hours: period.forward ? 0 : hours.get(p.id) ?? 0,
          hourlyRate: rate,
          assumedPct: settings.assumed_labor_pct,
          scenario,
        });
        labor += l.labor;
        methods.add(l.method);
      }
    }
    if (collected === 0 && allTime === 0 && mrr === 0) continue;
    laborTotal += labor;
    const fees = round2((collected * settings.payment_fee_pct) / 100);
    const grossMargin = round2(collected - labor - fees);
    clients.push({
      key,
      name: ps[0].client_name.trim(),
      branches: Array.from(new Set(ps.map((p) => p.branch).filter((b): b is string => !!b))).sort(),
      projectIds: ps.map((p) => p.id),
      collected: round2(collected),
      allTimeCollected: round2(allTime),
      mrr: round2(mrr),
      forward: round2(forward),
      labor: round2(labor),
      laborMethod: methods.size === 2 ? "mixed" : methods.has("actual") ? "actual" : "assumed",
      laborPct: collected > 0 ? round2((labor / collected) * 100) : null,
      fees,
      grossMargin,
      grossMarginPct: collected > 0 ? round2((grossMargin / collected) * 100) : null,
      relatedParty: ps.some((p) => p.related_party),
      firstCreatedAt: ps.reduce((min, p) => (p.created_at < min ? p.created_at : min), ps[0].created_at),
    });
  }
  clients.sort((a, b) => b.collected - a.collected || b.allTimeCollected - a.allTimeCollected);

  // Payments with no project (or a deleted one): revenue, labor at the
  // assumed %, no client row.
  const projectIds = new Set(projects.map((p) => p.id));
  const unassignedRevenue = period.forward
    ? 0
    : round2(
        periodPayments
          .filter((t) => !t.project_id || !projectIds.has(t.project_id))
          .reduce((s, t) => s + Number(t.amount || 0), 0)
      );
  if (unassignedRevenue > 0) {
    laborTotal += projectLabor({
      revenue: unassignedRevenue,
      hours: 0,
      hourlyRate: rate,
      assumedPct: settings.assumed_labor_pct,
      scenario,
    }).labor;
  }

  const revenue = round2(clients.reduce((s, c) => s + c.collected, 0) + unassignedRevenue);
  const overheadMonthly = monthlyOverhead(expenses);
  const collected = buildPnL({
    revenue,
    labor: laborTotal,
    feePct: settings.payment_fee_pct,
    commissionPct: settings.commission_pct,
    overhead: overheadMonthly * period.months,
  });

  // Pipeline column: weighted value, labor at the scenario % (actual hours
  // don't exist yet for unsold work, so "actual" uses the assumed %).
  const rows = pipelineRows(projects, settings);
  const weightedPipeline = round2(rows.reduce((s, r) => s + r.weighted, 0));
  const pipelinePct = scenario === "actual" ? settings.assumed_labor_pct : scenario;
  const pipeline = buildPnL({
    revenue: weightedPipeline,
    labor: (weightedPipeline * pipelinePct) / 100,
    feePct: settings.payment_fee_pct,
    commissionPct: settings.commission_pct,
    overhead: null,
  });

  // LTV: average lifetime revenue per client (all-time collected + forward
  // recurring), related parties excluded, times gross margin %.
  const allTimePnL = period.forward
    ? computeFinance({ ...input, period: "all" }).collected
    : null;
  const gmPct = (allTimePnL ?? collected).grossMarginPct;
  const ltvClients = clients.filter((c) => !c.relatedParty && c.allTimeCollected + c.forward > 0);
  const avgLifetime = ltvClients.length
    ? ltvClients.reduce((s, c) => s + c.allTimeCollected + c.forward, 0) / ltvClients.length
    : null;
  const ltv = avgLifetime != null && gmPct != null ? round2((avgLifetime * gmPct) / 100) : null;

  // CAC: (commission + sales expenses over the period) / new clients: paying
  // or subscribing companies whose first project was created in the period,
  // related parties excluded.
  const backCommission = allTimePnL ? allTimePnL.commission : collected.commission;
  const acquisitionSpend = round2(backCommission + monthlyOverhead(expenses, "sales") * backPeriod.months);
  const newClients = clients.filter(
    (c) => !c.relatedParty && c.allTimeCollected + c.mrr > 0 && inPeriod(c.firstCreatedAt, backPeriod)
  ).length;
  const cac = newClients > 0 ? round2(acquisitionSpend / newClients) : null;

  return {
    period,
    collected,
    pipeline,
    weightedPipeline,
    pipelineRows: rows,
    clients,
    unassignedRevenue,
    forwardRecurringTotal: round2(projects.reduce((s, p) => s + forwardRecurring(p, settings, today), 0)),
    allTimeCollected: revenueCollected(payments),
    ltv,
    cac,
    ltvToCac: ltv != null && cac != null && cac > 0 ? round2(ltv / cac) : null,
    newClients,
    acquisitionSpend,
    mismatches: collectionMismatches(projects, collectedAll, today),
    monthlyOverhead: overheadMonthly,
  };
}

// Settings row -> FinanceSettings, filling anything missing (before 041 is
// applied) with the defaults.
export function financeSettingsFrom(row: Partial<Record<keyof FinanceSettings, unknown>> | null): FinanceSettings {
  const d = DEFAULT_FINANCE_SETTINGS;
  const num = (v: unknown, fallback: number) => (v == null || v === "" || isNaN(Number(v)) ? fallback : Number(v));
  const probs = row?.stage_probability;
  return {
    project_hourly_rate: row?.project_hourly_rate == null ? null : Number(row.project_hourly_rate),
    assumed_labor_pct: num(row?.assumed_labor_pct, d.assumed_labor_pct),
    payment_fee_pct: num(row?.payment_fee_pct, d.payment_fee_pct),
    commission_pct: num(row?.commission_pct, d.commission_pct),
    default_sub_months: num(row?.default_sub_months, d.default_sub_months),
    stage_probability:
      probs && typeof probs === "object" ? (probs as Record<string, number>) : d.stage_probability,
  };
}
