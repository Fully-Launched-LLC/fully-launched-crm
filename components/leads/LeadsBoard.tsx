"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { LeadStatus, TeamMember } from "@/lib/types";
import { BRANCHES, BRANCH_COLORS, LEAD_STATUS_COLORS, SERVICETITAN_BADGE, UNKNOWN_MEMBER_COLOR, WHEATON_BADGE, type Branch } from "@/lib/theme";
import { memberColors } from "@/lib/team";
import { LEAD_SOURCES, LEAD_STATUSES, LEAD_STATUS_LABELS, relativeTime, sourceLabel } from "@/lib/leads/labels";
import { LEAD_LIST_COLUMNS, RLS_HINT, canEditLead, type LeadListRow } from "@/lib/leads/list";
import { QUICK_TOUCHES, resolveChannel } from "@/lib/leads/quickTouch";
import LeadDrawer from "@/components/leads/LeadDrawer";
import AddLeadDialog from "@/components/leads/AddLeadDialog";
import ImportDialog from "@/components/leads/ImportDialog";

type OwnerFilter = "all" | "mine" | "unassigned" | string;
type Sort = "priority" | "last_touch" | "newest" | "company";

const PAGE = 100;
const STALE_DAYS = 14;

const btn =
  "rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50";
const primaryBtn =
  "rounded-md bg-header px-3 py-1.5 text-sm font-medium text-header-foreground disabled:opacity-50";
const select = "rounded-md border border-neutral-300 px-2 py-1.5 text-sm text-foreground";

export default function LeadsBoard({
  initialLeads,
  members,
  me,
  initialOpenId,
}: {
  initialLeads: LeadListRow[];
  members: TeamMember[];
  me: TeamMember | null;
  initialOpenId: string | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const pathname = usePathname();
  const colors = useMemo(() => memberColors(members), [members]);
  const isManager = me?.role === "Admin" || me?.role === "Manager";

  const [leads, setLeads] = useState<LeadListRow[]>(initialLeads);
  // A server refresh (after an import) brings a new list.
  useEffect(() => setLeads(initialLeads), [initialLeads]);
  const [q, setQ] = useState("");
  const [statuses, setStatuses] = useState<Set<LeadStatus>>(new Set());
  const [owner, setOwner] = useState<OwnerFilter>("all");
  const [branch, setBranch] = useState<Branch | "">("");
  const [source, setSource] = useState("");
  const [sort, setSort] = useState<Sort>("priority");
  const [alumOnly, setAlumOnly] = useState(false);
  const [stOnly, setStOnly] = useState(false);
  const [stale, setStale] = useState(false);
  const [bulkTouch, setBulkTouch] = useState("");
  const [bulkSummary, setBulkSummary] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [dialog, setDialog] = useState<"add" | "import" | null>(null);

  const memberName = (id: string | null) => members.find((m) => m.id === id)?.name ?? "Unknown";

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = leads.filter((l) => {
      if (statuses.size && !statuses.has(l.status)) return false;
      if (owner === "mine" && l.owner !== me?.id) return false;
      if (owner === "unassigned" && l.owner) return false;
      if (owner !== "all" && owner !== "mine" && owner !== "unassigned" && l.owner !== owner) return false;
      if (branch && !(l.branch_fit ?? []).includes(branch)) return false;
      if (source && l.source !== source) return false;
      if (alumOnly && !l.wheaton_alum) return false;
      if (stOnly && !l.uses_servicetitan) return false;
      // No touch in 14+ days: touched at least once, last touch older than that.
      if (stale && (!l.last_touch_at || Date.now() - new Date(l.last_touch_at).getTime() < STALE_DAYS * 86_400_000)) return false;
      if (needle) {
        const hay = [l.company, l.name, l.contact_name, l.email, l.city, l.category, l.industry, l.source_detail]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const t = (s: string | null) => (s ? new Date(s).getTime() : 0);
    return list.sort((a, b) =>
      sort === "company"
        ? (a.company ?? a.name).localeCompare(b.company ?? b.name)
        : sort === "newest"
          ? t(b.created_at) - t(a.created_at)
          : sort === "last_touch"
            ? t(b.last_touch_at) - t(a.last_touch_at)
            : // Default: Wheaton alumni first, then priority.
              Number(!!b.wheaton_alum) - Number(!!a.wheaton_alum) ||
              (b.priority_score ?? -1) - (a.priority_score ?? -1) ||
              t(b.created_at) - t(a.created_at)
    );
  }, [leads, q, statuses, owner, branch, source, alumOnly, stOnly, stale, sort, me?.id]);

  const shown = filtered.slice(0, limit);
  const checkedRows = leads.filter((l) => checked.has(l.id));
  const allShownChecked = shown.length > 0 && shown.every((l) => checked.has(l.id));

  function replaceRows(rows: LeadListRow[]) {
    const byId = new Map(rows.map((r) => [r.id, r]));
    setLeads((prev) => prev.map((l) => byId.get(l.id) ?? l));
  }

  function openLead(id: string | null) {
    setOpenId(id);
    router.replace(id ? `${pathname}?lead=${id}` : pathname, { scroll: false });
  }

  // Bulk updates. RLS decides per row; rows it blocks just don't come back.
  async function bulkUpdate(ids: string[], patch: Record<string, unknown>, label: string, onlyUnowned = false) {
    if (!ids.length) return;
    setBusy(true);
    setMessage(null);
    let query = supabase.from("leads").update(patch).in("id", ids);
    if (onlyUnowned) query = query.is("owner", null);
    const { data, error } = await query.select(LEAD_LIST_COLUMNS);
    setBusy(false);
    if (error) {
      setMessage({ tone: "error", text: error.message });
      return;
    }
    const rows = (data ?? []) as unknown as LeadListRow[];
    replaceRows(rows);
    const missed = ids.length - rows.length;
    setMessage(
      missed
        ? {
            tone: "error",
            text: `${label} ${rows.length}. ${missed} not changed: ${onlyUnowned ? "they already have an owner." : RLS_HINT}`,
          }
        : { tone: "ok", text: `${label} ${rows.length}.` }
    );
    if (!missed) setChecked(new Set());
  }

  // Bulk "Log touch": the same one-click touch on every selected lead the
  // user may work (owner, unassigned, or Admin/Manager); others are skipped.
  async function bulkLogTouch() {
    const q = QUICK_TOUCHES.find((x) => x.key === bulkTouch);
    if (!q || !me) return;
    const allowed = checkedRows.filter((l) => canEditLead(l, me));
    const skipped = checkedRows.length - allowed.length;
    if (!allowed.length) {
      setMessage({ tone: "error", text: `Nothing logged. ${RLS_HINT}` });
      return;
    }
    setBusy(true);
    setMessage(null);
    const ids = allowed.map((l) => l.id);
    const lastChannel = new Map<string, string>();
    if (q.channel === "last") {
      for (let i = 0; i < ids.length; i += 100) {
        const { data } = await supabase
          .from("lead_touches")
          .select("lead_id, channel, touched_at")
          .in("lead_id", ids.slice(i, i + 100))
          .order("touched_at", { ascending: false });
        (data ?? []).forEach((t) => !lastChannel.has(t.lead_id) && lastChannel.set(t.lead_id, t.channel));
      }
    }
    const now = new Date().toISOString();
    const { data: inserted, error } = await supabase
      .from("lead_touches")
      .insert(
        ids.map((id) => ({
          lead_id: id,
          channel: resolveChannel(q, lastChannel.get(id)),
          direction: q.direction,
          outcome: q.outcome,
          summary: bulkSummary.trim() || null,
          touched_by: me.id,
          touched_at: now,
        }))
      )
      .select("lead_id");
    if (error) {
      setBusy(false);
      setMessage({ tone: "error", text: error.message });
      return;
    }
    // The touch trigger moved status and last touch: reload those rows.
    const { data: fresh } = await supabase.from("leads").select(LEAD_LIST_COLUMNS).in("id", ids);
    if (fresh) replaceRows(fresh as unknown as LeadListRow[]);
    setBusy(false);
    setBulkTouch("");
    setBulkSummary("");
    const n = inserted?.length ?? 0;
    setMessage(
      skipped
        ? { tone: "error", text: `Logged "${q.label}" on ${n}. ${skipped} skipped: owned by someone else.` }
        : { tone: "ok", text: `Logged "${q.label}" on ${n}.` }
    );
    if (!skipped) setChecked(new Set());
  }

  function exportCsv() {
    const rows = checkedRows.length ? checkedRows : filtered;
    const headers = ["Company", "Contact", "Title", "Email", "Phone", "Website", "City", "State", "Status", "Owner", "Branch fit",
      "Priority", "Source", "Source detail", "Last touch", "Next action", "Next action date", "Google Maps Link", "Notes"];
    const cells = rows.map((l) => [l.company ?? l.name, l.contact_name, l.title, l.email, l.phone, l.website, l.city, l.state,
      LEAD_STATUS_LABELS[l.status], l.owner ? memberName(l.owner) : "", (l.branch_fit ?? []).join("; "), l.priority_score,
      sourceLabel(l.source), l.source_detail, l.last_touch_at, l.next_action, l.next_action_at, l.maps_url, l.notes]);
    const csv = [headers, ...cells]
      .map((r) => r.map((c) => '"' + String(c ?? "").replace(/"/g, '""') + '"').join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `fullylaunched-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const openRow = leads.find((l) => l.id === openId) ?? null;

  const ownerPill = (id: string | null) =>
    id ? (
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors.get(id) ?? UNKNOWN_MEMBER_COLOR}`}>{memberName(id)}</span>
    ) : (
      <span className="text-xs text-neutral-400">Unassigned</span>
    );

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Leads</h1>
          <p className="mt-1 text-sm text-neutral-500">
            The shared lead list. Lead Finder adds, CSV imports and manual adds all check for duplicates first.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className={btn} onClick={() => setDialog("import")}>
            Import CSV
          </button>
          <button type="button" className={primaryBtn} onClick={() => setDialog("add")}>
            + Add lead
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search company, contact, email, city..."
          aria-label="Search leads"
          className="w-64 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
        />
        <select aria-label="Owner" className={select} value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="all">All owners</option>
          <option value="mine">Mine</option>
          <option value="unassigned">Unassigned</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <select aria-label="Branch fit" className={select} value={branch} onChange={(e) => setBranch(e.target.value as Branch | "")}>
          <option value="">All branches</option>
          {BRANCHES.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <select aria-label="Source" className={select} value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">All sources</option>
          {LEAD_SOURCES.map((s) => (
            <option key={s} value={s}>
              {sourceLabel(s)}
            </option>
          ))}
        </select>
        <select aria-label="Sort" className={select} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="priority">Sort: alumni, then priority</option>
          <option value="last_touch">Sort: last touch</option>
          <option value="newest">Sort: newest</option>
          <option value="company">Sort: company</option>
        </select>
        {(
          [
            ["Wheaton alum", alumOnly, setAlumOnly],
            ["ServiceTitan", stOnly, setStOnly],
            [`No touch in ${STALE_DAYS}+ days`, stale, setStale],
          ] as [string, boolean, (v: boolean) => void][]
        ).map(([text, on, set]) => (
          <button
            key={text}
            type="button"
            aria-pressed={on}
            onClick={() => set(!on)}
            className={`rounded-md border px-2.5 py-1.5 text-sm ${
              on ? "border-accent bg-accent text-accent-foreground" : "border-neutral-300 text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            {text}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {LEAD_STATUSES.map((s) => {
          const on = statuses.has(s);
          const n = leads.filter((l) => l.status === s).length;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              onClick={() =>
                setStatuses((prev) => {
                  const next = new Set(prev);
                  if (on) next.delete(s);
                  else next.add(s);
                  return next;
                })
              }
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                on ? LEAD_STATUS_COLORS[s] + " ring-2 ring-accent/40" : "border border-neutral-200 text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              {LEAD_STATUS_LABELS[s]} <span className="opacity-60">{n}</span>
            </button>
          );
        })}
        {statuses.size > 0 && (
          <button type="button" className="text-xs text-accent hover:underline" onClick={() => setStatuses(new Set())}>
            Clear
          </button>
        )}
      </div>

      {/* Bulk bar */}
      {checked.size > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
          <span className="font-medium text-foreground">{checked.size} selected</span>
          {me && (
            <button
              type="button"
              className={btn}
              disabled={busy || !checkedRows.some((l) => !l.owner)}
              onClick={() => void bulkUpdate(checkedRows.filter((l) => !l.owner).map((l) => l.id), { owner: me.id }, "Claimed", true)}
            >
              Claim unassigned
            </button>
          )}
          {isManager && (
            <select
              aria-label="Assign to"
              className={select}
              value=""
              disabled={busy}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                void bulkUpdate(Array.from(checked), { owner: v === "none" ? null : v }, v === "none" ? "Unassigned" : `Assigned to ${memberName(v)}:`);
              }}
            >
              <option value="">Assign to...</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
              <option value="none">Nobody (unassign)</option>
            </select>
          )}
          <select
            aria-label="Set status"
            className={select}
            value=""
            disabled={busy}
            onChange={(e) => {
              const v = e.target.value as LeadStatus;
              if (v) void bulkUpdate(Array.from(checked), { status: v }, `Marked ${LEAD_STATUS_LABELS[v].toLowerCase()}:`);
            }}
          >
            <option value="">Set status...</option>
            {LEAD_STATUSES.filter((s) => s !== "converted").map((s) => (
              <option key={s} value={s}>
                {LEAD_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {me && (
            <select aria-label="Log touch" className={select} value={bulkTouch} disabled={busy} onChange={(e) => setBulkTouch(e.target.value)}>
              <option value="">Log touch...</option>
              {QUICK_TOUCHES.map((q) => (
                <option key={q.key} value={q.key}>
                  {q.label}
                </option>
              ))}
            </select>
          )}
          {bulkTouch && (
            <span className="flex flex-wrap items-center gap-2">
              <input
                value={bulkSummary}
                onChange={(e) => setBulkSummary(e.target.value)}
                placeholder="Summary (optional)"
                aria-label="Touch summary"
                className="w-48 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
              />
              <button type="button" className={primaryBtn} disabled={busy} onClick={() => void bulkLogTouch()}>
                Log on {checkedRows.filter((l) => canEditLead(l, me)).length}
              </button>
              <button type="button" className={btn} onClick={() => setBulkTouch("")}>
                Cancel
              </button>
            </span>
          )}
          <button type="button" className={btn} onClick={exportCsv}>
            Export selected
          </button>
          <button type="button" className={btn} onClick={() => setChecked(new Set())}>
            Clear
          </button>
        </div>
      )}

      {message && (
        <p
          role="status"
          className={`mt-3 rounded-md border px-3 py-2 text-sm ${
            message.tone === "ok" ? "border-green-200 bg-green-50 text-green-700" : "border-red-300 bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between text-sm text-neutral-500">
        <span>
          {filtered.length} of {leads.length} leads
        </span>
        {checked.size === 0 && (
          <button type="button" className="text-accent hover:underline" onClick={exportCsv}>
            Export these to CSV
          </button>
        )}
      </div>

      <div className="mt-2 overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  aria-label="Select all shown leads"
                  checked={allShownChecked}
                  onChange={(e) =>
                    setChecked((prev) => {
                      const next = new Set(prev);
                      shown.forEach((l) => (e.target.checked ? next.add(l.id) : next.delete(l.id)));
                      return next;
                    })
                  }
                />
              </th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Contact</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Branch fit</th>
              <th className="px-3 py-2" title="Who to call first (Lead Finder priority score)">
                Priority
              </th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Last touch</th>
              <th className="px-3 py-2">Next action</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <tr
                key={l.id}
                onClick={() => openLead(l.id)}
                className={`cursor-pointer border-b border-neutral-100 align-top last:border-0 ${
                  l.id === openId ? "bg-neutral-100" : "hover:bg-neutral-50"
                }`}
              >
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    aria-label={`Select ${l.company ?? l.name}`}
                    checked={checked.has(l.id)}
                    onChange={(e) =>
                      setChecked((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(l.id);
                        else next.delete(l.id);
                        return next;
                      })
                    }
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium text-foreground">
                    {l.company ?? l.name}
                    {l.wheaton_alum && (
                      <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-semibold ${WHEATON_BADGE}`}>Wheaton</span>
                    )}
                    {l.uses_servicetitan && (
                      <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-semibold ${SERVICETITAN_BADGE}`}>ServiceTitan</span>
                    )}
                  </div>
                  <div className="text-xs text-neutral-500">{[l.category, [l.city, l.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="text-foreground">{l.contact_name ?? ""}</div>
                  <div className="text-xs text-neutral-500">{l.email ?? l.phone ?? ""}</div>
                </td>
                <td className="px-3 py-2">
                  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${LEAD_STATUS_COLORS[l.status]}`}>
                    {LEAD_STATUS_LABELS[l.status]}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2" onClick={(e) => !l.owner && me && e.stopPropagation()}>
                  {l.owner ? (
                    ownerPill(l.owner)
                  ) : me ? (
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-md border border-neutral-300 px-2 py-0.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                      onClick={() => void bulkUpdate([l.id], { owner: me.id }, "Claimed", true)}
                    >
                      Claim
                    </button>
                  ) : (
                    ownerPill(null)
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {(l.branch_fit ?? []).map((b) => (
                      <span key={b} className={`rounded-full px-2 py-0.5 text-xs font-medium ${BRANCH_COLORS[b]}`}>
                        {b}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2 tabular-nums font-semibold text-foreground">{l.priority_score ?? ""}</td>
                <td className="px-3 py-2">
                  <div className="text-neutral-700">{sourceLabel(l.source)}</div>
                  {l.source_detail && <div className="max-w-[180px] truncate text-xs text-neutral-500" title={l.source_detail}>{l.source_detail}</div>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-neutral-700">{l.last_touch_at ? relativeTime(l.last_touch_at) : <span className="text-neutral-400">Never</span>}</td>
                <td className="px-3 py-2">
                  <div className="max-w-[200px] truncate text-neutral-700" title={l.next_action ?? ""}>{l.next_action ?? ""}</div>
                  {l.next_action_at && (
                    <div className={`text-xs ${new Date(l.next_action_at).getTime() < Date.now() ? "font-medium text-red-700" : "text-neutral-500"}`}>
                      {new Date(l.next_action_at).toLocaleDateString()}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-neutral-400">
                  {leads.length ? "No leads match these filters." : "No leads yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {filtered.length > limit && (
        <div className="mt-3 text-center">
          <button type="button" className={btn} onClick={() => setLimit((n) => n + PAGE)}>
            Show more ({filtered.length - limit} left)
          </button>
        </div>
      )}

      {openId && (
        <LeadDrawer
          key={openId}
          leadId={openId}
          row={openRow}
          members={members}
          me={me}
          onChange={(row) => replaceRows([row])}
          onClose={() => openLead(null)}
        />
      )}
      {dialog === "add" && (
        <AddLeadDialog
          me={me}
          onClose={() => setDialog(null)}
          onOpenLead={(id) => {
            setDialog(null);
            openLead(id);
          }}
          onAdded={(row) => {
            setLeads((prev) => [row, ...prev]);
            setDialog(null);
            openLead(row.id);
          }}
        />
      )}
      {dialog === "import" && (
        <ImportDialog
          me={me}
          onClose={() => setDialog(null)}
          onImported={() => router.refresh()}
        />
      )}
    </div>
  );
}
