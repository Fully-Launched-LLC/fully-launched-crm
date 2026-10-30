"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  DISTRACTED_MINUTES,
  UNDO_TOAST_MS,
  friendlyClockError,
  liveNetSeconds,
  startOfPayDay,
} from "@/lib/timeclock";
import type { TimeEntryNet, TimeEntryType } from "@/lib/types";

export type ClockProject = { id: string; client_name: string };

type Undo = { adjustmentId: string; expiresAt: number };

// Shared state and actions for the nav clock and /clock. The database is the
// source of truth for every rule (one open entry, no clock time edits, net
// can't go below 0, 60s undo); this hook just mirrors it and reports errors.
// memberId null (login not on the roster) -> stays unloaded and does nothing.
export function useTimeClock(memberId: string | null) {
  const supabase = useMemo(() => createClient(), []);
  const [openEntry, setOpenEntry] = useState<TimeEntryNet | null>(null);
  const [openProject, setOpenProject] = useState<ClockProject | null>(null);
  const [deductionsToday, setDeductionsToday] = useState(0);
  // Net minutes of today's closed entries; the open entry is added live.
  const [closedTodayMinutes, setClosedTodayMinutes] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  // The "What did you accomplish?" dialog. One per clock state, so the nav's
  // desktop and mobile controls share it.
  const [clockOutOpen, setClockOutOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (!memberId) return;
    // "Today" is the pay day (America/Chicago), same as Timesheets.
    const today = startOfPayDay().toISOString();
    const [open, deductions, todays] = await Promise.all([
      supabase
        .from("time_entries_net")
        .select("*")
        .eq("user_id", memberId)
        .is("clock_out", null)
        .maybeSingle(),
      supabase
        .from("time_adjustments")
        .select("id", { count: "exact", head: true })
        .eq("created_by", memberId)
        .lt("minutes", 0)
        .gte("created_at", today),
      supabase
        .from("time_entries_net")
        .select("net_minutes")
        .eq("user_id", memberId)
        .not("clock_out", "is", null)
        .gte("clock_in", today),
    ]);

    const firstError = open.error ?? deductions.error ?? todays.error;
    if (firstError) {
      setError(firstError.message);
      return;
    }

    const entry = (open.data as TimeEntryNet | null) ?? null;
    setOpenEntry(entry);
    setDeductionsToday(deductions.count ?? 0);
    setClosedTodayMinutes(
      (todays.data ?? []).reduce((sum, r) => sum + (r.net_minutes as number), 0)
    );

    if (entry?.project_id) {
      const { data } = await supabase
        .from("projects")
        .select("id, client_name")
        .eq("id", entry.project_id)
        .maybeSingle();
      setOpenProject((data as ClockProject | null) ?? null);
    } else {
      setOpenProject(null);
    }
    setLoaded(true);
  }, [supabase, memberId]);

  // Initial load, then keep in step with other windows (e.g. the installed
  // /clock app) on focus and once a minute.
  useEffect(() => {
    if (!memberId) return;
    refresh();
    const onFocus = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const interval = setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      clearInterval(interval);
    };
  }, [refresh, memberId]);

  // Ticks the live timer while clocked in.
  useEffect(() => {
    if (!openEntry) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [openEntry]);

  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

  const netSeconds = openEntry ? liveNetSeconds(openEntry, now) : 0;
  const todaySeconds = closedTodayMinutes * 60 + netSeconds;
  // Client-side mirror of the server's below-zero check, to disable the button.
  const canDeduct = !!openEntry && netSeconds >= DISTRACTED_MINUTES * 60;

  // Returns true when the action succeeded.
  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    const message = await action();
    if (message) setError(message);
    await refresh();
    setBusy(false);
    return !message;
  }

  function clockIn(entryType: TimeEntryType, projectId: string | null) {
    if (!memberId) return Promise.resolve(false);
    return run(async () => {
      // clock_in is set by the database (server time), not sent from here.
      const { error } = await supabase.from("time_entries").insert({
        user_id: memberId,
        entry_type: entryType,
        project_id: projectId,
      });
      return error ? friendlyClockError(error) : null;
    });
  }

  // Clocking out requires the accomplishment note (enforced by the
  // database too). Resolves true on success, so the dialog can close.
  function clockOut(accomplished: string) {
    if (!openEntry) return Promise.resolve(false);
    const id = openEntry.id;
    return run(async () => {
      // The database stamps clock_out with its own now().
      const { data, error } = await supabase
        .from("time_entries")
        .update({ clock_out: new Date().toISOString(), accomplished: accomplished.trim() })
        .eq("id", id)
        .is("clock_out", null)
        .select("id");
      if (error) return friendlyClockError(error);
      if (!data?.length) return "That entry was already closed.";
      return null;
    });
  }

  function gotDistracted() {
    if (!openEntry) return Promise.resolve(false);
    const entryId = openEntry.id;
    return run(async () => {
      const { data, error } = await supabase
        .from("time_adjustments")
        .insert({
          time_entry_id: entryId,
          minutes: -DISTRACTED_MINUTES,
          created_by: memberId,
        })
        .select("id")
        .single();
      if (error || !data) return error ? friendlyClockError(error) : "Could not deduct time.";
      if (undoTimer.current) clearTimeout(undoTimer.current);
      setUndo({ adjustmentId: data.id, expiresAt: Date.now() + UNDO_TOAST_MS });
      undoTimer.current = setTimeout(() => setUndo(null), UNDO_TOAST_MS);
      return null;
    });
  }

  function undoDeduction() {
    if (!undo) return Promise.resolve(false);
    const id = undo.adjustmentId;
    setUndo(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    return run(async () => {
      // RLS only allows the creator to delete within 60 seconds; a blocked
      // delete returns zero rows, not an error.
      const { data, error } = await supabase
        .from("time_adjustments")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) return error.message;
      if (!data?.length) return "Too late to undo that deduction.";
      return null;
    });
  }

  function dismissUndo() {
    setUndo(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }

  return {
    loaded,
    busy,
    error,
    clearError: () => setError(null),
    openEntry,
    openProject,
    netSeconds,
    todaySeconds,
    deductionsToday,
    canDeduct,
    undo,
    now,
    clockIn,
    clockOut,
    clockOutOpen,
    requestClockOut: () => {
      setError(null);
      setClockOutOpen(true);
    },
    closeClockOut: () => setClockOutOpen(false),
    gotDistracted,
    undoDeduction,
    dismissUndo,
  };
}

export type TimeClock = ReturnType<typeof useTimeClock>;
