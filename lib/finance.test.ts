import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FINANCE_SETTINGS,
  buildPnL,
  collectionMismatches,
  computeFinance,
  forwardRecurring,
  monthsBilled,
  paymentStatusAfter,
  pipelineRows,
  projectLabor,
  resolvePeriod,
  revenueCollected,
  financeSettingsFrom,
  type Expense,
  type FinanceProject,
  type FinanceTimeEntry,
  type FinanceTransaction,
} from "@/lib/finance";

const settings = DEFAULT_FINANCE_SETTINGS;
const today = "2026-11-15";

function project(p: Partial<FinanceProject> & { id: string }): FinanceProject {
  return {
    client_name: p.id,
    branch: "Websites",
    stage: "In Progress",
    build: false,
    build_value: null,
    subscription: false,
    subscription_value: null,
    deliver_date: null,
    payment_status: null,
    salesperson: [],
    win_probability: null,
    expected_sub_months: null,
    related_party: false,
    created_at: "2026-09-01T00:00:00Z",
    ...p,
  };
}

let n = 0;
function tx(project_id: string | null, amount: number, date = "2026-10-01", payee: string | null = null): FinanceTransaction {
  return { id: `t${++n}`, project_id, amount, date, payer: null, payee, notes: null };
}

const expense = (monthly_amount: number, category: Expense["category"] = "tools", active = true): Expense => ({
  id: `e${++n}`,
  name: "x",
  monthly_amount,
  owner: null,
  category,
  active,
  start_date: null,
  notes: null,
  created_at: "",
});

test("revenue collected counts client payments only (payee null)", () => {
  assert.equal(revenueCollected([tx("a", 1000), tx("a", 500), tx(null, 300, "2026-10-01", "member")]), 1500);
});

test("labor: actual hours x rate when logged, else assumed %", () => {
  assert.deepEqual(
    projectLabor({ revenue: 10000, hours: 20, hourlyRate: 60, assumedPct: 32.5, scenario: "actual" }),
    { labor: 1200, method: "actual" }
  );
  assert.deepEqual(
    projectLabor({ revenue: 10000, hours: 0, hourlyRate: 60, assumedPct: 32.5, scenario: "actual" }),
    { labor: 3250, method: "assumed" }
  );
  // A fixed scenario overrides logged hours.
  assert.deepEqual(
    projectLabor({ revenue: 10000, hours: 20, hourlyRate: 60, assumedPct: 32.5, scenario: 40 }),
    { labor: 4000, method: "assumed" }
  );
});

test("P&L: gross profit, contribution, net, margins", () => {
  const p = buildPnL({ revenue: 10000, labor: 3250, feePct: 2.5, commissionPct: 10, overhead: 1000 });
  assert.equal(p.fees, 250);
  assert.equal(p.grossProfit, 6500);
  assert.equal(p.grossMarginPct, 65);
  assert.equal(p.commission, 1000);
  assert.equal(p.contribution, 5500);
  assert.equal(p.netProfit, 4500);
  assert.equal(p.marginPct, 45);
  assert.equal(buildPnL({ revenue: 0, labor: 0, feePct: 2.5, commissionPct: 10, overhead: 0 }).grossMarginPct, null);
});

test("periods", () => {
  assert.deepEqual(resolvePeriod("ytd", today, null).start, "2026-01-01");
  assert.equal(resolvePeriod("90d", today, null).start, "2026-08-18");
  assert.equal(resolvePeriod("all", today, "2026-03-01").start, "2026-03-01");
  const fwd = resolvePeriod("next12", today, null);
  assert.equal(fwd.forward, true);
  assert.equal(fwd.months, 12);
});

test("months billed from deliver_date", () => {
  assert.equal(monthsBilled(null, today), 0);
  assert.equal(monthsBilled("2026-12-01", today), 0);
  assert.equal(monthsBilled("2026-11-15", today), 1);
  assert.equal(monthsBilled("2026-09-01", today), 3);
  assert.equal(monthsBilled("2026-09-20", today), 2);
});

test("pipeline: value with sub months, stage or project probability", () => {
  const rows = pipelineRows(
    [
      project({ id: "a", stage: "Interested", build: true, build_value: 5000 }),
      project({ id: "b", stage: "Negotiation", subscription: true, subscription_value: 1000, expected_sub_months: 6, win_probability: 50 }),
      project({ id: "c", stage: "In Progress", build: true, build_value: 9999 }),
    ],
    settings
  );
  assert.equal(rows.length, 2);
  const a = rows.find((r) => r.project.id === "a")!;
  const b = rows.find((r) => r.project.id === "b")!;
  assert.equal(a.value, 5000);
  assert.equal(a.probability, 20);
  assert.equal(a.probabilitySource, "stage");
  assert.equal(a.weighted, 1000);
  assert.equal(b.value, 6000);
  assert.equal(b.weighted, 3000);
  assert.equal(b.probabilitySource, "project");
});

test("forward recurring: subscribers only, remaining months", () => {
  const sub = project({ id: "s", stage: "Subscriber", subscription: true, subscription_value: 500 });
  assert.equal(forwardRecurring(sub, settings, today), 6000);
  assert.equal(
    forwardRecurring({ ...sub, expected_sub_months: 6, deliver_date: "2026-09-01" }, settings, today),
    1500
  );
  assert.equal(forwardRecurring({ ...sub, stage: "Complete" }, settings, today), 0);
});

test("payment status after recording a payment", () => {
  assert.equal(paymentStatusAfter(5000, 5000), "Paid");
  assert.equal(paymentStatusAfter(2500, 5000), "Deposit Paid");
  assert.equal(paymentStatusAfter(2500, null), null);
});

test("mismatch: collected vs build + months billed x sub", () => {
  const ok = project({ id: "ok", build: true, build_value: 4000 });
  const short = project({ id: "short", build: true, build_value: 4000 });
  const sub = project({ id: "sub", stage: "Subscriber", subscription: true, subscription_value: 500, deliver_date: "2026-10-01" });
  const pipe = project({ id: "pipe", stage: "Interested", build: true, build_value: 4000 });
  const collected = new Map([["ok", 4000], ["short", 2000], ["sub", 1000]]);
  const m = collectionMismatches([ok, short, sub, pipe], collected, today);
  assert.deepEqual(m.map((x) => x.project.id), ["short"]);
});

test("computeFinance: totals, clients, labor flag, LTV, CAC", () => {
  const projects = [
    project({ id: "a1", client_name: "Acme", branch: "Websites", build: true, build_value: 10000, created_at: "2026-10-01T00:00:00Z" }),
    project({ id: "a2", client_name: " acme ", branch: "Media", stage: "Subscriber", subscription: true, subscription_value: 1000, deliver_date: "2026-10-01", created_at: "2026-10-02T00:00:00Z" }),
    project({ id: "g", client_name: "Grad Gig", related_party: true, build: true, build_value: 2000 }),
    project({ id: "p", client_name: "Prospect", stage: "Signed", build: true, build_value: 10000 }),
  ];
  const transactions = [
    tx("a1", 10000, "2026-10-05"),
    tx("a2", 1000, "2026-10-01"),
    tx("a2", 1000, "2026-11-01"),
    tx("g", 2000, "2026-10-10"),
    tx(null, 500, "2026-10-12", "someone"), // payout, not revenue
  ];
  const timeEntries: FinanceTimeEntry[] = [
    { project_id: "a1", entry_type: "project", clock_in: "2026-10-03T15:00:00Z", clock_out: "2026-10-03T20:00:00Z", approved_at: null, net_minutes: 600 },
    { project_id: "a1", entry_type: "project", clock_in: "2026-10-04T15:00:00Z", clock_out: null, approved_at: null, net_minutes: 600 },
  ];
  const expenses = [expense(500), expense(100, "sales"), expense(999, "tools", false)];

  const m = computeFinance({ projects, transactions, timeEntries, expenses, settings, period: "all", scenario: "actual", today });

  assert.equal(m.collected.revenue, 14000);
  assert.equal(m.allTimeCollected, 14000);
  // a1: 10 h x 60 = 600 actual; a2: 2000 x 32.5% = 650; g: 2000 x 32.5% = 650.
  assert.equal(m.collected.labor, 1900);
  const acme = m.clients.find((c) => c.key === "acme")!;
  assert.deepEqual(acme.branches, ["Media", "Websites"]);
  assert.equal(acme.collected, 12000);
  assert.equal(acme.laborMethod, "mixed");
  assert.equal(acme.mrr, 1000);
  assert.equal(acme.forward, 12000);
  assert.ok(m.clients.find((c) => c.key === "grad gig")!.relatedParty);

  // Weighted pipeline: Signed 90% of 10,000.
  assert.equal(m.weightedPipeline, 9000);

  // Overhead: 600/month over the period since the first payment (Oct 1).
  assert.equal(m.monthlyOverhead, 600);
  assert.equal(m.collected.overhead, Math.round(600 * m.period.months * 100) / 100);

  // LTV: Acme only (Grad Gig excluded): (12,000 + 12,000) x GM%.
  const gm = m.collected.grossMarginPct!;
  assert.equal(m.ltv, Math.round(24000 * gm) / 100);

  // CAC: only Acme is a new paying client (Prospect hasn't paid, Grad Gig is excluded).
  assert.equal(m.newClients, 1);
  assert.equal(m.acquisitionSpend, Math.round((m.collected.commission + 100 * m.period.months) * 100) / 100);
  assert.equal(m.cac, m.acquisitionSpend);
  assert.ok(m.ltvToCac! > 0);

  // Fixed scenario: every project at 25%.
  const s25 = computeFinance({ projects, transactions, timeEntries, expenses, settings, period: "all", scenario: 25, today });
  assert.equal(s25.collected.labor, 3500);
});

test("computeFinance: next 12 months uses recurring, not collected", () => {
  const projects = [project({ id: "s", stage: "Subscriber", subscription: true, subscription_value: 500 })];
  const m = computeFinance({
    projects,
    transactions: [tx("s", 500, "2026-11-01")],
    timeEntries: [],
    expenses: [expense(100)],
    settings,
    period: "next12",
    scenario: "actual",
    today,
  });
  assert.equal(m.collected.revenue, 6000);
  assert.equal(m.collected.overhead, 1200);
  assert.equal(m.allTimeCollected, 500);
});

test("settings row fallbacks", () => {
  const s = financeSettingsFrom({ project_hourly_rate: 60, commission_pct: 10 });
  assert.equal(s.assumed_labor_pct, 32.5);
  assert.equal(s.stage_probability.Signed, 90);
});
