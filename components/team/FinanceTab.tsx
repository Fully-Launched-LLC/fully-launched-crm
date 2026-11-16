"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import StatTile from "@/components/dashboard/StatTile";
import { BRANCH_COLORS, STAGE_COLORS, type Branch } from "@/lib/theme";
import type { TeamMember } from "@/lib/types";
import {
  LABOR_PCT_LIMIT,
  LABOR_SCENARIOS,
  PERIOD_OPTIONS,
  collectedByProject,
  computeFinance,
  isClientPayment,
  paymentStatusAfter,
  type Expense,
  type FinanceProject,
  type FinanceSettings,
  type FinanceTimeEntry,
  type FinanceTransaction,
  type LaborScenario,
  type PeriodKind,
  type PnL,
} from "@/lib/finance";
import { pickableMembers } from "@/lib/team";

const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (n: number | null) => (n == null ? "n/a" : usd0.format(n));
const pct = (n: number | null) => (n == null ? "n/a" : `${n.toFixed(1)}%`);

const PAYMENT_METHODS = ["Stripe", "ACH", "Check", "Zelle", "Cash", "Other"];
const EXPENSE_CATEGORIES: Expense["category"][] = ["tools", "sales", "other"];

const input = "rounded border border-neutral-300 px-2 py-1.5 text-sm";
const cellInput = "w-full rounded border border-transparent px-1.5 py-1 text-sm hover:border-neutral-300 focus:border-neutral-300";

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {hint && <p className="mt-0.5 text-sm text-neutral-500">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Collapsible({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <details className="group mt-10">
      <summary className="cursor-pointer list-none">
        <span className="text-lg font-semibold text-foreground">
          <span className="mr-1 inline-block text-neutral-400 transition group-open:rotate-90">▸</span>
          {title}
        </span>
        {hint && <p className="mt-0.5 text-sm text-neutral-500">{hint}</p>}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function Toggle<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-neutral-300">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 text-sm ${
            o.value === value ? "bg-accent text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500";
const td = "px-3 py-2 align-top";

export default function FinanceTab({
  initialProjects,
  initialTransactions,
  timeEntries,
  initialExpenses,
  settings,
  members,
  isAdmin,
  today,
}: {
  initialProjects: FinanceProject[];
  initialTransactions: FinanceTransaction[];
  timeEntries: FinanceTimeEntry[];
  initialExpenses: Expense[];
  settings: FinanceSettings;
  members: TeamMember[];
  isAdmin: boolean;
  today: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [projects, setProjects] = useState(initialProjects);
  const [transactions, setTransactions] = useState(initialTransactions);
  const [expenses, setExpenses] = useState(initialExpenses);
  const [period, setPeriod] = useState<PeriodKind>("all");
  const [scenario, setScenario] = useState<LaborScenario>("actual");
  const [error, setError] = useState<string | null>(null);

  const m = useMemo(
    () => computeFinance({ projects, transactions, timeEntries, expenses, settings, period, scenario, today }),
    [projects, transactions, timeEntries, expenses, settings, period, scenario, today]
  );
  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const memberName = useMemo(() => new Map(members.map((mm) => [mm.id, mm.name])), [members]);

  const forward = m.period.forward;
  const collectedLabel = forward ? "Recurring (next 12 mo)" : "Collected";

  // ---- Pipeline probability ------------------------------------------------
  async function saveProbability(id: string, raw: string) {
    const value = raw.trim() === "" ? null : Number(raw);
    if (value != null && (isNaN(value) || value < 0 || value > 100)) {
      setError("Probability must be between 0 and 100.");
      return;
    }
    const previous = projects;
    setProjects((ps) => ps.map((p) => (p.id === id ? { ...p, win_probability: value } : p)));
    const { data, error } = await supabase.from("projects").update({ win_probability: value }).eq("id", id).select("id");
    if (error || !data?.length) {
      setProjects(previous);
      setError(error?.message ?? "Probability not saved (no access to this project).");
    }
  }

  // ---- Record payment -------------------------------------------------------
  const [pay, setPay] = useState({ project_id: "", amount: "", date: today, payer: "", method: "Stripe" });
  const [payBusy, setPayBusy] = useState(false);
  const [payMsg, setPayMsg] = useState<string | null>(null);

  async function recordPayment(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPayMsg(null);
    const amount = Number(pay.amount);
    if (!pay.project_id) return setError("Pick a project.");
    if (!(amount > 0)) return setError("Enter an amount above 0.");
    setPayBusy(true);
    const { data, error } = await supabase
      .from("transactions")
      .insert({
        project_id: pay.project_id,
        amount,
        date: pay.date,
        payer: pay.payer.trim() || null,
        payee: null,
        notes: `Method: ${pay.method}`,
      })
      .select("id, project_id, amount, date, payer, payee, notes")
      .single();
    if (error || !data) {
      setPayBusy(false);
      return setError(error?.message ?? "Payment not recorded.");
    }
    const next = [data as FinanceTransaction, ...transactions];
    setTransactions(next);

    const project = projectsById.get(pay.project_id);
    const total = collectedByProject(next).get(pay.project_id) ?? 0;
    const status = paymentStatusAfter(total, project?.build_value ?? null);
    let msg = `Recorded ${usd2.format(amount)} for ${project?.client_name ?? "the project"}.`;
    if (status && project) {
      const { data: upd, error: uerr } = await supabase
        .from("projects")
        .update({ payment_status: status })
        .eq("id", project.id)
        .select("id");
      if (uerr || !upd?.length) {
        msg += ` Payment status not updated: ${uerr?.message ?? "no access"}.`;
      } else {
        setProjects((ps) => ps.map((p) => (p.id === project.id ? { ...p, payment_status: status } : p)));
        msg += ` Payment status: ${status}.`;
      }
    }
    setPayMsg(msg);
    setPay((p) => ({ ...p, amount: "", payer: "" }));
    setPayBusy(false);
  }

  // ---- Expenses ---------------------------------------------------------------
  async function updateExpense(id: string, patch: Partial<Expense>) {
    const previous = expenses;
    setExpenses((es) => es.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const { data, error } = await supabase.from("expenses").update(patch).eq("id", id).select("id");
    if (error || !data?.length) {
      setExpenses(previous);
      setError(error?.message ?? "Expense not saved.");
    }
  }

  async function addExpense() {
    const { data, error } = await supabase
      .from("expenses")
      .insert({ name: "New expense", monthly_amount: 0, category: "tools" })
      .select("*")
      .single();
    if (error || !data) return setError(error?.message ?? "Could not add an expense.");
    setExpenses((es) => [...es, data as Expense]);
  }

  async function deleteExpense(id: string) {
    const previous = expenses;
    setExpenses((es) => es.filter((x) => x.id !== id));
    const { data, error } = await supabase.from("expenses").delete().eq("id", id).select("id");
    if (error || !data?.length) {
      setExpenses(previous);
      setError(error?.message ?? "Expense not deleted.");
    }
  }

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => a.client_name.localeCompare(b.client_name)),
    [projects]
  );
  const payments = transactions.filter(isClientPayment);

  // ---- P&L rows ---------------------------------------------------------------
  const pnlRows: { label: string; get: (p: PnL) => string; strong?: boolean }[] = [
    { label: "Revenue", get: (p) => money(p.revenue), strong: true },
    { label: "Labor", get: (p) => money(-p.labor) },
    { label: `Payment fees (${settings.payment_fee_pct}%)`, get: (p) => money(-p.fees) },
    { label: "Gross profit", get: (p) => money(p.grossProfit), strong: true },
    { label: "Gross margin %", get: (p) => pct(p.grossMarginPct) },
    { label: `Commission (${settings.commission_pct}%)`, get: (p) => money(-p.commission) },
    { label: "Overhead", get: (p) => (p.overhead == null ? "n/a" : money(-p.overhead)) },
    { label: "Net profit", get: (p) => money(p.netProfit), strong: true },
    { label: "Margin %", get: (p) => pct(p.marginPct) },
  ];

  return (
    <div className="pb-16">
      {m.mismatches.length > 0 && (
        <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">
            {m.mismatches.length} project{m.mismatches.length === 1 ? "" : "s"}: collected doesn&apos;t match build
            value + months billed x subscription.
          </p>
          <ul className="mt-1 space-y-0.5">
            {m.mismatches.slice(0, 6).map((x) => (
              <li key={x.project.id}>
                <Link href={`/project/${x.project.id}`} className="underline">
                  {x.project.client_name}
                </Link>
                : collected {money(x.collected)}, expected {money(x.expected)}
              </li>
            ))}
          </ul>
          {m.mismatches.length > 6 && <p className="mt-1">and {m.mismatches.length - 6} more.</p>}
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-start justify-between rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="ml-4 text-xs underline">
            Dismiss
          </button>
        </div>
      )}

      {/* 1. Controls */}
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-neutral-600">
          Period
          <select value={period} onChange={(e) => setPeriod(e.target.value as PeriodKind)} className={input}>
            {PERIOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2 text-sm text-neutral-600">
          Labor
          <Toggle options={LABOR_SCENARIOS} value={scenario} onChange={setScenario} />
        </div>
        <p className="text-xs text-neutral-500">
          {forward
            ? "Next 12 months of subscriber revenue; LTV and CAC use all time."
            : `${m.period.start} to ${m.period.end}, ${m.period.months.toFixed(1)} months.`}{" "}
          {scenario === "actual"
            ? `Actual hours x $${settings.project_hourly_rate ?? "?"}/hr where logged, else ${settings.assumed_labor_pct}% of revenue.`
            : `Labor at ${scenario}% of revenue.`}
        </p>
      </div>

      {/* 2. KPI tiles */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label={forward ? "Recurring, next 12 mo" : "Revenue collected"}
          value={money(m.collected.revenue)}
          sublabel={forward ? `${money(m.allTimeCollected)} collected all time` : undefined}
        />
        <StatTile label="Gross margin" value={pct(m.collected.grossMarginPct)} />
        <StatTile label="Net profit" value={money(m.collected.netProfit)} />
        <StatTile label="Profit margin" value={pct(m.collected.marginPct)} />
        <StatTile label="LTV" value={money(m.ltv)} sublabel="Avg lifetime revenue x gross margin" />
        <StatTile
          label="CAC"
          value={money(m.cac)}
          sublabel={`${m.newClients} new client${m.newClients === 1 ? "" : "s"}, ${money(m.acquisitionSpend)} spend`}
        />
        <StatTile label="LTV:CAC" value={m.ltvToCac == null ? "n/a" : `${m.ltvToCac.toFixed(1)}x`} />
        <StatTile label="Weighted pipeline" value={money(m.weightedPipeline)} />
      </div>

      {/* 3. P&L */}
      <Section
        title="P&L"
        hint={`Overhead: ${money(m.monthlyOverhead)}/month of active expenses x months in the period. Pipeline excludes overhead.`}
      >
        <div className="overflow-x-auto rounded-lg border border-neutral-200">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50">
                <th className={th} />
                <th className={`${th} text-right`}>{collectedLabel}</th>
                <th className={`${th} text-right`}>Pipeline (weighted)</th>
              </tr>
            </thead>
            <tbody>
              {pnlRows.map((r) => (
                <tr key={r.label} className={`border-b border-neutral-100 last:border-0 ${r.strong ? "font-semibold" : ""}`}>
                  <td className={td}>{r.label}</td>
                  <td className={`${td} text-right tabular-nums`}>{r.get(m.collected)}</td>
                  <td className={`${td} text-right tabular-nums`}>{r.get(m.pipeline)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {m.unassignedRevenue > 0 && (
          <p className="mt-2 text-xs text-neutral-500">
            Includes {money(m.unassignedRevenue)} in payments with no project (labor at the assumed %).
          </p>
        )}
      </Section>

      {/* 4. Clients */}
      <Section title="Clients" hint={`Grouped by company name across branches. Red: labor over ${LABOR_PCT_LIMIT}% of revenue.`}>
        <div className="overflow-x-auto rounded-lg border border-neutral-200">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50">
                <th className={th}>Client</th>
                <th className={th}>Branches</th>
                <th className={`${th} text-right`}>{collectedLabel}</th>
                <th className={`${th} text-right`}>MRR</th>
                <th className={`${th} text-right`}>Forward value</th>
                <th className={th}>Labor</th>
                <th className={`${th} text-right`}>Labor %</th>
                <th className={`${th} text-right`}>Gross margin</th>
              </tr>
            </thead>
            <tbody>
              {m.clients.map((c) => {
                const over = c.laborPct != null && c.laborPct > LABOR_PCT_LIMIT;
                return (
                  <tr key={c.key} className={`border-b border-neutral-100 last:border-0 ${over ? "bg-red-50" : ""}`}>
                    <td className={td}>
                      {c.projectIds.length === 1 ? (
                        <Link href={`/project/${c.projectIds[0]}`} className="font-medium hover:underline">
                          {c.name}
                        </Link>
                      ) : (
                        <span className="font-medium">{c.name}</span>
                      )}
                      {c.relatedParty && (
                        <span
                          className="ml-2 rounded-full border border-neutral-300 px-2 py-0.5 text-xs text-neutral-600"
                          title="Related party: excluded from LTV and CAC"
                        >
                          Related party
                        </span>
                      )}
                    </td>
                    <td className={td}>
                      <div className="flex flex-wrap gap-1">
                        {c.branches.map((b) => (
                          <span key={b} className={`rounded-full px-2 py-0.5 text-xs font-medium ${BRANCH_COLORS[b as Branch] ?? ""}`}>
                            {b}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{money(c.collected)}</td>
                    <td className={`${td} text-right tabular-nums`}>{c.mrr ? money(c.mrr) : ""}</td>
                    <td className={`${td} text-right tabular-nums`}>{c.forward ? money(c.forward) : ""}</td>
                    <td className={td}>{c.collected > 0 ? c.laborMethod : ""}</td>
                    <td className={`${td} text-right tabular-nums ${over ? "font-semibold text-red-700" : ""}`}>
                      {pct(c.laborPct)}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>
                      {c.collected > 0 ? `${money(c.grossMargin)} (${pct(c.grossMarginPct)})` : ""}
                    </td>
                  </tr>
                );
              })}
              {m.clients.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-neutral-400">
                    No collected revenue yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {/* 5. Pipeline */}
      <Section
        title="Pipeline"
        hint={`Interested, Negotiation and Signed. Value = build + monthly x ${settings.default_sub_months} months (or the project's own length). Clear a probability to use the stage default.`}
      >
        <div className="overflow-x-auto rounded-lg border border-neutral-200">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50">
                <th className={th}>Project</th>
                <th className={th}>Stage</th>
                <th className={`${th} text-right`}>Value</th>
                <th className={`${th} text-right`}>Probability</th>
                <th className={`${th} text-right`}>Weighted</th>
              </tr>
            </thead>
            <tbody>
              {m.pipelineRows.map((r) => (
                <tr key={r.project.id} className="border-b border-neutral-100 last:border-0">
                  <td className={td}>
                    <Link href={`/project/${r.project.id}`} className="hover:underline">
                      {r.project.client_name}
                    </Link>
                  </td>
                  <td className={td}>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_COLORS[r.project.stage]}`}>
                      {r.project.stage}
                    </span>
                  </td>
                  <td className={`${td} text-right tabular-nums`}>{money(r.value)}</td>
                  <td className={`${td} text-right`}>
                    <span className="inline-flex items-center gap-1">
                      <input
                        key={`${r.project.id}-${r.project.win_probability}`}
                        type="number"
                        min={0}
                        max={100}
                        defaultValue={r.project.win_probability ?? ""}
                        placeholder={String(r.probability)}
                        onBlur={(e) => {
                          const raw = e.target.value;
                          if (raw === String(r.project.win_probability ?? "")) return;
                          saveProbability(r.project.id, raw);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                        className="w-16 rounded border border-neutral-300 px-1.5 py-1 text-right text-sm tabular-nums"
                        aria-label={`Win probability for ${r.project.client_name}`}
                      />
                      %
                    </span>
                    {r.probabilitySource === "stage" && <p className="text-xs text-neutral-400">stage default</p>}
                  </td>
                  <td className={`${td} text-right tabular-nums`}>{money(r.weighted)}</td>
                </tr>
              ))}
              {m.pipelineRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-neutral-400">
                    No open pipeline.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {/* 6. Payments */}
      <Collapsible
        title={`Payments (${payments.length})`}
        hint={`${money(m.allTimeCollected)} collected all time. Client payments only (no payee).`}
      >
        {isAdmin ? (
          <form onSubmit={recordPayment} className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 p-4">
            <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
              Project
              <select
                value={pay.project_id}
                onChange={(e) => setPay({ ...pay, project_id: e.target.value })}
                className={`${input} min-w-[14rem]`}
                required
              >
                <option value="">Choose a project</option>
                {sortedProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.client_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
              Amount
              <input
                type="number"
                min={0}
                step="0.01"
                value={pay.amount}
                onChange={(e) => setPay({ ...pay, amount: e.target.value })}
                className={`${input} w-32`}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
              Date
              <input
                type="date"
                value={pay.date}
                onChange={(e) => setPay({ ...pay, date: e.target.value })}
                className={input}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
              Payer
              <input
                value={pay.payer}
                onChange={(e) => setPay({ ...pay, payer: e.target.value })}
                className={`${input} w-44`}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
              Method
              <select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} className={input}>
                {PAYMENT_METHODS.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={payBusy}
              className="rounded-md bg-header px-3 py-2 text-sm font-medium text-header-foreground disabled:opacity-50"
            >
              {payBusy ? "Recording..." : "Record payment"}
            </button>
            {payMsg && <p className="w-full text-sm text-green-700">{payMsg}</p>}
          </form>
        ) : (
          <p className="mb-3 text-sm text-neutral-500">Only Admins can record payments.</p>
        )}
        <div className="overflow-x-auto rounded-lg border border-neutral-200">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50">
                <th className={th}>Date</th>
                <th className={th}>Project</th>
                <th className={`${th} text-right`}>Amount</th>
                <th className={th}>Payer</th>
                <th className={th}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((t) => (
                <tr key={t.id} className="border-b border-neutral-100 last:border-0">
                  <td className={`${td} whitespace-nowrap`}>{t.date}</td>
                  <td className={td}>
                    {t.project_id && projectsById.get(t.project_id) ? (
                      <Link href={`/project/${t.project_id}`} className="hover:underline">
                        {projectsById.get(t.project_id)!.client_name}
                      </Link>
                    ) : (
                      <span className="text-neutral-400">No project</span>
                    )}
                  </td>
                  <td className={`${td} text-right tabular-nums`}>{usd2.format(Number(t.amount))}</td>
                  <td className={td}>{t.payer}</td>
                  <td className={`${td} text-neutral-500`}>{t.notes}</td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-neutral-400">
                    No payments yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Collapsible>

      {/* 7. Expenses */}
      <Collapsible
        title={`Expenses (${money(m.monthlyOverhead)}/month)`}
        hint="Active expenses count toward overhead; sales expenses also count toward CAC."
      >
        {isAdmin && (
          <div className="mb-3 flex justify-end">
            <button
              type="button"
              onClick={addExpense}
              className="rounded-md bg-header px-3 py-1.5 text-sm font-medium text-header-foreground"
            >
              + New expense
            </button>
          </div>
        )}
        <div className="overflow-x-auto rounded-lg border border-neutral-200">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50">
                <th className={th}>Name</th>
                <th className={`${th} text-right`}>Monthly</th>
                <th className={th}>Category</th>
                <th className={th}>Owner</th>
                <th className={th}>Active</th>
                <th className={th}>Start</th>
                <th className={th}>Notes</th>
                {isAdmin && <th className={th} />}
              </tr>
            </thead>
            <tbody>
              {expenses.map((x) =>
                isAdmin ? (
                  <tr key={x.id} className={`border-b border-neutral-100 last:border-0 ${x.active ? "" : "text-neutral-400"}`}>
                    <td className="px-1 py-1">
                      <input
                        defaultValue={x.name}
                        onBlur={(e) => e.target.value.trim() && e.target.value !== x.name && updateExpense(x.id, { name: e.target.value.trim() })}
                        className={cellInput}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        defaultValue={x.monthly_amount}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (e.target.value !== "" && v >= 0 && v !== Number(x.monthly_amount)) updateExpense(x.id, { monthly_amount: v });
                        }}
                        className={`${cellInput} w-24 text-right`}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <select
                        value={x.category}
                        onChange={(e) => updateExpense(x.id, { category: e.target.value as Expense["category"] })}
                        className={cellInput}
                      >
                        {EXPENSE_CATEGORIES.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      <select
                        value={x.owner ?? ""}
                        onChange={(e) => updateExpense(x.id, { owner: e.target.value || null })}
                        className={cellInput}
                      >
                        <option value="">None</option>
                        {pickableMembers(members, [x.owner]).map((mm) => (
                          <option key={mm.id} value={mm.id}>
                            {mm.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-1">
                      <input
                        type="checkbox"
                        checked={x.active}
                        onChange={(e) => updateExpense(x.id, { active: e.target.checked })}
                        aria-label={`${x.name} active`}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="date"
                        defaultValue={x.start_date ?? ""}
                        onBlur={(e) => e.target.value !== (x.start_date ?? "") && updateExpense(x.id, { start_date: e.target.value || null })}
                        className={cellInput}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        defaultValue={x.notes ?? ""}
                        onBlur={(e) => e.target.value !== (x.notes ?? "") && updateExpense(x.id, { notes: e.target.value.trim() || null })}
                        className={cellInput}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <button
                        type="button"
                        onClick={() => deleteExpense(x.id)}
                        className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={x.id} className={`border-b border-neutral-100 last:border-0 ${x.active ? "" : "text-neutral-400"}`}>
                    <td className={td}>{x.name}</td>
                    <td className={`${td} text-right tabular-nums`}>{usd2.format(Number(x.monthly_amount))}</td>
                    <td className={td}>{x.category}</td>
                    <td className={td}>{x.owner ? memberName.get(x.owner) ?? "" : ""}</td>
                    <td className={td}>{x.active ? "Yes" : "No"}</td>
                    <td className={td}>{x.start_date}</td>
                    <td className={td}>{x.notes}</td>
                  </tr>
                )
              )}
              {expenses.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 8 : 7} className="px-4 py-8 text-center text-neutral-400">
                    No expenses yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Collapsible>
    </div>
  );
}
