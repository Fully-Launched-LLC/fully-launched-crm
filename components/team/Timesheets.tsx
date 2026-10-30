"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { TIME_STATUS_COLORS } from "@/lib/theme";
import {
  ENTRY_TYPES,
  ENTRY_TYPE_LABELS,
  PAY_TIMEZONE,
  RANGE_PRESET_LABELS,
  countsTowardPay,
  formatMinutes,
  formatPayDate,
  friendlyClockError,
  isForgotten,
  isPayDate,
  isWholeWeek,
  matchPreset,
  needsApproval,
  payDateOf,
  payDayRange,
  presetRange,
  shiftPayDate,
  type PayDate,
  type PayRange,
  type RangePreset,
} from "@/lib/timeclock";
import type {
  TeamMember,
  TimeEntryEdit,
  TimeEntryNet,
  TimeEntryType,
} from "@/lib/types";
import EditTimeEntryDialog from "@/components/team/EditTimeEntryDialog";
import AccomplishedDialog from "@/components/clock/AccomplishedDialog";

type Status = keyof typeof TIME_STATUS_COLORS;

function entryStatus(e: TimeEntryNet, now: number): Status | null {
  if (isForgotten(e, now)) return "Forgot to clock out?";
  if (e.clock_out === null) return "Open";
  if (e.entry_type !== "management") return null;
  return e.approved_at ? "Approved" : "Pending approval";
}

type Summary = {
  byType: Record<TimeEntryType, number>;
  pendingManagement: number;
  deductionCount: number;
  adjustmentMinutes: number;
  total: number;
};

function summarize(entries: TimeEntryNet[]): Summary {
  const s: Summary = {
    byType: { project: 0, management: 0, sales: 0, internal: 0 },
    pendingManagement: 0,
    deductionCount: 0,
    adjustmentMinutes: 0,
    total: 0,
  };
  for (const e of entries) {
    s.deductionCount += e.deduction_count;
    s.adjustmentMinutes += e.adjustment_minutes;
    if (countsTowardPay(e)) {
      s.byType[e.entry_type] += e.net_minutes;
      s.total += e.net_minutes;
    } else {
      s.pendingManagement += e.net_minutes;
    }
  }
  return s;
}

// Entries grouped by the PAY_TIMEZONE day of their clock_in, oldest first.
function groupByDay(entries: TimeEntryNet[]) {
  const days = new Map<PayDate, TimeEntryNet[]>();
  for (const e of entries) {
    const day = payDateOf(new Date(e.clock_in));
    days.set(day, [...(days.get(day) ?? []), e]);
  }
  return Array.from(days.entries()).sort(([a], [b]) => a.localeCompare(b));
}

const dayFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});
const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const PRESETS = Object.keys(RANGE_PRESET_LABELS) as RangePreset[];

export default function Timesheets({
  members,
  isAdmin,
  currentMemberId,
  range,
}: {
  members: TeamMember[];
  isAdmin: boolean;
  currentMemberId: string | null;
  // Validated from ?from=&to= by the page; whole PAY_TIMEZONE days, inclusive.
  range: PayRange;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const pathname = usePathname();
  const [entries, setEntries] = useState<TimeEntryNet[]>([]);
  // Open entries from any date, so a forgotten one is never out of view.
  const [openEntries, setOpenEntries] = useState<TimeEntryNet[]>([]);
  const [projectNames, setProjectNames] = useState<Map<string, string>>(new Map());
  const [edits, setEdits] = useState<Map<string, TimeEntryEdit[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TimeEntryNet | null>(null);
  const [editingNote, setEditingNote] = useState<TimeEntryNet | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Shows the date pickers even when the range matches a preset.
  const [customOpen, setCustomOpen] = useState(false);

  const preset = matchPreset(range);
  const wholeWeek = isWholeWeek(range);
  const showCustom = customOpen || (!preset && !wholeWeek);

  const membersById = useMemo(
    () => new Map(members.map((m) => [m.id, m.name])),
    [members]
  );

  function setRange(next: PayRange) {
    router.replace(`${pathname}?from=${next.from}&to=${next.to}`, { scroll: false });
  }

  const load = useCallback(async () => {
    setLoading(true);
    const { start, end } = payDayRange(range.from, range.to);
    const [inRange, open] = await Promise.all([
      supabase
        .from("time_entries_net")
        .select("*")
        .gte("clock_in", start.toISOString())
        .lt("clock_in", end.toISOString())
        .order("clock_in"),
      supabase
        .from("time_entries_net")
        .select("*")
        .is("clock_out", null)
        .order("clock_in"),
    ]);
    if (inRange.error || open.error) {
      setError((inRange.error ?? open.error)!.message);
      setLoading(false);
      return;
    }
    const rangeRows = (inRange.data ?? []) as TimeEntryNet[];
    const openRows = (open.data ?? []) as TimeEntryNet[];
    const all = [...rangeRows, ...openRows];

    const projectIds = Array.from(
      new Set(all.map((e) => e.project_id).filter((id): id is string => !!id))
    );
    const entryIds = Array.from(new Set(all.map((e) => e.id)));
    const [projects, editRows] = await Promise.all([
      projectIds.length
        ? supabase.from("projects").select("id, client_name").in("id", projectIds)
        : Promise.resolve({ data: [], error: null }),
      entryIds.length
        ? supabase
            .from("time_entry_edits")
            .select("*")
            .in("time_entry_id", entryIds)
            .order("edited_at")
        : Promise.resolve({ data: [], error: null }),
    ]);

    setProjectNames(
      new Map(
        ((projects.data ?? []) as { id: string; client_name: string }[]).map((p) => [
          p.id,
          p.client_name,
        ])
      )
    );
    const editMap = new Map<string, TimeEntryEdit[]>();
    for (const ed of (editRows.data ?? []) as TimeEntryEdit[]) {
      editMap.set(ed.time_entry_id, [...(editMap.get(ed.time_entry_id) ?? []), ed]);
    }
    setEdits(editMap);
    setEntries(rangeRows);
    setOpenEntries(openRows);
    setNow(Date.now());
    setError(null);
    setLoading(false);
  }, [supabase, range.from, range.to]);

  useEffect(() => {
    load();
  }, [load]);

  const byMember = useMemo(() => {
    const map = new Map<string, TimeEntryNet[]>();
    for (const e of entries) map.set(e.user_id, [...(map.get(e.user_id) ?? []), e]);
    return map;
  }, [entries]);

  const grandTotal = useMemo(() => summarize(entries), [entries]);

  async function approve(entry: TimeEntryNet) {
    // The database stamps approved_by/approved_at itself and rejects
    // non-Admins; a blocked update comes back as zero rows.
    const { data, error } = await supabase
      .from("time_entries")
      .update({ approved_at: new Date().toISOString() })
      .eq("id", entry.id)
      .select("id");
    if (error) setError(error.message);
    else if (!data?.length) setError("Only Admins can approve entries.");
    await load();
  }

  // Owners edit their own note after clocking out (migration 015); times
  // stay locked.
  async function saveNote(entry: TimeEntryNet, text: string) {
    setNoteSaving(true);
    setNoteError(null);
    const { data, error } = await supabase
      .from("time_entries")
      .update({ accomplished: text })
      .eq("id", entry.id)
      .select("id");
    setNoteSaving(false);
    if (error) return setNoteError(friendlyClockError(error));
    if (!data?.length) return setNoteError("You can only edit your own entries.");
    setEditingNote(null);
    await load();
  }

  function toggle(set: Set<string>, id: string) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }

  const headerCell =
    "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500";
  const entryHeaders = [
    "In",
    "Out",
    "Type",
    "Project",
    "Net",
    "Deductions",
    "Status",
    ...(isAdmin ? [""] : []),
  ];

  // One entry: its row plus the accomplishment note underneath.
  function entryRows(e: TimeEntryNet, opts: { showPerson: boolean; showDate: boolean }) {
    const status = entryStatus(e, now);
    const entryEdits = edits.get(e.id) ?? [];
    const flagged = status === "Forgot to clock out?";
    const tint = flagged ? "bg-red-50" : e.clock_out === null ? "bg-amber-50/60" : "";
    const colCount = entryHeaders.length + (opts.showPerson ? 1 : 0) + (opts.showDate ? 1 : 0);
    const noteOpen = openNotes.has(e.id);
    const canEditNote = e.clock_out !== null && e.user_id === currentMemberId;
    return (
      <Fragment key={e.id}>
        <tr className={tint}>
          {opts.showPerson && (
            <td className="px-3 pt-2 font-medium text-foreground">
              {membersById.get(e.user_id) ?? "Unknown"}
            </td>
          )}
          {opts.showDate && (
            <td className="whitespace-nowrap px-3 pt-2 text-neutral-700">
              {dayFmt.format(new Date(e.clock_in))}
            </td>
          )}
          <td className="whitespace-nowrap px-3 pt-2 text-neutral-700">
            {timeFmt.format(new Date(e.clock_in))}
          </td>
          <td className="whitespace-nowrap px-3 pt-2 text-neutral-700">
            {e.clock_out ? timeFmt.format(new Date(e.clock_out)) : ""}
          </td>
          <td className="px-3 pt-2 text-neutral-700">{ENTRY_TYPE_LABELS[e.entry_type]}</td>
          <td className="px-3 pt-2 text-neutral-700">
            {e.project_id ? projectNames.get(e.project_id) ?? "Deleted project" : ""}
          </td>
          <td className="whitespace-nowrap px-3 pt-2 tabular-nums text-foreground">
            {formatMinutes(e.net_minutes)}
          </td>
          <td className="whitespace-nowrap px-3 pt-2 tabular-nums text-neutral-700">
            {e.deduction_count > 0
              ? `${e.deduction_count} (${formatMinutes(e.adjustment_minutes)})`
              : ""}
          </td>
          <td className="px-3 pt-2">
            <div className="flex flex-wrap items-center gap-1">
              {status && (
                <span
                  className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${TIME_STATUS_COLORS[status]}`}
                >
                  {status}
                </span>
              )}
              {entryEdits.length > 0 && (
                <details className="text-xs text-neutral-500">
                  <summary className="cursor-pointer">Edited ({entryEdits.length})</summary>
                  <ul className="mt-1 space-y-1">
                    {entryEdits.map((ed) => (
                      <li key={ed.id}>
                        {ed.field === "clock_in" ? "In" : "Out"}:{" "}
                        {ed.old_value ? timeFmt.format(new Date(ed.old_value)) : "open"} to{" "}
                        {ed.new_value ? timeFmt.format(new Date(ed.new_value)) : "open"} by{" "}
                        {(ed.edited_by && membersById.get(ed.edited_by)) ?? "Unknown"}: {ed.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </td>
          {isAdmin && (
            <td className="whitespace-nowrap px-3 pt-2 text-right">
              {needsApproval(e) && e.clock_out && (
                <button
                  type="button"
                  onClick={() => approve(e)}
                  className="mr-2 rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-foreground"
                >
                  Approve
                </button>
              )}
              <button
                type="button"
                onClick={() => setEditing(e)}
                className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Edit
              </button>
            </td>
          )}
        </tr>
        <tr className={`border-b border-neutral-100 ${tint}`}>
          <td colSpan={colCount} className="px-3 pb-2 pt-1 text-sm">
            {e.accomplished ? (
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => setOpenNotes((s) => toggle(s, e.id))}
                  aria-expanded={noteOpen}
                  title={noteOpen ? "Show less" : "Show all"}
                  className={`flex-1 whitespace-pre-wrap text-left text-neutral-600 ${
                    noteOpen ? "" : "line-clamp-2"
                  }`}
                >
                  {e.accomplished}
                </button>
                {canEditNote && (
                  <button
                    type="button"
                    onClick={() => {
                      setNoteError(null);
                      setEditingNote(e);
                    }}
                    className="shrink-0 text-xs text-neutral-500 hover:text-foreground"
                  >
                    Edit note
                  </button>
                )}
              </div>
            ) : (
              <span className="text-xs text-neutral-400">
                {e.clock_out === null ? "Still clocked in." : "No note."}
              </span>
            )}
          </td>
        </tr>
      </Fragment>
    );
  }

  const today = payDateOf();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={showCustom ? "custom" : preset ?? "week"}
          onChange={(e) => {
            const value = e.target.value;
            if (value === "custom") return setCustomOpen(true);
            if (value === "week") return;
            setCustomOpen(false);
            setRange(presetRange(value as RangePreset, today));
          }}
          aria-label="Date range"
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm text-foreground"
        >
          {PRESETS.map((p) => (
            <option key={p} value={p}>
              {RANGE_PRESET_LABELS[p]}
            </option>
          ))}
          {!preset && wholeWeek && !showCustom && (
            <option value="week">Week of {formatPayDate(range.from)}</option>
          )}
          <option value="custom">Custom</option>
        </select>

        {wholeWeek && !showCustom && (
          <>
            <button
              type="button"
              onClick={() =>
                setRange({ from: shiftPayDate(range.from, -7), to: shiftPayDate(range.to, -7) })
              }
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50"
              aria-label="Previous week"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() =>
                setRange({ from: shiftPayDate(range.from, 7), to: shiftPayDate(range.to, 7) })
              }
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50"
              aria-label="Next week"
            >
              →
            </button>
          </>
        )}

        {showCustom && (
          <span className="flex flex-wrap items-center gap-2 text-sm text-neutral-600">
            <input
              type="date"
              value={range.from}
              max={range.to}
              onChange={(e) =>
                isPayDate(e.target.value) &&
                e.target.value <= range.to &&
                setRange({ from: e.target.value, to: range.to })
              }
              aria-label="Start date"
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm text-foreground"
            />
            to
            <input
              type="date"
              value={range.to}
              min={range.from}
              onChange={(e) =>
                isPayDate(e.target.value) &&
                e.target.value >= range.from &&
                setRange({ from: range.from, to: e.target.value })
              }
              aria-label="End date"
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm text-foreground"
            />
          </span>
        )}

        <span className="text-sm font-medium text-foreground">
          {range.from === range.to
            ? formatPayDate(range.from, { weekday: "short", year: "numeric" })
            : `${formatPayDate(range.from)} to ${formatPayDate(range.to, { year: "numeric" })}`}
        </span>
        {loading && <span className="text-sm text-neutral-400">Loading...</span>}
      </div>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      {openEntries.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-foreground">Clocked in now</h2>
          <div className="mt-2 overflow-x-auto rounded-lg border border-neutral-200">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50">
                  {["Person", "Date", ...entryHeaders].map((h, i) => (
                    <th key={`${h}-${i}`} className={headerCell}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {openEntries.map((e) => entryRows(e, { showPerson: true, showDate: true }))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50">
              {[
                "Person",
                ...ENTRY_TYPES.map((t) => ENTRY_TYPE_LABELS[t]),
                "Deductions",
                "Total",
              ].map((h) => (
                <th key={h} className={headerCell}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const rows = byMember.get(m.id) ?? [];
              const s = summarize(rows);
              const hasFlagged = rows.some((e) => isForgotten(e, now));
              const hasOpen = rows.some((e) => e.clock_out === null);
              const isOpen = expanded.has(m.id);
              return (
                <Fragment key={m.id}>
                  <tr
                    className={`border-b border-neutral-100 ${
                      hasFlagged ? "bg-red-50" : hasOpen ? "bg-amber-50/60" : ""
                    }`}
                  >
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setExpanded((prev) => toggle(prev, m.id))}
                        aria-expanded={isOpen}
                        disabled={rows.length === 0}
                        className="flex items-center gap-1 font-medium text-foreground disabled:cursor-default"
                      >
                        <span aria-hidden className="w-3 text-neutral-400">
                          {rows.length > 0 ? (isOpen ? "▾" : "▸") : ""}
                        </span>
                        {m.name}
                      </button>
                    </td>
                    <SummaryCells s={s} empty={rows.length === 0} />
                  </tr>
                  {isOpen && rows.length > 0 && (
                    <tr className="border-b border-neutral-200 bg-neutral-50/50">
                      <td colSpan={ENTRY_TYPES.length + 3} className="px-3 py-2">
                        <table className="w-full border-collapse text-sm">
                          <thead>
                            <tr>
                              {entryHeaders.map((h, i) => (
                                <th
                                  key={`${h}-${i}`}
                                  className="px-3 py-1 text-left text-xs font-medium text-neutral-500"
                                >
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {groupByDay(rows).map(([day, dayRows]) => (
                              <Fragment key={day}>
                                <tr className="border-b border-neutral-200">
                                  <td
                                    colSpan={entryHeaders.length}
                                    className="px-3 pb-1 pt-3 text-xs font-semibold text-neutral-700"
                                  >
                                    {formatPayDate(day, { weekday: "short" })}
                                    <span className="ml-2 font-normal text-neutral-500">
                                      {formatMinutes(summarize(dayRows).total)}
                                    </span>
                                  </td>
                                </tr>
                                {dayRows.map((e) =>
                                  entryRows(e, { showPerson: false, showDate: false })
                                )}
                              </Fragment>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-neutral-200 bg-neutral-50 font-medium">
              <td className="px-3 py-2 text-foreground">All</td>
              <SummaryCells s={grandTotal} empty={entries.length === 0} />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-neutral-500">
        Totals are net of deductions and only include time that counts toward pay.
        Pending management time is shown separately until approved. Days and ranges are
        Central time ({PAY_TIMEZONE}) for everyone; an entry counts on the day it was
        clocked in. Times are shown in your timezone.
      </p>

      {editing && (
        <EditTimeEntryDialog
          entry={editing}
          memberName={membersById.get(editing.user_id) ?? "Unknown"}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}

      {editingNote && (
        <AccomplishedDialog
          title="Edit what you accomplished"
          confirmLabel="Save"
          busyLabel="Saving..."
          initialText={editingNote.accomplished ?? ""}
          busy={noteSaving}
          error={noteError}
          onCancel={() => setEditingNote(null)}
          onSubmit={(text) => saveNote(editingNote, text)}
        />
      )}
    </div>
  );
}

// Type columns, deductions and total for one summary row.
function SummaryCells({ s, empty }: { s: Summary; empty: boolean }) {
  return (
    <>
      {ENTRY_TYPES.map((t) => (
        <td key={t} className="px-3 py-2 tabular-nums text-neutral-700">
          {s.byType[t] ? formatMinutes(s.byType[t]) : ""}
          {t === "management" && s.pendingManagement > 0 && (
            <span className="block text-xs text-indigo-700">
              +{formatMinutes(s.pendingManagement)} pending
            </span>
          )}
        </td>
      ))}
      <td className="px-3 py-2 tabular-nums text-neutral-700">
        {s.deductionCount > 0 ? `${s.deductionCount} (${formatMinutes(s.adjustmentMinutes)})` : ""}
      </td>
      <td className="px-3 py-2 font-medium tabular-nums text-foreground">
        {empty ? "" : formatMinutes(s.total)}
      </td>
    </>
  );
}
