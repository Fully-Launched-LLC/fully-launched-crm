import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeamMember } from "@/lib/auth";
import { payDateOf } from "@/lib/timeclock";
import {
  financeSettingsFrom,
  type Expense,
  type FinanceProject,
  type FinanceTimeEntry,
  type FinanceTransaction,
} from "@/lib/finance";
import type { TeamMember } from "@/lib/types";
import TeamTabs from "@/components/team/TeamTabs";
import FinanceTab from "@/components/team/FinanceTab";

export default async function FinancePage() {
  const teamMember = await getCurrentTeamMember();
  // Admin/Manager only. The tab is hidden for everyone else and this
  // redirect is the server-side gate for the page; RLS on transactions and
  // expenses (migration 041: Admin/Manager read, Admin write) guards the data.
  const role = teamMember?.role;
  if (role !== "Admin" && role !== "Manager") redirect("/team");
  const isAdmin = role === "Admin";

  const supabase = createClient();
  const [projects, transactions, entries, expenses, settings, members] = await Promise.all([
    supabase.from("projects").select("*").order("client_name"),
    supabase.from("transactions").select("id, project_id, amount, date, payer, payee, notes").order("date", { ascending: false }),
    supabase
      .from("time_entries_net")
      .select("project_id, entry_type, clock_in, clock_out, approved_at, net_minutes")
      .not("project_id", "is", null),
    supabase.from("expenses").select("*").order("created_at"),
    supabase.from("deal_settings").select("*").maybeSingle(),
    supabase.from("team_members").select("*").order("name"),
  ]);

  const loadErrors = [
    ["projects", projects.error],
    ["payments", transactions.error],
    ["time entries", entries.error],
    ["expenses", expenses.error],
    ["settings", settings.error],
  ]
    .filter(([, e]) => e)
    .map(([what, e]) => `Could not load ${what}: ${(e as { message: string }).message}`);

  // Before migration 041 the new project columns don't exist yet.
  const financeProjects = ((projects.data ?? []) as Record<string, unknown>[]).map(
    (p) =>
      ({
        ...p,
        win_probability: p.win_probability ?? null,
        expected_sub_months: p.expected_sub_months ?? null,
        related_party: p.related_party ?? false,
        salesperson: p.salesperson ?? [],
      }) as FinanceProject
  );

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-foreground">Team</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Collected cash, labor, margins and pipeline. Admins and Managers only.
      </p>

      <TeamTabs showFinance />

      <div className="mt-6">
        {loadErrors.length > 0 && (
          <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {loadErrors.map((e) => (
              <p key={e}>{e}</p>
            ))}
          </div>
        )}
        <FinanceTab
          initialProjects={financeProjects}
          initialTransactions={(transactions.data ?? []) as FinanceTransaction[]}
          timeEntries={(entries.data ?? []) as FinanceTimeEntry[]}
          initialExpenses={(expenses.data ?? []) as Expense[]}
          settings={financeSettingsFrom(settings.data)}
          members={(members.data ?? []) as TeamMember[]}
          isAdmin={isAdmin}
          today={payDateOf()}
        />
      </div>
    </div>
  );
}
