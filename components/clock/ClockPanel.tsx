"use client";

import Link from "next/link";
import ClockInForm from "@/components/clock/ClockInForm";
import UndoToast from "@/components/clock/UndoToast";
import ClockOutDialog from "@/components/clock/ClockOutDialog";
import { useTimeClock } from "@/components/clock/useTimeClock";
import {
  DISTRACTED_MINUTES,
  ENTRY_TYPE_LABELS,
  formatMinutes,
  formatTimer,
  isForgotten,
} from "@/lib/timeclock";

// The /clock window (installed as the "FL Clock" app). Laid out to fit about
// 320x420.
export default function ClockPanel({
  memberId,
  memberName,
}: {
  memberId: string;
  memberName: string;
}) {
  const clock = useTimeClock(memberId);
  const entry = clock.openEntry;
  const forgotten = entry ? isForgotten(entry, clock.now) : false;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-sm flex-col px-4 py-3">
      <header className="flex items-center justify-between border-b-2 border-tan pb-2">
        <span className="text-sm font-semibold text-accent">FL Clock</span>
        <span className="flex items-center gap-3 text-xs text-neutral-500">
          <span className="truncate">{memberName}</span>
          <Link href="/dashboard" className="hover:text-foreground">
            CRM
          </Link>
        </span>
      </header>

      <main className="flex-1 py-3">
        {!clock.loaded ? (
          <p className="text-sm text-neutral-500">Loading...</p>
        ) : entry ? (
          <div className="space-y-3">
            <div className="text-center">
              <p
                className={`font-mono text-4xl tabular-nums ${
                  forgotten ? "text-red-700" : "text-foreground"
                }`}
              >
                {formatTimer(clock.netSeconds)}
              </p>
              <p className="mt-1 truncate text-sm text-neutral-600">
                {ENTRY_TYPE_LABELS[entry.entry_type]}
                {clock.openProject && ` · ${clock.openProject.client_name}`}
              </p>
            </div>
            {forgotten && (
              <p className="rounded-md bg-red-50 px-2 py-1.5 text-sm text-red-700">
                Forgot to clock out? Clock out and ask an Admin to fix the time.
              </p>
            )}
            <button
              type="button"
              onClick={clock.gotDistracted}
              disabled={clock.busy || !clock.canDeduct}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
            >
              I got distracted (-{DISTRACTED_MINUTES})
            </button>
            <button
              type="button"
              onClick={clock.requestClockOut}
              disabled={clock.busy}
              className="w-full rounded-md bg-accent px-3 py-2.5 text-sm font-medium text-accent-foreground disabled:opacity-60"
            >
              {clock.busy ? "Working..." : "Clock out"}
            </button>
          </div>
        ) : (
          <ClockInForm busy={clock.busy} onClockIn={clock.clockIn} />
        )}

        {clock.error && (
          <p className="mt-3 text-sm text-red-600" role="alert">
            {clock.error}
          </p>
        )}
      </main>

      <footer className="flex justify-between border-t border-neutral-200 pt-2 text-xs text-neutral-500">
        <span>Today: {formatMinutes(Math.floor(clock.todaySeconds / 60))}</span>
        <span>
          {clock.deductionsToday} deduction{clock.deductionsToday === 1 ? "" : "s"} today
        </span>
      </footer>

      <UndoToast clock={clock} />
      <ClockOutDialog clock={clock} />
    </div>
  );
}
