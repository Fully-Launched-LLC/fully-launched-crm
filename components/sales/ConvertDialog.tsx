"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Lead, TeamMember } from "@/lib/types";
import { BRANCHES, type Branch } from "@/lib/theme";
import { defaultOwnerFor, projectSourceFor } from "@/lib/leads/convert";
import { LEAD_LIST_COLUMNS, type LeadListRow } from "@/lib/leads/list";

// Move to Interested (Sales detail panel): turns a business (leads row)
// into a project at stage Interested.
//   project: client_name, contact_name, email, phone, source (mapped to the
//   projects list), branch, owner (default: whoever leads that branch),
//   salesperson = the lead's found_by, estimated value (build or monthly),
//   note. The projects_sync_contact trigger creates the contact (needs a
//   contact name); the Contacts page groups it with the same person's
//   other projects.
//   lead: project_id + status converted, then a touch records the move.
// Multi-branch leads get one project for the chosen branch.

const input = "mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm text-foreground";
const label = "block text-xs font-medium text-neutral-600";

export default function ConvertDialog({
  lead,
  firstTouch,
  members,
  me,
  callBooked = false,
  onClose,
  onConverted,
}: {
  lead: Lead;
  firstTouch: { channel: string; direction: string } | null;
  members: TeamMember[];
  me: TeamMember;
  // Opened by the Booked call outcome: the call is already on the calendar,
  // so there's no Send booking link step to do afterwards.
  callBooked?: boolean;
  onClose: () => void;
  onConverted: (projectId: string, row: LeadListRow | null) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const fit = (lead.branch_fit ?? []) as Branch[];
  const [branch, setBranch] = useState<Branch | "">(fit[0] ?? "");
  const [owner, setOwner] = useState<string>(defaultOwnerFor(fit[0] ?? "", members) ?? "");
  const [ownerTouched, setOwnerTouched] = useState(false);
  const [contactName, setContactName] = useState(lead.contact_name ?? "");
  const [kind, setKind] = useState<"build" | "subscription">("build");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; projectId?: string } | null>(null);

  function pickBranch(b: Branch | "") {
    setBranch(b);
    if (!ownerTouched) setOwner(defaultOwnerFor(b, members) ?? "");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!branch) {
      setError({ text: "Pick a branch." });
      return;
    }
    const amount = value.trim() ? Number(value.replace(/[^0-9.]/g, "")) : null;
    if (amount != null && !Number.isFinite(amount)) {
      setError({ text: "Estimated value must be a number." });
      return;
    }
    setBusy(true);
    setError(null);

    const { data: project, error: e1 } = await supabase
      .from("projects")
      .insert({
        client_name: lead.company ?? lead.name,
        contact_name: contactName.trim() || null,
        email: lead.email,
        phone: lead.phone,
        source: projectSourceFor(lead.source, firstTouch),
        stage: "Interested",
        branch,
        owner: owner ? [owner] : [],
        salesperson: lead.found_by ? [lead.found_by] : [],
        build: kind === "build" && amount != null,
        build_value: kind === "build" ? amount : null,
        subscription: kind === "subscription" && amount != null,
        subscription_value: kind === "subscription" ? amount : null,
        notes: [callBooked ? "Call booked from Sales." : "", note.trim()].filter(Boolean).join(" ") || null,
      })
      .select("id")
      .single();
    if (e1 || !project) {
      setBusy(false);
      setError({ text: e1?.message ?? "Could not create the project." });
      return;
    }

    const { data: rows, error: e2 } = await supabase
      .from("leads")
      .update({ project_id: project.id, status: "converted" })
      .eq("id", lead.id)
      .select(LEAD_LIST_COLUMNS);
    if (e2 || !rows?.length) {
      setBusy(false);
      setError({
        text: `The project was created, but this business couldn't be marked as moved (${e2?.message ?? "only its owner or an Admin/Manager can"}).`,
        projectId: project.id,
      });
      return;
    }

    await supabase.from("lead_touches").insert({
      lead_id: lead.id,
      channel: "other",
      direction: "outbound",
      outcome: "interested",
      summary: [`Moved to Interested: ${branch} project`, note.trim()].filter(Boolean).join(". "),
      touched_by: me.id,
    });

    setBusy(false);
    onConverted(project.id, rows[0] as unknown as LeadListRow);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Move to Interested">
      <form onSubmit={submit} className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-foreground">Move to Interested</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Creates a project for <b>{lead.company ?? lead.name}</b> at stage Interested.
        </p>
        {callBooked && (
          <p className="mt-2 rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
            Call already booked, so there&apos;s no booking link to send.
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className={label}>
            Branch
            <select value={branch} onChange={(e) => pickBranch(e.target.value as Branch | "")} className={input}>
              <option value="">Choose...</option>
              {BRANCHES.map((b) => (
                <option key={b} value={b}>
                  {b}
                  {fit.includes(b) ? " (fit)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            Project owner
            <select
              value={owner}
              onChange={(e) => {
                setOwner(e.target.value);
                setOwnerTouched(true);
              }}
              className={input}
            >
              <option value="">Nobody yet</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {branch && (m.lead_branches ?? []).includes(branch) ? ` (leads ${branch})` : ""}
                </option>
              ))}
            </select>
          </label>
          {fit.length > 1 && (
            <p className="col-span-2 rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
              Multi-branch ({fit.join(", ")}): this creates one project for the branch you pick. Multi-branch: line items coming later.
            </p>
          )}
          <label className={`${label} col-span-2`}>
            Contact name
            <input value={contactName} onChange={(e) => setContactName(e.target.value)} className={input} />
            {!contactName.trim() && <span className="mt-1 block font-normal text-amber-700">Without a contact name no contact is created.</span>}
          </label>
          <div className="col-span-2">
            <span className={label}>Estimated value</span>
            <div className="mt-1 flex gap-2">
              <div className="inline-flex rounded-md border border-neutral-300 p-0.5">
                {(["build", "subscription"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={kind === k}
                    onClick={() => setKind(k)}
                    className={`rounded px-2 py-1 text-xs font-medium ${kind === k ? "bg-header text-header-foreground" : "text-neutral-700"}`}
                  >
                    {k === "build" ? "One-time build" : "Monthly"}
                  </button>
                ))}
              </div>
              <input
                inputMode="decimal"
                placeholder={kind === "build" ? "$ total" : "$ per month"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
              />
            </div>
          </div>
          <label className={`${label} col-span-2`}>
            Note
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={input} placeholder="What they want, next step..." />
          </label>
        </div>

        {error && (
          <p className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error.text}{" "}
            {error.projectId && (
              <a className="font-medium underline" href={`/project/${error.projectId}`}>
                Open the project
              </a>
            )}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
            Not now
          </button>
          <button type="submit" disabled={busy} className="rounded-md bg-header px-3 py-1.5 text-sm font-medium text-header-foreground disabled:opacity-50">
            {busy ? "Creating..." : "Create project"}
          </button>
        </div>
      </form>
    </div>
  );
}
