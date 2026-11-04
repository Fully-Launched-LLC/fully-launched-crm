"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Project, ProjectTask, TeamMember } from "@/lib/types";
import { duplicateProjectPayload } from "@/lib/projects";
import {
  BRANCHES,
  BRANCH_COLORS,
  PAYMENT_STATUSES,
  SOURCES,
  STAGES,
  STAGE_COLORS,
  type Branch,
  type PaymentStatus,
  type Stage,
} from "@/lib/theme";
import TextCell from "@/components/table/TextCell";
import DateCell from "@/components/table/DateCell";
import BadgeSelectCell from "@/components/table/BadgeSelectCell";
import MultiSelectCell from "@/components/table/MultiSelectCell";
import ProjectTasksManager from "@/components/ProjectTasksManager";
import ConfirmDialog from "@/components/ConfirmDialog";
import ChannelsField from "@/components/ChannelsField";
import BookCallSection from "@/components/BookCallSection";
import CallHistory from "@/components/CallHistory";
import LeadHistory, { type ProjectLeadHistory } from "@/components/LeadHistory";
import type { Call } from "@/lib/calls";
import { branchChangePatch } from "@/lib/channels";
import {
  INVOICE_DAYS_UNTIL_DUE,
  buildBalanceCents,
  depositCents,
  invoiceCents,
  invoiceIdField,
  type InvoiceKind,
} from "@/lib/billing";

const currencyFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const SOURCE_COLORS = Object.fromEntries(
  SOURCES.map((s) => [s, "bg-neutral-100 text-neutral-700 border border-neutral-300"])
);

const PAYMENT_STATUS_ORDER: PaymentStatus[] = [
  "Waiting for Deposit",
  "Deposit Paid",
  "Waiting for Payment",
  "Paid",
];

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      {children}
    </div>
  );
}

export default function ProjectDetail({
  initialProject,
  teamMembers,
  initialTasks,
  back,
  canDelete,
  canInvoice,
  stripeDashboardBase,
  currentMemberId,
  calls,
  leadHistory,
}: {
  initialProject: Project;
  teamMembers: TeamMember[];
  initialTasks: ProjectTask[];
  back: { href: string; label: string };
  canDelete: boolean;
  // Admin/Manager — hides the Send buttons; the invoice route enforces it.
  canInvoice: boolean;
  // For "View in Stripe" links; null when Stripe isn't configured.
  stripeDashboardBase: string | null;
  // Sent as metadata[booked_by] on Cal.com links.
  currentMemberId: string | null;
  // Cal.com calls linked to this project.
  calls: Call[];
  // The lead this project came from (Move to Interested), if any.
  leadHistory: ProjectLeadHistory | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [project, setProject] = useState<Project>(initialProject);
  const [error, setError] = useState<string | null>(null);
  const [invoiceNotice, setInvoiceNotice] = useState<string | null>(null);
  const [pendingInvoice, setPendingInvoice] = useState<InvoiceKind | null>(null);
  const [sendingInvoice, setSendingInvoice] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  async function update(patch: Partial<Project>) {
    const previous = project;
    setProject((prev) => ({ ...prev, ...patch }));
    const { error } = await supabase
      .from("projects")
      .update(patch)
      .eq("id", project.id);
    if (error) {
      setProject(previous);
      setError(error.message);
    } else {
      setError(null);
    }
  }

  // Not optimistic: leaving the page is the success signal. A delete blocked
  // by RLS returns no error, just zero rows, so check the returned rows too.
  async function deleteProject() {
    setConfirmingDelete(false);
    setDeleting(true);
    const { data, error } = await supabase
      .from("projects")
      .delete()
      .eq("id", project.id)
      .select("id");
    if (error || !data?.length) {
      setDeleting(false);
      setError(error?.message ?? "You don't have permission to delete this project.");
      return;
    }
    router.push(back.href);
    router.refresh();
  }

  // Opens the copy rather than returning to the list — the user most likely
  // wants to edit it next. Carries this page's ?from=/?tab= over so the
  // copy's back link still returns to the original view.
  async function duplicateProject() {
    setDuplicating(true);
    const { data, error } = await supabase
      .from("projects")
      .insert(duplicateProjectPayload(project))
      .select("id")
      .single();
    if (error || !data) {
      setDuplicating(false);
      setError(error?.message ?? "Could not duplicate project");
      return;
    }
    const query = searchParams.toString();
    router.push(`/project/${data.id}${query ? `?${query}` : ""}`);
    router.refresh();
  }

  const depositCleared =
    !!project.payment_status &&
    PAYMENT_STATUS_ORDER.indexOf(project.payment_status) >=
      PAYMENT_STATUS_ORDER.indexOf("Deposit Paid");

  // Which Build invoice is next: Deposit until payment_status reaches
  // Deposit Paid, then the Build balance.
  const invoiceStage: InvoiceKind = depositCleared ? "build" : "deposit";
  const stageInvoiceId = project[invoiceIdField(invoiceStage)];
  const money = (cents: number) => currencyFormat.format(cents / 100);

  function requestInvoice(kind: InvoiceKind) {
    if (!project.email?.trim()) {
      setError("Add a contact email before sending an invoice.");
      return;
    }
    if (invoiceCents(project, kind) <= 0) {
      setError("Set a Build Value before sending an invoice.");
      return;
    }
    setPendingInvoice(kind);
  }

  async function sendInvoice(kind: InvoiceKind) {
    setPendingInvoice(null);
    setSendingInvoice(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? `Sending the invoice failed (${res.status}).`);
        return;
      }
      setProject((prev) => ({ ...prev, ...json.patch }));
      setError(null);
      setInvoiceNotice(
        `${kind === "deposit" ? "Deposit" : "Build"} invoice sent to ${project.email}.`
      );
    } catch {
      setError("Couldn't reach the server — the invoice may not have been sent. Check Stripe before retrying.");
    } finally {
      setSendingInvoice(false);
    }
  }

  function invoiceConfirmTitle(kind: InvoiceKind): string {
    const amount = money(invoiceCents(project, kind));
    const what =
      kind === "deposit"
        ? `deposit invoice (${project.deposit_percent}% of ${currencyFormat.format(project.build_value ?? 0)})`
        : `build invoice (the balance after the ${project.deposit_percent}% deposit)`;
    return `Send a ${amount} ${what} to ${project.email}? Stripe emails it; payment is due in ${INVOICE_DAYS_UNTIL_DUE} days.`;
  }

  function placeholderInvoice(label: string) {
    setInvoiceNotice(
      `${label}: Stripe isn't connected yet, so this is a placeholder. Real invoicing lands in a later build step.`
    );
  }

  return (
    <div>
      <Link href={back.href} className="text-sm text-accent hover:underline">
        ← {back.label}
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-foreground">
          {project.client_name}
        </h1>
        <BadgeSelectCell
          value={project.branch}
          options={BRANCHES}
          colors={BRANCH_COLORS}
          onCommit={(v) => update(branchChangePatch(project, v as Branch))}
        />
        <BadgeSelectCell
          value={project.stage}
          options={STAGES}
          colors={STAGE_COLORS}
          onCommit={(v) => update({ stage: v as Stage })}
        />
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={duplicateProject}
            disabled={duplicating || deleting}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            {duplicating ? "Duplicating…" : "Duplicate project"}
          </button>
          {canDelete && (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={deleting || duplicating}
              className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete project"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 rounded-lg border border-neutral-200 p-5 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Company">
          <TextCell value={project.client_name} onCommit={(v) => update({ client_name: v })} />
        </Field>
        <Field label="Contact Name">
          <TextCell value={project.contact_name} onCommit={(v) => update({ contact_name: v })} />
        </Field>
        <Field label="Email">
          <TextCell type="email" value={project.email} onCommit={(v) => update({ email: v })} />
        </Field>
        <Field label="Phone">
          <TextCell type="tel" value={project.phone} onCommit={(v) => update({ phone: v })} />
        </Field>
        <Field label="Owner">
          <MultiSelectCell
            teamMembers={teamMembers}
            selectedIds={project.owner}
            onCommit={(ids) => update({ owner: ids })}
          />
        </Field>
        <Field label="Salesperson">
          <MultiSelectCell
            teamMembers={teamMembers}
            selectedIds={project.salesperson}
            onCommit={(ids) => update({ salesperson: ids })}
          />
        </Field>
        <Field label="Source">
          <BadgeSelectCell
            value={project.source}
            options={SOURCES}
            colors={SOURCE_COLORS}
            onCommit={(v) => update({ source: v })}
          />
        </Field>
        <Field label="Channels">
          <ChannelsField
            branch={project.branch}
            value={project.channels}
            onCommit={(channels) => update({ channels })}
          />
        </Field>
        <Field label="Target Date">
          <DateCell value={project.target_date} onCommit={(v) => update({ target_date: v })} />
        </Field>
        <Field label="End Date">
          <DateCell value={project.end_date} onCommit={(v) => update({ end_date: v })} />
        </Field>
        {project.stage === "Lost" && (
          <Field label="Lost Reason">
            <TextCell value={project.lost_reason} onCommit={(v) => update({ lost_reason: v })} />
          </Field>
        )}
        <Field label="Commission Rate (%)">
          <TextCell
            type="number"
            value={String(project.commission_rate)}
            onCommit={(v) => update({ commission_rate: v === "" ? 0 : Number(v) })}
          />
        </Field>
        <div className="sm:col-span-2 lg:col-span-3">
          <Field label="Notes">
            <TextCell value={project.notes} onCommit={(v) => update({ notes: v })} />
          </Field>
        </div>
      </div>

      {invoiceNotice && (
        <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {invoiceNotice}
        </p>
      )}

      <div className="mt-6 rounded-lg border border-neutral-200 p-5">
        <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <input
            type="checkbox"
            checked={project.build}
            onChange={(e) => update({ build: e.target.checked })}
            className="h-4 w-4"
          />
          Build
        </label>

        {project.build && (
          <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Build Value">
              <TextCell
                type="number"
                value={project.build_value != null ? String(project.build_value) : null}
                displayValue={
                  project.build_value != null ? currencyFormat.format(project.build_value) : undefined
                }
                onCommit={(v) => update({ build_value: v === "" ? null : Number(v) })}
              />
            </Field>
            <Field label="Deposit">
              {project.stripe_deposit_invoice_id ? (
                // Locked once invoiced: the Build balance is derived from it.
                <p className="px-1.5 py-1 text-sm text-foreground">
                  {project.deposit_percent}% = {money(depositCents(project))}{" "}
                  <span className="text-xs text-neutral-400">(invoiced)</span>
                </p>
              ) : (
                <TextCell
                  type="number"
                  value={String(project.deposit_percent)}
                  displayValue={`${project.deposit_percent}% = ${money(depositCents(project))}`}
                  onCommit={(v) => {
                    const pct = Number(v);
                    if (!(pct > 0 && pct <= 100)) {
                      setError("Deposit must be more than 0% and at most 100%.");
                      return;
                    }
                    update({ deposit_percent: pct });
                  }}
                />
              )}
            </Field>
            <Field label="Payment Status">
              <select
                value={project.payment_status ?? ""}
                onChange={(e) =>
                  update({ payment_status: (e.target.value || null) as PaymentStatus | null })
                }
                className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
              >
                <option value="">—</option>
                {PAYMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Build End Date">
              <DateCell value={project.build_end_date} onCommit={(v) => update({ build_end_date: v })} />
            </Field>
            <Field label="Invoicing">
              {project.payment_status === "Paid" ? (
                <p className="px-1.5 py-1 text-sm text-foreground">Paid</p>
              ) : stageInvoiceId ? (
                <p className="px-1.5 py-1 text-sm text-foreground">
                  {invoiceStage === "deposit" ? "Deposit" : "Build"} invoice sent
                  {stripeDashboardBase && (
                    <>
                      {" · "}
                      <a
                        href={`${stripeDashboardBase}/invoices/${stageInvoiceId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent hover:underline"
                      >
                        View in Stripe
                      </a>
                    </>
                  )}
                </p>
              ) : canInvoice ? (
                <button
                  type="button"
                  onClick={() => requestInvoice(invoiceStage)}
                  disabled={sendingInvoice}
                  className="rounded-md bg-header px-3 py-1.5 text-sm font-medium text-header-foreground disabled:opacity-50"
                >
                  {sendingInvoice
                    ? "Sending…"
                    : invoiceStage === "deposit"
                      ? `Send Deposit Invoice (${money(depositCents(project))})`
                      : `Send Build Invoice (${money(buildBalanceCents(project))})`}
                </button>
              ) : (
                <p className="px-1.5 py-1 text-sm text-neutral-400">No invoice sent</p>
              )}
            </Field>
          </div>
        )}
      </div>

      <div className="mt-6 rounded-lg border border-neutral-200 p-5">
        <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <input
            type="checkbox"
            checked={project.subscription}
            onChange={(e) => update({ subscription: e.target.checked })}
            className="h-4 w-4"
          />
          Subscription
        </label>

        {project.subscription && (
          <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Subscription Value ($/mo)">
              <TextCell
                type="number"
                value={project.subscription_value != null ? String(project.subscription_value) : null}
                displayValue={
                  project.subscription_value != null
                    ? `${currencyFormat.format(project.subscription_value)}/mo`
                    : undefined
                }
                onCommit={(v) => update({ subscription_value: v === "" ? null : Number(v) })}
              />
            </Field>
            <Field label="Deliver Date">
              <DateCell value={project.deliver_date} onCommit={(v) => update({ deliver_date: v })} />
            </Field>
            <Field label="Invoicing">
              <button
                type="button"
                onClick={() => placeholderInvoice("Send Monthly Invoice")}
                className="rounded-md bg-header px-3 py-1.5 text-sm font-medium text-header-foreground"
              >
                Send Monthly Invoice
              </button>
            </Field>
          </div>
        )}
      </div>

      <div className="mt-6">
        <BookCallSection
          project={project}
          teamMembers={teamMembers}
          currentMemberId={currentMemberId}
        />
      </div>

      <div className="mt-6">
        <CallHistory calls={calls} teamMembers={teamMembers} />
      </div>

      {leadHistory && (
        <div className="mt-6">
          <LeadHistory history={leadHistory} teamMembers={teamMembers} />
        </div>
      )}

      <div className="mt-6">
        <ProjectTasksManager
          projectId={project.id}
          teamMembers={teamMembers}
          initialTasks={initialTasks}
        />
      </div>

      <ConfirmDialog
        open={pendingInvoice !== null}
        title={pendingInvoice ? invoiceConfirmTitle(pendingInvoice) : ""}
        confirmLabel="Send invoice"
        tone="default"
        onCancel={() => setPendingInvoice(null)}
        onConfirm={() => pendingInvoice && sendInvoice(pendingInvoice)}
      />

      <ConfirmDialog
        open={confirmingDelete}
        title={`Delete ${project.client_name}? This can't be undone. Its tasks will be deleted too. Transactions and contact history will be kept but unlinked from this project.`}
        confirmLabel="Delete"
        tone="danger"
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={deleteProject}
      />
    </div>
  );
}
