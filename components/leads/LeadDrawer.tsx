"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Lead, LeadStatus, TeamMember } from "@/lib/types";
import type { SavedAudit, ServiceKey } from "@/lib/lead-finder/types";
import { BRANCHES, BRANCH_COLORS, LEAD_STATUS_COLORS, SERVICETITAN_BADGE, type Branch } from "@/lib/theme";
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  TOUCH_CHANNELS,
  TOUCH_CHANNEL_LABELS,
  TOUCH_OUTCOMES,
  TOUCH_OUTCOME_LABELS,
  relativeTime,
  sourceLabel,
} from "@/lib/leads/labels";
import { LEAD_LIST_COLUMNS, RLS_HINT, canEditLead, type LeadListRow } from "@/lib/leads/list";
import LocalDateTime from "@/components/LocalDateTime";
import Popover from "@/components/table/Popover";
import ConvertDialog from "@/components/leads/ConvertDialog";
import { CONVERT_OUTCOMES, QUICK_TOUCHES, resolveChannel, type QuickTouch } from "@/lib/leads/quickTouch";
import { previewQuery } from "@/lib/lead-finder/previewQuery";

// One lead: status, owner (claim / assign), one-click and custom touches,
// next action, details, saved audit, scan findings, touch history, and
// Move to Interested (ConvertDialog; offered automatically after a touch
// with outcome interested or meeting_booked).

type Touch = {
  id: string;
  channel: string;
  direction: "outbound" | "inbound";
  outcome: string | null;
  summary: string | null;
  touched_by: string | null;
  touched_at: string;
};

const SCAN_LABELS: Record<ServiceKey, string> = { website: "Website", social: "Social", ecom: "E-commerce", ai: "AI" };

const input = "w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm text-foreground disabled:bg-neutral-50 disabled:text-neutral-500";
const label = "block text-xs font-medium text-neutral-600";
const btn =
  "rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50";
const primaryBtn = "rounded-md bg-header px-3 py-1.5 text-sm font-medium text-header-foreground disabled:opacity-50";
const sectionTitle = "text-xs font-semibold uppercase tracking-wide text-neutral-500";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function LeadDrawer({
  leadId,
  row,
  members,
  me,
  onChange,
  onClose,
}: {
  leadId: string;
  row: LeadListRow | null;
  members: TeamMember[];
  me: TeamMember | null;
  onChange: (row: LeadListRow) => void;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [lead, setLead] = useState<Lead | null>(null);
  const [touches, setTouches] = useState<Touch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isManager = me?.role === "Admin" || me?.role === "Manager";
  const memberName = (id: string | null) => members.find((m) => m.id === id)?.name ?? "Unknown";

  const load = useCallback(async () => {
    const [{ data: l, error: e1 }, { data: t }] = await Promise.all([
      supabase.from("leads").select("*").eq("id", leadId).maybeSingle(),
      supabase
        .from("lead_touches")
        .select("id, channel, direction, outcome, summary, touched_by, touched_at")
        .eq("lead_id", leadId)
        .order("touched_at", { ascending: false }),
    ]);
    if (e1) setError(e1.message);
    else if (!l) setError("That lead doesn't exist (it may have been deleted).");
    setLead((l as Lead) ?? null);
    setTouches((t ?? []) as Touch[]);
    return (l as Lead) ?? null;
  }, [supabase, leadId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const editable = !!lead && canEditLead(lead, me);

  // Write a patch; RLS-blocked updates come back with no row.
  async function save(patch: Record<string, unknown>, opts: { onlyUnowned?: boolean } = {}) {
    if (!lead) return false;
    setBusy(true);
    setError(null);
    let q = supabase.from("leads").update(patch).eq("id", lead.id);
    if (opts.onlyUnowned) q = q.is("owner", null);
    const { data, error: e } = await q.select(LEAD_LIST_COLUMNS);
    setBusy(false);
    if (e) {
      setError(e.message);
      return false;
    }
    if (!data?.length) {
      setError(opts.onlyUnowned ? "Someone else claimed it first." : RLS_HINT);
      await load();
      return false;
    }
    const fresh = data[0] as unknown as LeadListRow;
    setLead((prev) => (prev ? { ...prev, ...fresh } : prev));
    onChange(fresh);
    return true;
  }

  // ---- Quick-log ----
  const [channel, setChannel] = useState("cold_call");
  const [direction, setDirection] = useState<"outbound" | "inbound">("outbound");
  const [outcome, setOutcome] = useState("");
  const [summary, setSummary] = useState("");
  const [when, setWhen] = useState("");

  const [converting, setConverting] = useState(false);

  // Insert one touch as the current user, then reload (the touch trigger
  // moved last_touch_at and maybe the status).
  async function insertTouch(t: { channel: string; direction: string; outcome: string | null; summary: string | null; touched_at?: string }) {
    if (!lead || !me) return false;
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.from("lead_touches").insert({
      lead_id: lead.id,
      channel: t.channel,
      direction: t.direction,
      outcome: t.outcome,
      summary: t.summary,
      touched_by: me.id,
      touched_at: t.touched_at ?? new Date().toISOString(),
    });
    setBusy(false);
    if (e) {
      setError(e.message);
      return false;
    }
    const l = await load();
    if (l) {
      const { data } = await supabase.from("leads").select(LEAD_LIST_COLUMNS).eq("id", l.id).maybeSingle();
      if (data) onChange(data as unknown as LeadListRow);
      if (t.outcome && CONVERT_OUTCOMES.includes(t.outcome) && !l.project_id && canEditLead(l, me)) setConverting(true);
    }
    return true;
  }

  async function logTouch() {
    const ok = await insertTouch({
      channel,
      direction,
      outcome: outcome || null,
      summary: summary.trim() || null,
      touched_at: when ? new Date(when).toISOString() : undefined,
    });
    if (ok) {
      setOutcome("");
      setSummary("");
      setWhen("");
    }
  }

  // One-click touches: a small popover for an optional summary.
  const [quick, setQuick] = useState<QuickTouch | null>(null);
  const [quickSummary, setQuickSummary] = useState("");
  const quickAnchor = useRef<HTMLButtonElement | null>(null);
  const quickRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  async function logQuick() {
    if (!quick) return;
    const ok = await insertTouch({
      channel: resolveChannel(quick, touches[0]?.channel),
      direction: quick.direction,
      outcome: quick.outcome,
      summary: quickSummary.trim() || null,
    });
    if (ok) {
      setQuick(null);
      setQuickSummary("");
    }
  }

  const firstTouch = touches.length ? touches[touches.length - 1] : null;

  const title = lead?.company ?? row?.company ?? row?.name ?? "Lead";
  const audit = lead?.audit as SavedAudit | null | undefined;
  const scan = lead?.scan_tags as
    | { tags?: Partial<Record<ServiceKey, string[]>>; signals?: string[]; marketplaces?: string[]; hours?: string[] | null }
    | null
    | undefined;
  // Sample website mockup (Lead Finder preview), from what we know of the lead.
  const previewHref = lead
    ? "/api/lead-finder/preview?" +
      previewQuery({
        name: lead.company ?? lead.name,
        type: lead.industry ?? lead.category ?? "",
        phone: lead.phone ?? "",
        address: lead.address ?? "",
        rating: lead.rating ?? "",
        reviews: lead.review_count ?? 0,
        mapsUrl: lead.maps_url ?? "",
        hours: scan?.hours ?? null,
      })
    : "";

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" className="flex-1 cursor-default bg-black/20" onClick={onClose} />
      <aside className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-neutral-200 bg-white px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-foreground">{title}</h2>
              <p className="text-xs text-neutral-500">
                {sourceLabel(lead?.source ?? row?.source)}
                {(lead?.source_detail ?? row?.source_detail) ? ` · ${lead?.source_detail ?? row?.source_detail}` : ""}
                {lead?.found_by ? ` · found by ${memberName(lead.found_by)}` : ""}
              </p>
            </div>
            <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100">
              Close
            </button>
          </div>

          {lead && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select
                aria-label="Status"
                value={lead.status}
                disabled={!editable || busy}
                onChange={(e) => void save({ status: e.target.value as LeadStatus })}
                className={`rounded-full px-2 py-1 text-xs font-medium ${LEAD_STATUS_COLORS[lead.status]}`}
              >
                {LEAD_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {LEAD_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              {isManager ? (
                <select
                  aria-label="Owner"
                  value={lead.owner ?? ""}
                  disabled={busy}
                  onChange={(e) => void save({ owner: e.target.value || null })}
                  className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              ) : lead.owner ? (
                <span className="text-xs text-neutral-600">
                  Owner: <b>{memberName(lead.owner)}</b>
                  {lead.owner === me?.id && (
                    <button type="button" className="ml-2 text-accent hover:underline" disabled={busy} onClick={() => void save({ owner: null })}>
                      Release
                    </button>
                  )}
                </span>
              ) : (
                me && (
                  <button type="button" className={btn} disabled={busy} onClick={() => void save({ owner: me.id }, { onlyUnowned: true })}>
                    Claim
                  </button>
                )
              )}
              <span className="text-xs text-neutral-500">
                {lead.last_touch_at ? `Last touch ${relativeTime(lead.last_touch_at)}` : "No touches yet"}
              </span>
              {lead.project_id ? (
                <a href={`/project/${lead.project_id}`} className="ml-auto text-xs font-medium text-accent hover:underline">
                  Open linked project
                </a>
              ) : (
                editable &&
                me && (
                  <button type="button" className={`ml-auto ${primaryBtn}`} disabled={busy} onClick={() => setConverting(true)}>
                    Move to Interested
                  </button>
                )
              )}
            </div>
          )}
          {lead && !editable && <p className="mt-2 text-xs text-neutral-500">Owned by {memberName(lead.owner)}. You can log touches; {RLS_HINT.toLowerCase()}</p>}
          {error && (
            <p role="alert" className="mt-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>

        {!lead ? (
          <p className="px-5 py-8 text-sm text-neutral-400">{error ? "" : "Loading..."}</p>
        ) : (
          <div className="space-y-6 px-5 py-5">
            {/* Quick-log */}
            <section className="rounded-lg border border-neutral-200 p-3">
              <h3 className={sectionTitle}>Log a touch</h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {QUICK_TOUCHES.map((q) => (
                  <button
                    key={q.key}
                    ref={(el) => {
                      quickRefs.current[q.key] = el;
                    }}
                    type="button"
                    disabled={busy || !me}
                    onClick={() => {
                      quickAnchor.current = quickRefs.current[q.key];
                      setQuickSummary("");
                      setQuick(quick?.key === q.key ? null : q);
                    }}
                    className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                      quick?.key === q.key ? "border-accent bg-accent text-accent-foreground" : "border-neutral-300 text-neutral-700 hover:bg-neutral-50"
                    }`}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
              <Popover anchorRef={quickAnchor} open={!!quick} onClose={() => setQuick(null)} className="z-50 w-72 p-3">
                {quick && (
                  <div>
                    <div className="text-sm font-medium text-foreground">{quick.label}</div>
                    <textarea
                      autoFocus
                      rows={2}
                      value={quickSummary}
                      onChange={(e) => setQuickSummary(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void logQuick();
                        }
                      }}
                      placeholder="Summary (optional)"
                      className={`mt-2 ${input}`}
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button type="button" className={btn} onClick={() => setQuick(null)}>
                        Cancel
                      </button>
                      <button type="button" className={primaryBtn} disabled={busy} onClick={() => void logQuick()}>
                        Log
                      </button>
                    </div>
                  </div>
                )}
              </Popover>

              <h4 className="mt-4 text-xs font-semibold text-neutral-600">Custom touch</h4>
              <div className="mt-2 flex flex-wrap gap-1">
                {TOUCH_CHANNELS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={channel === c}
                    onClick={() => setChannel(c)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                      channel === c ? "border-accent bg-accent text-accent-foreground" : "border-neutral-300 text-neutral-700 hover:bg-neutral-50"
                    }`}
                  >
                    {TOUCH_CHANNEL_LABELS[c]}
                  </button>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <span className={label}>Direction</span>
                  <div className="mt-1 inline-flex rounded-md border border-neutral-300 p-0.5">
                    {(["outbound", "inbound"] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={direction === d}
                        onClick={() => setDirection(d)}
                        className={`rounded px-2 py-0.5 text-xs font-medium ${direction === d ? "bg-header text-header-foreground" : "text-neutral-700"}`}
                      >
                        {d === "outbound" ? "We reached out" : "They reached us"}
                      </button>
                    ))}
                  </div>
                </div>
                <label className={label}>
                  Outcome
                  <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className={`mt-1 ${input}`}>
                    <option value="">None yet</option>
                    {TOUCH_OUTCOMES.map((o) => (
                      <option key={o} value={o}>
                        {TOUCH_OUTCOME_LABELS[o]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className={`${label} mt-2`}>
                Summary <span className="font-normal text-neutral-400">optional</span>
                <textarea
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && void logTouch()}
                  rows={2}
                  className={`mt-1 ${input}`}
                />
              </label>
              <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
                <label className={label}>
                  When <span className="font-normal text-neutral-400">blank = now</span>
                  <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={`mt-1 ${input}`} />
                </label>
                <button type="button" className={primaryBtn} disabled={busy || !me} onClick={() => void logTouch()}>
                  Log touch
                </button>
              </div>
              <p className="mt-1 text-xs text-neutral-400">Logging updates the status automatically (e.g. Interested on a meeting booked).</p>
            </section>

            {/* Next action */}
            <section>
              <h3 className={sectionTitle}>Next action</h3>
              <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                <Field value={lead.next_action} disabled={!editable} placeholder="e.g. Send audit PDF" onSave={(v) => save({ next_action: v })} />
                <input
                  type="datetime-local"
                  aria-label="Next action date"
                  disabled={!editable}
                  defaultValue={toLocalInput(lead.next_action_at)}
                  onBlur={(e) => {
                    const v = e.target.value ? new Date(e.target.value).toISOString() : null;
                    if (v !== lead.next_action_at) void save({ next_action_at: v });
                  }}
                  className={input}
                />
              </div>
            </section>

            {/* Details */}
            <section>
              <h3 className={sectionTitle}>Details</h3>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
                {(
                  [
                    ["company", "Company"],
                    ["contact_name", "Contact"],
                    ["title", "Title"],
                    ["email", "Email"],
                    ["phone", "Phone"],
                    ["website", "Website"],
                    ["city", "City"],
                    ["state", "State"],
                    ["category", "Category"],
                    ["industry", "Industry"],
                  ] as [keyof Lead, string][]
                ).map(([k, text]) => (
                  <label key={k} className={label}>
                    {text}
                    <Field
                      value={(lead[k] as string | null) ?? null}
                      disabled={!editable}
                      required={k === "company"}
                      onSave={(v) => save({ [k]: v })}
                    />
                  </label>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-sm">
                {lead.email && <a className="text-accent hover:underline" href={`mailto:${lead.email}`}>Email</a>}
                {lead.phone && <a className="text-accent hover:underline" href={`tel:${lead.phone.replace(/[^0-9+]/g, "")}`}>Call</a>}
                {lead.website && <a className="text-accent hover:underline" href={lead.website} target="_blank" rel="noopener noreferrer">Website</a>}
                {lead.maps_url && <a className="text-accent hover:underline" href={lead.maps_url} target="_blank" rel="noopener noreferrer">Google Maps</a>}
                {lead.external_ids?.linkedin && (
                  <a className="text-accent hover:underline" href={lead.external_ids.linkedin} target="_blank" rel="noopener noreferrer">LinkedIn</a>
                )}
              </div>
              <div className="mt-3">
                <span className={label}>Branch fit</span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {BRANCHES.map((b) => {
                    const on = (lead.branch_fit ?? []).includes(b);
                    return (
                      <button
                        key={b}
                        type="button"
                        disabled={!editable || busy}
                        aria-pressed={on}
                        onClick={() =>
                          void save({
                            branch_fit: on ? lead.branch_fit.filter((x: Branch) => x !== b) : [...(lead.branch_fit ?? []), b],
                          })
                        }
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${on ? BRANCH_COLORS[b] : "border border-neutral-300 text-neutral-500"}`}
                      >
                        {b}
                      </button>
                    );
                  })}
                  {lead.uses_servicetitan && (
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${SERVICETITAN_BADGE}`}>ServiceTitan</span>
                  )}
                </div>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  disabled={!editable || busy}
                  checked={!!lead.wheaton_alum}
                  onChange={(e) => void save({ wheaton_alum: e.target.checked })}
                />
                Wheaton alum
              </label>
              <label className={`${label} mt-3`}>
                Notes
                <Field value={lead.notes} disabled={!editable} multiline onSave={(v) => save({ notes: v })} />
              </label>
            </section>

            {/* Saved audit */}
            <section>
              <h3 className={sectionTitle}>Audit</h3>
              {audit && audit.version === 1 ? (
                <div className="mt-2 space-y-2 text-sm">
                  <p className="text-neutral-600">
                    Saved <LocalDateTime iso={audit.ran_at} />
                    {audit.ran_by ? ` by ${memberName(audit.ran_by)}` : ""}.{" "}
                    <a className="text-accent hover:underline" href={`/lead-finder/audit?lead=${lead.id}`} target="_blank" rel="noopener noreferrer">
                      Open audit and call script
                    </a>
                    {lead.google_place_id && (
                      <>
                        {" · "}
                        <a className="text-accent hover:underline" href={previewHref} target="_blank" rel="noopener noreferrer">
                          Preview site
                        </a>
                      </>
                    )}
                  </p>
                  {audit.speed && !audit.speed.error && (
                    <div className="grid grid-cols-4 gap-2 text-center">
                      {(
                        [
                          ["Speed", audit.speed.performance],
                          ["SEO", audit.speed.seo],
                          ["Access.", audit.speed.accessibility],
                          ["Best pr.", audit.speed.bestPractices],
                        ] as [string, number | null | undefined][]
                      ).map(([k, v]) => (
                        <div key={k} className="rounded-md border border-neutral-200 py-1.5">
                          <div className={`text-lg font-semibold tabular-nums ${v == null ? "text-neutral-400" : v >= 90 ? "text-green-700" : v >= 50 ? "text-amber-700" : "text-red-700"}`}>
                            {v ?? "n/a"}
                          </div>
                          <div className="text-[11px] text-neutral-500">{k}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {audit.recommendations.length > 0 && (
                    <ol className="ml-5 list-decimal space-y-1 text-neutral-700">
                      {audit.recommendations.slice(0, 3).map((r) => (
                        <li key={r.title}>
                          <b>{r.title}.</b> {r.why}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ) : lead.google_place_id ? (
                <p className="mt-2 text-sm text-neutral-600">
                  No audit yet.{" "}
                  <a
                    className="text-accent hover:underline"
                    href={`/lead-finder/audit?${new URLSearchParams({ place: lead.google_place_id, type: lead.industry ?? lead.category ?? "", lead: lead.id })}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Run audit
                  </a>
                  {" · "}
                  <a className="text-accent hover:underline" href={previewHref} target="_blank" rel="noopener noreferrer">
                    Preview site
                  </a>{" "}
                  <span className="text-xs text-neutral-400">(1 Google Place Details call; saved here)</span>
                </p>
              ) : (
                <p className="mt-2 text-sm text-neutral-400">No audit. Audits need a Google Maps listing (Lead Finder leads have one).</p>
              )}
            </section>

            {/* Scan findings */}
            {scan?.tags && Object.values(scan.tags).some((t) => (t ?? []).length) && (
              <section>
                <h3 className={sectionTitle}>What they need (Lead Finder scan)</h3>
                <div className="mt-2 space-y-2 text-sm">
                  {(Object.keys(SCAN_LABELS) as ServiceKey[]).map((k) =>
                    (scan.tags?.[k] ?? []).length ? (
                      <div key={k}>
                        <b className="text-neutral-700">{SCAN_LABELS[k]}</b>
                        <ul className="ml-5 list-disc text-neutral-600">
                          {scan.tags![k]!.map((t) => (
                            <li key={t}>{t}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null
                  )}
                  {(scan.marketplaces ?? []).length > 0 && <p className="text-neutral-600">Sells on: {scan.marketplaces!.join(", ")}</p>}
                  {(scan.signals ?? []).length > 0 && <p className="text-xs text-neutral-500">{scan.signals!.join(" · ")}</p>}
                  <p className="text-xs text-neutral-500">
                    {lead.priority_score != null && <>Priority {lead.priority_score} · </>}
                    {lead.lead_score != null && <>Lead score {lead.lead_score} · </>}
                    {lead.rating != null && <>★ {Number(lead.rating).toFixed(1)} ({lead.review_count ?? 0} reviews) · </>}
                    {lead.website_status ?? ""}
                  </p>
                </div>
              </section>
            )}

            {/* Touches */}
            <section>
              <h3 className={sectionTitle}>History ({touches.length})</h3>
              {touches.length === 0 ? (
                <p className="mt-2 text-sm text-neutral-400">No touches logged yet.</p>
              ) : (
                <ol className="mt-2 space-y-2">
                  {touches.map((t) => (
                    <li key={t.id} className="rounded-md border border-neutral-200 px-3 py-2 text-sm">
                      <div className="flex flex-wrap items-center gap-x-2 text-neutral-700">
                        <b>{TOUCH_CHANNEL_LABELS[t.channel] ?? t.channel}</b>
                        <span className="text-xs text-neutral-500">{t.direction === "inbound" ? "inbound" : "outbound"}</span>
                        {t.outcome && <span className="rounded bg-neutral-100 px-1.5 text-xs">{TOUCH_OUTCOME_LABELS[t.outcome] ?? t.outcome}</span>}
                        <span className="ml-auto text-xs text-neutral-500">
                          {memberName(t.touched_by)} · <LocalDateTime iso={t.touched_at} />
                        </span>
                      </div>
                      {t.summary && <p className="mt-1 whitespace-pre-wrap text-neutral-600">{t.summary}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="border-t border-neutral-200 pt-4">
              {lead.project_id ? (
                <a href={`/project/${lead.project_id}`} className="text-sm text-accent hover:underline">
                  Open linked project
                </a>
              ) : editable && me ? (
                <button type="button" className={btn} disabled={busy} onClick={() => setConverting(true)}>
                  Move to Interested
                </button>
              ) : (
                <p className="text-xs text-neutral-400">Only the owner or an Admin/Manager can move this lead to Interested.</p>
              )}
              <p className="mt-2 text-xs text-neutral-400">
                Added <LocalDateTime iso={lead.created_at} />
              </p>
            </section>
          </div>
        )}
      </aside>
      {converting && lead && me && (
        <ConvertDialog
          lead={lead}
          firstTouch={firstTouch}
          members={members}
          me={me}
          onClose={() => setConverting(false)}
          onConverted={(projectId, fresh) => {
            setConverting(false);
            if (fresh) onChange(fresh);
            router.push(`/project/${projectId}`);
          }}
        />
      )}
    </div>
  );
}

// Text input that saves on blur (or Enter for single-line) when changed.
function Field({
  value,
  disabled,
  placeholder,
  multiline,
  required,
  onSave,
}: {
  value: string | null;
  disabled?: boolean;
  placeholder?: string;
  multiline?: boolean;
  required?: boolean;
  onSave: (v: string | null) => Promise<boolean>;
}) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  const commit = async () => {
    const next = v.trim() || null;
    if (next === (value ?? null)) return;
    if (required && !next) {
      setV(value ?? "");
      return;
    }
    const ok = await onSave(next);
    if (!ok) setV(value ?? "");
  };
  return multiline ? (
    <textarea
      value={v}
      disabled={disabled}
      rows={3}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => void commit()}
      className={`mt-1 ${input}`}
    />
  ) : (
    <input
      value={v}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className={`mt-1 ${input}`}
    />
  );
}
