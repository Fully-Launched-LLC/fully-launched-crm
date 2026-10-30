"use client";

import { useEffect, useRef, useState } from "react";
import { ACCOMPLISHED_MIN_CHARS, isValidAccomplished } from "@/lib/timeclock";

// The accomplishment note textarea, in a modal. Used for clocking out
// (ClockOutDialog) and for editing the note afterwards (Timesheets).
// Cmd/Ctrl+Enter submits, Escape cancels. Sized to fit the ~320px /clock
// window.
export default function AccomplishedDialog({
  title,
  confirmLabel,
  busyLabel,
  initialText = "",
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  title: string;
  confirmLabel: string;
  busyLabel: string;
  initialText?: string;
  busy: boolean;
  error: string | null;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initialText);
  const ref = useRef<HTMLTextAreaElement>(null);
  const valid = isValidAccomplished(text);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  function submit() {
    if (valid && !busy) onSubmit(text.trim());
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="accomplished-title"
        className="w-full max-w-sm space-y-3 rounded-lg bg-white p-4 shadow-xl"
      >
        <label id="accomplished-title" htmlFor="accomplished-text" className="block text-sm font-semibold text-foreground">
          {title}
        </label>
        <textarea
          id="accomplished-text"
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape" && !busy) onCancel();
          }}
          rows={4}
          className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <p className="text-xs text-neutral-500">
          At least {ACCOMPLISHED_MIN_CHARS} characters. Cmd/Ctrl+Enter to submit.
        </p>
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!valid || busy}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-50"
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
