"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ConfirmDialog from "@/components/ConfirmDialog";
import LineItemsEditor from "@/components/deals/LineItemsEditor";
import { defaultSelections, money, totals } from "@/lib/deals/money";
import { clientApprovalBlockers, hasProductionDays } from "@/lib/deals/render";
import { PROPOSAL_SECTION_LABELS, SOW_SECTION_LABELS } from "@/lib/deals/sections";
import type { TeamMember } from "@/lib/types";
import {
  type Deal,
  type DealDocument,
  type DealEvent,
  type DealLineItem,
  type DealSettings,
  type DealSignature,
  type DocKind,
} from "@/lib/deals/types";

export type DealDeskData = {
  deal: Deal | null;
  items: DealLineItem[];
  docs: DealDocument[];
  signatures: DealSignature[];
  events: DealEvent[];
  settings: DealSettings;
  // Latest internal deal doc in Google Docs (project_links kind internal_doc).
  internalDocUrl?: string | null;
};

const LIVE = ["approved", "sent", "viewed"];

const STATUS_STYLE: Record<string, string> = {
  draft: "border-neutral-300 text-neutral-700 bg-neutral-50",
  approved: "border-indigo-200 text-indigo-700 bg-indigo-50",
  sent: "border-amber-200 text-amber-700 bg-amber-50",
  viewed: "border-amber-200 text-amber-700 bg-amber-50",
  signed: "border-green-200 text-green-700 bg-green-50",
  countersigned: "border-teal-200 text-teal-700 bg-teal-50",
  void: "border-red-200 text-red-700 bg-red-50",
};

const btn =
  "rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50";
const btnPrimary = "rounded-md bg-header px-3 py-1.5 text-sm font-medium text-header-foreground disabled:opacity-50";
const input = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";
const label = "mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500";

export default function DealDesk({
  projectId,
  data,
  members,
  me,
  googleOk,
  googleIssue,
  docsKeyOk,
}: {
  projectId: string;
  data: DealDeskData;
  members: TeamMember[];
  me: TeamMember;
  googleOk: { proposal: boolean; sow: boolean };
  // Every Google env problem, named (empty when fine).
  googleIssue?: string | null;
  docsKeyOk: boolean;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [deal, setDeal] = useState<Deal | null>(data.deal);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<string[]>([]);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; run: () => void; cancel?: () => void } | null>(null);
  const [section, setSection] = useState<Record<"proposal" | "sow", string>>({ proposal: "", sow: "" });
  const [cs, setCs] = useState({ name: me.name, title: "" });

  useEffect(() => setDeal(data.deal), [data.deal]);

  const isManager = me.role === "Admin" || me.role === "Manager";
  const isAdmin = me.role === "Admin";
  const locked = !deal || ["signed", "countersigned", "void"].includes(deal.status);
  const live = !!deal && LIVE.includes(deal.status);

  // Live approval blockers for a draft (the Docs' current text): the Approve
  // button stays disabled until they clear. Re-checked on load and focus.
  const [liveBlockers, setLiveBlockers] = useState<string[] | null>(null);
  useEffect(() => {
    if (!data.deal || data.deal.status !== "draft") return;
    const id = data.deal.id;
    let alive = true;
    const load = () =>
      fetch(`/api/deals/${id}/approve`)
        .then((r) => r.json())
        .then((b) => alive && setLiveBlockers(Array.isArray(b.blockers) ? b.blockers : []))
        .catch(() => alive && setLiveBlockers([]));
    void load();
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      window.removeEventListener("focus", load);
    };
  }, [data.deal, data.docs]);

  // Edit detection when the Deal Desk loads (approved / sent / viewed).
  useEffect(() => {
    if (!data.deal || !LIVE.includes(data.deal.status) || !googleOk.sow) return;
    fetch(`/api/deals/${data.deal.id}/check-edits`, { method: "POST" })
      .then((r) => r.json())
      .then((b) => {
        if (b.edited?.length) {
          setNotice(
            `Edited in Google Docs after approval (${b.edited.join(", ")}). The deal is back to draft and unsigned links were revoked. Approve it again to send.`
          );
          router.refresh();
        }
      })
      .catch(() => {});
  }, [data.deal, googleOk.sow, router]);

  // Content edits on an approved / sent / viewed deal send it back to draft
  // (database trigger). Ask first.
  function guard(run: () => void, cancel?: () => void) {
    if (live)
      setConfirm({
        title:
          "This deal is approved. Changing it sends it back to draft and revokes any unsigned signing link. Continue?",
        run,
        cancel,
      });
    else run();
  }

  async function call(name: string, url: string, body?: unknown) {
    setBusy(name);
    setError(null);
    setBlockers([]);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 422 && json.blockers) {
        setBlockers(json.blockers);
        return null;
      }
      if (!res.ok) throw new Error(json.error ?? `${name} failed`);
      return json;
    } catch (e) {
      setError(e instanceof Error ? e.message : `${name} failed`);
      return null;
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  async function createDeal() {
    setBusy("create");
    const { error: err } = await supabase.from("deals").insert({ project_id: projectId });
    setBusy(null);
    if (err) setError(err.message);
    router.refresh();
  }

  async function saveDeal(patch: Partial<Deal>) {
    if (!deal) return;
    const { data: row, error: err } = await supabase.from("deals").update(patch).eq("id", deal.id).select("*").maybeSingle();
    if (err) setError(err.message);
    else if (!row) setError("Not saved (no permission, or the deal changed). Reload.");
    else setDeal(row as Deal);
    router.refresh();
  }

  if (!deal) {
    return (
      <section className="mt-6 rounded-lg border border-neutral-200 p-5">
        <h2 className="text-sm font-semibold text-foreground">Deal Desk</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Line items, an AI-written Proposal and SOW in Google Docs, approval, and click-to-sign.
        </p>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <button type="button" className={`${btnPrimary} mt-4`} onClick={createDeal} disabled={busy === "create"}>
          {busy === "create" ? "Creating..." : "Create deal"}
        </button>
      </section>
    );
  }

  const hasProduction = hasProductionDays(data.items);
  // Same default package as the documents (one tier per branch).
  const t = totals(data.items, defaultSelections(data.items));
  const approveBlockers = Array.from(
    new Set([...clientApprovalBlockers(deal, data.items, data.docs), ...(liveBlockers ?? [])])
  );
  const checkingDocs = deal.status === "draft" && liveBlockers === null;
  const docsOf = (k: DocKind) => data.docs.filter((d) => d.kind === k).sort((a, b) => b.version - a.version);
  const signed = data.signatures.find((s) => s.signed_at);
  const activeLink = data.signatures.find((s) => !s.signed_at && !s.revoked_at && new Date(s.expires_at) > new Date());
  const name = (id: string | null) => members.find((m) => m.id === id)?.name ?? "Someone";

  const field = (
    key: keyof Deal,
    lbl: string,
    type: "text" | "date" | "number" = "text",
    opts: { internal?: boolean; placeholder?: string; help?: string } = {}
  ) => (
    <label className="block">
      <span className={label}>{lbl}</span>
      <input
        key={`${key}-${String(deal[key] ?? "")}`}
        type={type}
        className={input}
        defaultValue={(deal[key] as string | number | null) ?? ""}
        placeholder={opts.placeholder}
        disabled={locked}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          const value = raw === "" ? null : type === "number" ? Number(raw) : raw;
          if (value === (deal[key] ?? null) || String(value) === String(deal[key] ?? "")) return;
          const el = e.target;
          const revert = () => (el.value = String(deal[key] ?? ""));
          if (opts.internal) saveDeal({ [key]: value } as Partial<Deal>);
          else guard(() => saveDeal({ [key]: value } as Partial<Deal>), revert);
        }}
      />
      {opts.help && <span className="mt-1 block text-xs text-neutral-500">{opts.help}</span>}
    </label>
  );

  return (
    <section className="mt-6 space-y-6">
      <div className="rounded-lg border border-neutral-200 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold text-foreground">Deal Desk</h2>
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[deal.status]}`}>
            {deal.status === "countersigned" ? "Countersigned" : deal.status.charAt(0).toUpperCase() + deal.status.slice(1)}
          </span>
          {deal.approved_by && (
            <span className="text-xs text-neutral-500">
              Approved by {name(deal.approved_by)} on {new Date(deal.approved_at!).toLocaleDateString()}
            </span>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            {deal.drive_folder_url && (
              <a href={deal.drive_folder_url} target="_blank" rel="noopener noreferrer" className={btn}>
                Drive folder
              </a>
            )}
            <Link href={`/project/${projectId}/deal/internal`} className={btn}>
              View Internal Deal Doc
            </Link>
            {data.internalDocUrl && (
              <a href={data.internalDocUrl} target="_blank" rel="noopener noreferrer" className={btn}>
                Open Internal Deal Doc
              </a>
            )}
            {isAdmin && (
              <Link href="/settings/deal-desk" className={btn}>
                Settings
              </Link>
            )}
          </div>
        </div>
        {notice && <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{notice}</p>}
        {error && <p className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {field("date_issued", "Date issued", "date", { internal: true })}
          {field("valid_through", "Valid through", "date", { help: "Last day the client can sign." })}
          {field("target_start", "Target start", "date", { help: "Fills Week 1 in the SOW timeline." })}
          {field("target_launch", "Target launch", "date", { help: "Fills the SOW header and the Launch row." })}
          {hasProduction && (
            <>
              {field("production_notice_days", "Production notice (days)", "number")}
              {field("production_setups", "Setups per production day")}
              {field("production_cancel_hours", "Cancellation window (hours)", "number")}
            </>
          )}
          {field("est_project_hours", "Est. project hours", "number", {
            internal: true,
            help: "Internal only. Labor = hours x project hourly rate.",
          })}
          <label className="block">
            <span className={label}>Deal owner</span>
            <select
              className={input}
              value={deal.owner_id ?? ""}
              disabled={locked}
              onChange={(e) => saveDeal({ owner_id: e.target.value || null })}
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Date issued is reset to today, and Valid through to at least today + 14, every time the deal is approved.
        </p>
      </div>

      <LineItemsEditor
        dealId={deal.id}
        items={data.items}
        locked={locked}
        guard={guard}
        defaultOverage={data.settings.default_overage_rate}
        onChanged={() => router.refresh()}
        onError={setError}
      />

      <div className="rounded-lg border border-neutral-200 p-5">
        <h3 className="text-sm font-semibold text-foreground">Totals (default selections)</h3>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-neutral-500">One-time</dt>
          <dd className="font-semibold">{money(t.oneTime)}</dd>
          <dt className="text-neutral-500">Monthly</dt>
          <dd className="font-semibold">{money(t.monthly)}/month</dd>
          <dt className="text-neutral-500">Deposit (50%)</dt>
          <dd>{money(t.deposit)}</dd>
          <dt className="text-neutral-500">Due at launch (50%)</dt>
          <dd>{money(t.dueAtLaunch)}</dd>
        </dl>
        {t.hourly.length > 0 && (
          <p className="mt-2 text-sm text-neutral-600">
            Hourly rates (not summed): {t.hourly.map((h) => `${h.label} ${money(h.amount)}/hr`).join(", ")}
          </p>
        )}
      </div>

      {(["proposal", "sow"] as const).map((kind) => {
        const versions = docsOf(kind);
        const current = versions[0];
        const sectionLabels = kind === "proposal" ? PROPOSAL_SECTION_LABELS : SOW_SECTION_LABELS;
        const ready = googleOk[kind] && docsKeyOk;
        const why = !googleOk[kind]
          ? googleIssue || "Google Docs not configured"
          : !docsKeyOk
            ? "Docs key not configured"
            : null;
        return (
          <div key={kind} className="rounded-lg border border-neutral-200 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">{kind === "proposal" ? "Proposal" : "Statement of Work"}</h3>
              {current?.google_doc_url && (
                <a href={current.google_doc_url} target="_blank" rel="noopener noreferrer" className="text-sm text-accent hover:underline">
                  Open v{current.version} in Google Docs
                </a>
              )}
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {why && <span className="text-sm text-neutral-500">{why}</span>}
                {current && (
                  <>
                    <select
                      className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
                      value={section[kind]}
                      onChange={(e) => setSection((s) => ({ ...s, [kind]: e.target.value }))}
                      disabled={locked || !ready}
                    >
                      <option value="">Regenerate one section...</option>
                      {Object.entries(sectionLabels).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className={btn}
                      disabled={!section[kind] || locked || !ready || !!busy}
                      onClick={() =>
                        guard(() => call(`gen-${kind}`, `/api/deals/${deal.id}/generate`, { kind, section: section[kind] }))
                      }
                    >
                      Regenerate section
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={locked || !ready || !!busy || !data.items.length}
                  onClick={() => guard(() => call(`gen-${kind}`, `/api/deals/${deal.id}/generate`, { kind }))}
                >
                  {busy === `gen-${kind}` ? "Generating (about a minute)..." : `Generate ${kind === "proposal" ? "Proposal" : "SOW"}`}
                </button>
              </div>
            </div>
            {current && (current.section_flags?.needs_manual_edit?.length || current.section_flags?.leftovers?.length) ? (
              <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                v{current.version} needs edits in Google Docs before approval:{" "}
                {[
                  ...(current.section_flags.needs_manual_edit ?? []).map((s) => `${sectionLabels[s] ?? s} (needs manual edit)`),
                  ...(current.section_flags.leftovers ?? []),
                ].join(", ")}
              </p>
            ) : null}
            {versions.length > 0 && (
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-neutral-500">
                    <th className="py-1">Version</th>
                    <th className="py-1">Made</th>
                    <th className="py-1">By</th>
                    <th className="py-1">Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {versions.map((v) => (
                    <tr key={v.id} className="border-t border-neutral-100">
                      <td className="py-1.5">v{v.version}</td>
                      <td className="py-1.5">
                        {new Date(v.created_at).toLocaleString()} ({v.source === "claude" ? "generated" : v.source})
                      </td>
                      <td className="py-1.5">{name(v.generated_by)}</td>
                      <td className="py-1.5">{v.approved_at ? `Approved ${new Date(v.approved_at).toLocaleDateString()}` : ""}</td>
                      <td className="py-1.5 text-right">
                        {v.google_doc_url && (
                          <a href={v.google_doc_url} target="_blank" rel="noopener noreferrer" className="mr-3 text-accent hover:underline">
                            Doc
                          </a>
                        )}
                        {v.frozen_pdf_path && (
                          <a
                            href={`/api/deals/file?path=${encodeURIComponent(v.frozen_pdf_path)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mr-3 text-accent hover:underline"
                          >
                            Approved PDF
                          </a>
                        )}
                        {v.id !== current?.id && !locked && googleOk[kind] && (
                          <button
                            type="button"
                            className="text-accent hover:underline disabled:opacity-50"
                            disabled={!!busy}
                            onClick={() =>
                              guard(() =>
                                call(`gen-${kind}`, `/api/deals/${deal.id}/generate`, { kind, restore_version: v.version })
                              )
                            }
                          >
                            Restore as new version
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-2 text-xs text-neutral-500">
              Edit the wording in Google Docs. Prices, dates and legal text come from the CRM and the master template.
            </p>
          </div>
        );
      })}

      <div className="rounded-lg border border-neutral-200 p-5">
        <h3 className="text-sm font-semibold text-foreground">Approve and send</h3>
        {deal.status === "draft" && (blockers.length > 0 || approveBlockers.length > 0) && (
          <ul className="mt-3 list-disc rounded-md border border-amber-300 bg-amber-50 py-2 pl-8 pr-3 text-sm text-amber-800">
            {Array.from(new Set([...approveBlockers, ...blockers])).map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {deal.status === "draft" &&
            (isManager ? (
              <button
                type="button"
                className={btnPrimary}
                disabled={!!busy || checkingDocs || approveBlockers.length > 0}
                title={checkingDocs ? "Checking the Docs..." : approveBlockers.length ? "Clear the items above first" : undefined}
                onClick={() => call("approve", `/api/deals/${deal.id}/approve`)}
              >
                {busy === "approve" ? "Approving (exporting PDFs)..." : "Approve"}
              </button>
            ) : (
              <span className="text-sm text-neutral-500">Waiting for an Admin or Manager to approve.</span>
            ))}
          {live && (
            <button
              type="button"
              className={btnPrimary}
              disabled={!!busy}
              onClick={async () => {
                setLink(null);
                const res = await call("send", `/api/deals/${deal.id}/send`, { regenerate: deal.status !== "approved" });
                if (res?.link) setLink(res.link);
              }}
            >
              {busy === "send" ? "Creating link..." : deal.status === "approved" ? "Send (create signing link)" : "Regenerate link"}
            </button>
          )}
          {isManager && !["void", "signed", "countersigned"].includes(deal.status) && (
            <button
              type="button"
              className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
              onClick={() =>
                setConfirm({
                  title: "Void this deal? Signing links stop working and it can't be changed again. A new deal can then be created.",
                  run: () => saveDeal({ status: "void" }),
                })
              }
            >
              Void deal
            </button>
          )}
        </div>
        {link && (
          <div className="mt-3 rounded-md border border-neutral-300 bg-neutral-50 p-3">
            <p className="text-xs text-neutral-500">
              Signing link (shown once; only a hash is stored). Valid through {deal.valid_through}.
            </p>
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 break-all text-sm">{link}</code>
              <button
                type="button"
                className={btn}
                onClick={async () => {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}
        {!link && activeLink && (
          <p className="mt-3 text-sm text-neutral-600">
            A signing link is active until {new Date(activeLink.expires_at).toLocaleDateString()}
            {activeLink.viewed_at ? `, viewed ${new Date(activeLink.viewed_at).toLocaleString()}` : ", not viewed yet"}.
            Use Regenerate link to get a new one (the old one stops working).
          </p>
        )}

        {signed && (
          <div className="mt-4 border-t border-neutral-100 pt-4">
            <p className="text-sm text-foreground">
              Signed by <b>{signed.signer_name}</b> ({signed.signer_title}, {signed.signer_email}) on{" "}
              {new Date(signed.signed_at!).toLocaleString()}.
              {signed.fl_countersigned_at &&
                ` Countersigned by ${signed.fl_countersigner_name} on ${new Date(signed.fl_countersigned_at).toLocaleString()}.`}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {signed.pdf_path && (
                <a className={btn} href={`/api/deals/file?path=${encodeURIComponent(signed.pdf_path)}`} target="_blank" rel="noopener noreferrer">
                  Signed PDF
                </a>
              )}
              {signed.final_pdf_path && (
                <a className={btn} href={`/api/deals/file?path=${encodeURIComponent(signed.final_pdf_path)}`} target="_blank" rel="noopener noreferrer">
                  Final PDF (both signatures)
                </a>
              )}
            </div>
            {deal.status === "signed" && isAdmin && (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="block">
                  <span className={label}>Your name</span>
                  <input className={input} value={cs.name} onChange={(e) => setCs({ ...cs, name: e.target.value })} />
                </label>
                <label className="block">
                  <span className={label}>Title</span>
                  <input className={input} value={cs.title} placeholder="Founder" onChange={(e) => setCs({ ...cs, title: e.target.value })} />
                </label>
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={!cs.name.trim() || !cs.title.trim() || !!busy}
                  onClick={() => call("countersign", `/api/deals/${deal.id}/countersign`, cs)}
                >
                  {busy === "countersign" ? "Countersigning..." : "Countersign"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {data.events.length > 0 && (
        <div className="rounded-lg border border-neutral-200 p-5">
          <h3 className="text-sm font-semibold text-foreground">Activity</h3>
          <ul className="mt-2 space-y-1 text-sm text-neutral-700">
            {data.events.slice(0, 30).map((e) => (
              <li key={e.id}>
                <span className="text-neutral-500">{new Date(e.created_at).toLocaleString()}</span> · {eventText(e)}
                {e.actor ? ` · ${name(e.actor)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ""}
        confirmLabel="Continue"
        tone="default"
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          c?.run();
        }}
        onCancel={() => {
          confirm?.cancel?.();
          setConfirm(null);
        }}
      />
    </section>
  );
}

function eventText(e: DealEvent): string {
  const d = e.details as Record<string, string | number | null>;
  switch (e.kind) {
    case "generated":
      return `Generated ${d.kind === "sow" ? "SOW" : "Proposal"} v${d.version}${d.section ? ` (section ${d.section})` : ""}`;
    case "restored":
      return `Restored ${d.kind === "sow" ? "SOW" : "Proposal"} v${d.restored_from} as v${d.version}`;
    case "approved":
      return `Approved (Proposal v${d.proposal_version}, SOW v${d.sow_version})`;
    case "sent":
      return "Signing link created";
    case "link_regenerated":
      return "Signing link regenerated";
    case "viewed":
      return "Client opened the signing page";
    case "signed":
      return `Signed by ${d.signer_name}${d.signer_title ? `, ${d.signer_title}` : ""}`;
    case "countersigned":
      return `Countersigned by ${d.name}`;
    case "reset_to_draft":
      return `Back to draft: ${d.cause}`;
    case "internal_fields_changed":
      return "Internal fields changed (owner, hours or tool builder)";
    case "internal_exported":
      return "Internal deal doc exported to Google Docs";
    default:
      return e.kind;
  }
}
