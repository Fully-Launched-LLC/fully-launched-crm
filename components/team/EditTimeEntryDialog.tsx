"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  ACCOMPLISHED_MIN_CHARS,
  ENTRY_TYPE_LABELS,
  friendlyClockError,
  fromLocalInputValue,
  isValidAccomplished,
  toLocalInputValue,
} from "@/lib/timeclock";
import type { TimeEntryNet } from "@/lib/types";

// Admin edit of an entry's clock times and accomplishment note. Time changes
// go through admin_edit_time_entry() (migrations 014, 015), which requires a
// reason and logs each changed time to time_entry_edits; a note-only change
// is a plain update (no reason). The database rejects non-Admins, and a
// closed entry must have a note (closing a forgotten entry included).
export default function EditTimeEntryDialog({
  entry,
  memberName,
  onClose,
  onSaved,
}: {
  entry: TimeEntryNet;
  memberName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const initialIn = toLocalInputValue(entry.clock_in);
  const initialOut = toLocalInputValue(entry.clock_out);
  const [clockIn, setClockIn] = useState(initialIn);
  const [clockOut, setClockOut] = useState(initialOut);
  const [reason, setReason] = useState("");
  const [accomplished, setAccomplished] = useState(entry.accomplished ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The inputs only have minute precision; an untouched field keeps its
  // exact stored value so it isn't logged as an edit.
  const nextIn = clockIn === initialIn ? entry.clock_in : fromLocalInputValue(clockIn);
  const nextOut = clockOut === initialOut ? entry.clock_out : fromLocalInputValue(clockOut);
  const timesChanged = nextIn !== entry.clock_in || nextOut !== entry.clock_out;
  const nextAccomplished = accomplished.trim();
  const noteChanged = nextAccomplished !== (entry.accomplished ?? "");
  const changed = timesChanged || noteChanged;

  async function save() {
    if (!nextIn) return setError("Clock in is required.");
    if (nextOut && new Date(nextOut) < new Date(nextIn)) {
      return setError("Clock out can't be before clock in.");
    }
    if (nextOut && !isValidAccomplished(nextAccomplished)) {
      return setError(
        `A closed entry needs what was accomplished (at least ${ACCOMPLISHED_MIN_CHARS} characters).`
      );
    }
    if (timesChanged && !reason.trim()) return setError("A reason is required to change times.");
    setSaving(true);
    let error: { code?: string; message: string } | null = null;
    if (timesChanged) {
      ({ error } = await supabase.rpc("admin_edit_time_entry", {
        p_entry_id: entry.id,
        p_clock_in: nextIn,
        p_clock_out: nextOut,
        p_reason: reason.trim(),
        p_accomplished: nextAccomplished || null,
      }));
    } else {
      const res = await supabase
        .from("time_entries")
        .update({ accomplished: nextAccomplished || null })
        .eq("id", entry.id)
        .select("id");
      error = res.error ?? (res.data?.length ? null : { message: "Only Admins can edit this entry." });
    }
    setSaving(false);
    if (error) {
      setError(
        error.code === "23505"
          ? "This person already has another open entry, so this one can't be reopened."
          : friendlyClockError(error)
      );
      return;
    }
    onSaved();
  }

  const inputClass =
    "mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm space-y-3 rounded-lg bg-white p-5 shadow-xl">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Edit time entry</h2>
          <p className="text-xs text-neutral-500">
            {memberName} · {ENTRY_TYPE_LABELS[entry.entry_type]}
          </p>
        </div>
        <label className="block text-xs font-medium text-neutral-600">
          Clock in
          <input
            type="datetime-local"
            value={clockIn}
            onChange={(e) => setClockIn(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block text-xs font-medium text-neutral-600">
          Clock out {entry.clock_out === null && "(leave blank to keep it open)"}
          <input
            type="datetime-local"
            value={clockOut}
            onChange={(e) => setClockOut(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block text-xs font-medium text-neutral-600">
          What was accomplished {clockOut ? "(required)" : "(required once closed)"}
          <textarea
            value={accomplished}
            onChange={(e) => setAccomplished(e.target.value)}
            rows={3}
            className={inputClass}
          />
        </label>
        <label className="block text-xs font-medium text-neutral-600">
          Reason for time changes (required if you change a time, shown to the team)
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className={inputClass}
          />
        </label>
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !changed}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
