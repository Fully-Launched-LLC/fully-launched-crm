"use client";

import { useState } from "react";
import type { ExistingLead } from "@/lib/lead-finder/types";
import {
  STOP_OUTCOMES,
  OUTCOMES,
  OUTCOME_GROUPS,
  OUTCOME_CLASS,
  classifyTouch,
  describeTouch,
  shortDate,
  type DisplayKey,
  type LatestTouch,
  type Outcome,
  type OutcomeKey,
} from "@/lib/sales/outcomes";

// One-click outcomes in three groups (Call result, Email, LinkedIn), in the
// side preview and the bulk bar. The first click saves;
// the caller shows the confirmation toast (Add note, Undo). onSave returns
// an error message, or null when it worked.
export function OutcomeChips({
  big,
  disabled,
  bulk,
  confirm,
  current,
  onSave,
}: {
  big?: boolean;
  disabled?: boolean;
  // Bulk bar: outcomes that need a per-business form (Not available) are left out.
  bulk?: boolean;
  // Set for Not interested businesses and clients: the first click asks
  // ("This business said not interested on Nov 5. Log anyway?").
  confirm?: string | null;
  // The business's latest logged outcome: its button stays outlined.
  current?: DisplayKey | null;
  onSave: (o: Outcome) => Promise<string | null>;
}) {
  const [saving, setSaving] = useState<OutcomeKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<Outcome | null>(null);

  async function save(o: Outcome, confirmed = false) {
    if (saving) return;
    if (confirm && !confirmed) {
      setAsking(o);
      return;
    }
    setAsking(null);
    setSaving(o.key);
    setError(null);
    const err = await onSave(o);
    setSaving(null);
    if (err) setError(err);
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      {OUTCOME_GROUPS.map(([group, heading]) => (
        <div key={group} className="oc-group">
          <span className="oc-heading">{heading}</span>
          <div className={`oc-chips${big ? " big" : ""}`} role="group" aria-label={heading}>
            {OUTCOMES.filter((o) => o.group === group && !(bulk && o.needsForm)).map((o) => (
              <button
                key={o.key}
                type="button"
                className={`oc${STOP_OUTCOMES.includes(o.key) ? " neg" : ""}${current === o.key ? " current" : ""}`}
                aria-pressed={saving === o.key}
                title={o.label}
                disabled={disabled || !!saving}
                onClick={() => void save(o)}
              >
                {saving === o.key ? "Saving…" : o.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      {asking && confirm && (
        <div className="oc-confirm" role="alertdialog" aria-label="Confirm">
          <span>{confirm}</span>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" className="btn btn-gold" onClick={() => void save(asking, true)}>
              Log {asking.label} anyway
            </button>
            <button type="button" className="btn" onClick={() => setAsking(null)}>Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="bad-text" role="alert" style={{ marginTop: 6, fontSize: 12.5 }}>{error}</p>}
    </div>
  );
}

// One touch as a plain sentence: "Called Nov 5 · Not available · spoke with
// Crystal (front desk) · Luke" (describeTouch, lib/sales/outcomes.ts).
export function TouchLine({ t, memberName }: { t: LatestTouch; memberName: (id: string | null) => string }) {
  const d = describeTouch(t, memberName);
  return (
    <span className="touch-line">
      {d.lead}
      {d.outcome && (
        <>
          {" · "}
          <span className={`st ${OUTCOME_CLASS[d.key]}`}>{d.outcome}</span>
        </>
      )}
      {d.detail && <> · {d.detail}</>} · {d.who}
    </span>
  );
}

// The latest touch (or Moved to Interested) plus its note, for result rows,
// the side preview and History's Latest outcome column.
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
        <span className="touch-line">
          <span className={`st ${OUTCOME_CLASS.moved}`}>Moved to Interested</span>
          {t && <> · {shortDate(t.touched_at)} · {memberName(t.touched_by)}</>}
        </span>
      </div>
    );
  }
  if (!t) return null;
  return (
    <div className="latest">
      <TouchLine t={t} memberName={memberName} />
      {t.summary && <div className="latest-note">“{t.summary}”</div>}
    </div>
  );
}

// How far along a business is, for dimming results and the default sort:
// none (never contacted), contacted, stopped (said not interested / bad fit,
// or already a client: moved to Interested).
export type ContactState = "none" | "contacted" | "stopped";

export function contactState(ex: ExistingLead | null): ContactState {
  if (!ex) return "none";
  if (ex.project_id) return "stopped";
  if (!ex.last_touch) return "none";
  return STOP_OUTCOMES.includes(classifyTouch(ex.last_touch).key) ? "stopped" : "contacted";
}

// The confirm question before logging on a stopped business, else null.
export function stopNotice(ex: ExistingLead | null): string | null {
  if (!ex) return null;
  if (ex.project_id) return "This business is already a client (moved to Interested). Log anyway?";
  const t = ex.last_touch;
  if (!t) return null;
  const k = classifyTouch(t).key;
  if (k === "not_interested") return `This business said not interested on ${shortDate(t.touched_at)}. Log anyway?`;
  if (k === "bad_fit") return `This business was marked a bad fit on ${shortDate(t.touched_at)}. Log anyway?`;
  return null;
}
