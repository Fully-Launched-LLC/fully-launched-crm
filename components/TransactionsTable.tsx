"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Project, TeamMember, Transaction } from "@/lib/types";
import TextCell from "@/components/table/TextCell";
import DateCell from "@/components/table/DateCell";
import ConfirmDialog from "@/components/ConfirmDialog";
import { pickableMembers } from "@/lib/team";

const currencyFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export default function TransactionsTable({
  initialTransactions,
  projects,
  teamMembers,
}: {
  initialTransactions: Transaction[];
  projects: Project[];
  teamMembers: TeamMember[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [transactions, setTransactions] = useState(initialTransactions);
  const [error, setError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const projectsById = useMemo(
    () => new Map(projects.map((p) => [p.id, p.client_name])),
    [projects]
  );
  const membersById = useMemo(
    () => new Map(teamMembers.map((m) => [m.id, m.name])),
    [teamMembers]
  );

  async function updateTransaction(id: string, patch: Partial<Transaction>) {
    const previous = transactions;
    setTransactions((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
    );
    const { error } = await supabase
      .from("transactions")
      .update(patch)
      .eq("id", id);
    if (error) {
      setTransactions(previous);
      setError(error.message);
    }
  }

  async function addTransaction() {
    const { data, error } = await supabase
      .from("transactions")
      .insert({ amount: 0, date: new Date().toISOString().slice(0, 10) })
      .select()
      .single();
    if (error || !data) {
      setError(error?.message ?? "Could not create transaction");
      return;
    }
    setTransactions((prev) => [data as Transaction, ...prev]);
  }

  async function deleteTransaction(id: string) {
    const previous = transactions;
    setTransactions((prev) => prev.filter((t) => t.id !== id));
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) {
      setTransactions(previous);
      setError(error.message);
    }
    setPendingDeleteId(null);
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-neutral-500">
          {transactions.length} transaction{transactions.length === 1 ? "" : "s"}
        </p>
        <button
          type="button"
          onClick={addTransaction}
          className="rounded-md bg-header px-3 py-1.5 text-sm font-medium text-header-foreground"
        >
          + New Transaction
        </button>
      </div>

      {error && (
        <p className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
              <th className="px-2 py-2">Project</th>
              <th className="px-2 py-2">Amount</th>
              <th className="px-2 py-2">Date</th>
              <th className="px-2 py-2">Payer</th>
              <th className="px-2 py-2">Payee</th>
              <th className="px-2 py-2">Notes</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-1 py-1 align-top">
                  <select
                    value={t.project_id ?? ""}
                    onChange={(e) =>
                      updateTransaction(t.id, { project_id: e.target.value || null })
                    }
                    className="w-full min-w-[10rem] rounded border border-transparent px-1.5 py-1 text-sm hover:border-neutral-300"
                  >
                    <option value="">—</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.client_name}
                      </option>
                    ))}
                  </select>
                  {t.project_id && !projectsById.has(t.project_id) && (
                    <p className="px-1.5 text-xs text-neutral-400">
                      (original project deleted)
                    </p>
                  )}
                </td>
                <td className="px-1 py-1 align-top">
                  <TextCell
                    type="number"
                    value={String(t.amount)}
                    displayValue={currencyFormat.format(t.amount)}
                    onCommit={(v) =>
                      updateTransaction(t.id, { amount: v === "" ? 0 : Number(v) })
                    }
                  />
                </td>
                <td className="px-1 py-1 align-top">
                  <DateCell
                    value={t.date}
                    onCommit={(v) => updateTransaction(t.id, { date: v ?? t.date })}
                  />
                </td>
                <td className="px-1 py-1 align-top">
                  <TextCell
                    value={t.payer}
                    onCommit={(v) => updateTransaction(t.id, { payer: v })}
                  />
                </td>
                <td className="px-1 py-1 align-top">
                  <select
                    value={t.payee ?? ""}
                    onChange={(e) =>
                      updateTransaction(t.id, { payee: e.target.value || null })
                    }
                    className="w-full min-w-[8rem] rounded border border-transparent px-1.5 py-1 text-sm hover:border-neutral-300"
                  >
                    <option value="">—</option>
                    {pickableMembers(teamMembers, [t.payee]).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  {t.payee && !membersById.has(t.payee) && (
                    <p className="px-1.5 text-xs text-neutral-400">(unknown)</p>
                  )}
                </td>
                <td className="px-1 py-1 align-top">
                  <TextCell
                    value={t.notes}
                    onCommit={(v) => updateTransaction(t.id, { notes: v })}
                  />
                </td>
                <td className="px-1 py-1 align-top">
                  <button
                    type="button"
                    onClick={() => setPendingDeleteId(t.id)}
                    className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {transactions.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-neutral-400">
                  No transactions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Delete this transaction? This can't be undone."
        confirmLabel="Delete"
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => pendingDeleteId && deleteTransaction(pendingDeleteId)}
      />
    </div>
  );
}
