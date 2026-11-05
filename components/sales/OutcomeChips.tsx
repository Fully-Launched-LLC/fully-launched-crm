"use client";

import { useState } from "react";
import type { ExistingLead } from "@/lib/lead-finder/types";
import { HIDDEN_OUTCOMES, OUTCOMES, OUTCOME_CLASS, classifyTouch, shortDate, type Outcome } from "@/lib/sales/outcomes";

// One-click outcomes (rows, bulk bar, detail panel). A click opens a small
// optional-note box; Save (or Enter) logs it. onSave returns an error
// message, or null when it worked.
export function OutcomeChips({
  big,
  disabled,
  onSave,
}: {
  big?: boolean;
  disabled?: boolean;
  onSave: (o: Outcome, note: string) => Promise<string | null>;
}) {
  const [pending, setPending] = useState<Outcome | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pick(o: Outcome) {
    setPending(pending?.key === o.key ? null : o);
    setNote("");
    setError(null);
  }

  async function save() {
    if (!pending || busy) return;
    setBusy(true);
    setError(null);
    const err = await onSave(pending, note);
    setBusy(false);
    if (err) setError(err);
    else {
      setPending(null);
      setNote("");
    }
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div className={`oc-chips${big ? " big" : ""}`} role="group" aria-label="Log an outcome">
        {OUTCOMES.map((o) => (
          <button
            key={o.key}
            type="button"
            className={`oc${HIDDEN_OUTCOMES.includes(o.key) ? " neg" : ""}`}
            aria-pressed={pending?.key === o.key}
            title={o.label}
            disabled={disabled || busy}
            onClick={() => pick(o)}
          >
            {big ? o.label : o.short}
          </button>
        ))}
      </div>
      {pending && (
        <div className="oc-note">
          <label className="hint" htmlFor={`oc-note-${pending.key}`}>
            <b style={{ color: "var(--bright)" }}>{pending.label}</b>. Note <em>optional</em>
          </label>
          <input
            id={`oc-note-${pending.key}`}
            className="field"
            autoFocus
            value={note}
            placeholder="Who you talked to, what they said…"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") setPending(null);
            }}
          />
          {error && <span className="error" role="alert">{error}</span>}
          <div className="row-btns">
            <button type="button" className="btn btn-gold" disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// "Not interested · Talon · Nov 5" plus the note.
export function LatestOutcome({
  existing,
  memberName,
}: {
  existing: ExistingLead | null;
  memberName: (id: string | null) => string;
}) {
  if (!existing) return null;
  const t = existing.last_touch;
  if (existing.project_id) {
    return (
      <div className="latest">
        <span className={`st ${OUTCOME_CLASS.moved}`}>Moved to Interested</span>
        {t && <> · {memberName(t.touched_by)} · {shortDate(t.touched_at)}</>}
      </div>
    );
  }
  if (!t) return null;
  const c = classifyTouch(t);
  return (
    <div className="latest">
      <span className={`st ${OUTCOME_CLASS[c.key ?? "other"]}`}>{c.label}</span> · {memberName(t.touched_by)} · {shortDate(t.touched_at)}
      {t.summary && <div className="latest-note">“{t.summary}”</div>}
    </div>
  );
}

export const isHiddenOutcome = (ex: ExistingLead | null) => {
  if (!ex?.last_touch || ex.project_id) return false;
  const k = classifyTouch(ex.last_touch).key;
  return !!k && HIDDEN_OUTCOMES.includes(k);
};
