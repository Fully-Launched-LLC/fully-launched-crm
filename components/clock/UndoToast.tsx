"use client";

import { DISTRACTED_MINUTES } from "@/lib/timeclock";
import type { TimeClock } from "@/components/clock/useTimeClock";

// Shown for UNDO_TOAST_MS after "I got distracted".
export default function UndoToast({ clock }: { clock: TimeClock }) {
  if (!clock.undo) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
    >
      <div className="flex items-center gap-3 rounded-md bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg">
        <span>Deducted {DISTRACTED_MINUTES} minutes.</span>
        <button
          type="button"
          onClick={clock.undoDeduction}
          className="font-semibold text-tan hover:underline"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={clock.dismissUndo}
          aria-label="Dismiss"
          className="text-white/60 hover:text-white"
        >
          ×
        </button>
      </div>
    </div>
  );
}
