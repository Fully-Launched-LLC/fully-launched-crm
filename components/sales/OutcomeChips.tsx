"use client";

import { useState } from "react";
import type { ExistingLead } from "@/lib/lead-finder/types";
import { HIDDEN_OUTCOMES, OUTCOMES, OUTCOME_CLASS, classifyTouch, shortDate, type Outcome, type OutcomeKey } from "@/lib/sales/outcomes";

// One-click outcomes (detail panel, bulk bar). The first click saves;
// the caller shows the confirmation toast (Add note, Undo). onSave returns
// an error message, or null when it worked.
export function OutcomeChips({
  big,
  disabled,
  onSave,
}: {
  big?: boolean;
  disabled?: boolean;
  onSave: (o: Outcome) => Promise<string | null>;
}) {
  const [saving, setSaving] = useState<OutcomeKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(o: Outcome) {
    if (saving) return;
    setSaving(o.key);
    setError(null);
    const err = await onSave(o);
    setSaving(null);
    if (err) setError(err);
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div className={`oc-chips${big ? " big" : ""}`} role="group" aria-label="Log an outcome">
        {OUTCOMES.map((o) => (
          <button
            key={o.key}
            type="button"
            className={`oc${HIDDEN_OUTCOMES.includes(o.key) ? " neg" : ""}`}
            aria-pressed={saving === o.key}
            title={o.label}
            disabled={disabled || !!saving}
            onClick={() => void save(o)}
          >
            {saving === o.key ? "Saving…" : o.label}
          </button>
        ))}
      </div>
      {error && <p className="bad-text" role="alert" style={{ marginTop: 6, fontSize: 12.5 }}>{error}</p>}
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
      <span className={`st ${OUTCOME_CLASS[c.key]}`}>{c.label}</span> · {memberName(t.touched_by)} · {shortDate(t.touched_at)}
      {t.summary && <div className="latest-note">“{t.summary}”</div>}
    </div>
  );
}

export const isHiddenOutcome = (ex: ExistingLead | null) => {
  if (!ex?.last_touch || ex.project_id) return false;
  const k = classifyTouch(ex.last_touch).key;
  return !!k && HIDDEN_OUTCOMES.includes(k);
};
