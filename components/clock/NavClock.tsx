"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import Popover from "@/components/table/Popover";
import ClockInForm from "@/components/clock/ClockInForm";
import type { TimeClock } from "@/components/clock/useTimeClock";
import {
  DISTRACTED_MINUTES,
  ENTRY_TYPE_LABELS,
  formatMinutes,
  formatTimer,
  isForgotten,
} from "@/lib/timeclock";
import type { TimeEntryType } from "@/lib/types";

// Compact clock in the top nav (dark header). The trigger shows the live
// timer (or "Clock in") and opens a panel with every control; on sm and up
// the distracted and clock out buttons are also inline. TopNav renders one
// per breakpoint, sharing a single useTimeClock() state; it also renders the
// Undo toast and the clock-out dialog once.
export default function NavClock({ clock }: { clock: TimeClock }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  if (!clock.loaded) return null;

  const entry = clock.openEntry;
  const forgotten = entry ? isForgotten(entry, clock.now) : false;
  const distractedLabel = `I got distracted (-${DISTRACTED_MINUTES})`;

  async function clockIn(type: TimeEntryType, projectId: string | null) {
    await clock.clockIn(type, projectId);
    setOpen(false);
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={forgotten ? "Forgot to clock out?" : undefined}
        className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm font-medium ${
          forgotten
            ? "border-red-400 bg-red-50 text-red-700"
            : "border-white/30 text-header-foreground hover:bg-white/10"
        }`}
      >
        {entry ? (
          <>
            <span
              aria-hidden
              className={`h-2 w-2 rounded-full ${forgotten ? "bg-red-600" : "bg-green-400"}`}
            />
            <span className="font-mono tabular-nums">{formatTimer(clock.netSeconds)}</span>
          </>
        ) : (
          "Clock in"
        )}
      </button>

      {entry && (
        <>
          <button
            type="button"
            onClick={clock.gotDistracted}
            disabled={clock.busy || !clock.canDeduct}
            title={distractedLabel}
            aria-label={distractedLabel}
            className="hidden rounded-md border border-white/30 px-2 py-1 text-sm font-medium text-header-foreground hover:bg-white/10 disabled:opacity-40 sm:inline-flex"
          >
            -{DISTRACTED_MINUTES}
            {clock.deductionsToday > 0 && (
              <span className="ml-1 rounded bg-white/20 px-1 text-xs">
                {clock.deductionsToday}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={clock.requestClockOut}
            disabled={clock.busy}
            className="hidden rounded-md bg-header-foreground px-2 py-1 text-sm font-medium text-header hover:opacity-90 disabled:opacity-60 sm:inline-flex"
          >
            Clock out
          </button>
        </>
      )}

      <Popover anchorRef={anchorRef} open={open} onClose={close} className="w-72 p-3">
        {entry ? (
          <div className="space-y-3 text-sm">
            <div>
              <p className="font-mono text-2xl tabular-nums text-foreground">
                {formatTimer(clock.netSeconds)}
              </p>
              <p className="text-neutral-600">
                {ENTRY_TYPE_LABELS[entry.entry_type]}
                {clock.openProject && ` · ${clock.openProject.client_name}`}
              </p>
              {forgotten && (
                <p className="mt-1 rounded bg-red-50 px-2 py-1 text-red-700">
                  Forgot to clock out? Clock out and ask an Admin to fix the time.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={clock.gotDistracted}
              disabled={clock.busy || !clock.canDeduct}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
            >
              {distractedLabel}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                clock.requestClockOut();
              }}
              disabled={clock.busy}
              className="w-full rounded-md bg-accent px-3 py-2 font-medium text-accent-foreground disabled:opacity-60"
            >
              Clock out
            </button>
            <p className="text-xs text-neutral-500">
              Deductions today: {clock.deductionsToday} · Today:{" "}
              {formatMinutes(Math.floor(clock.todaySeconds / 60))}
            </p>
          </div>
        ) : (
          <ClockInForm busy={clock.busy} onClockIn={clockIn} />
        )}
        {clock.error && (
          <p className="mt-2 text-sm text-red-600" role="alert">
            {clock.error}
          </p>
        )}
        <Link
          href="/clock"
          onClick={close}
          className="mt-3 block text-xs text-neutral-500 hover:text-foreground"
        >
          Open the clock window
        </Link>
      </Popover>

      {/* Errors from the inline buttons, when the panel is closed. */}
      {clock.error && !open && (
        <button
          type="button"
          onClick={clock.clearError}
          className="hidden max-w-48 truncate text-xs text-red-300 sm:block"
          title={clock.error}
        >
          {clock.error}
        </button>
      )}
    </div>
  );
}
