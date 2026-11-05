"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ExistingLead } from "@/lib/lead-finder/types";
import { noteOutcome, undoOutcome, zeroRowsReason, type SavedOutcome } from "@/lib/sales/log";

// The confirmation after an outcome is saved (first click): "Not interested
// saved for X", with Add note (optional, any time while the toast is open)
// and Undo (10 seconds; deletes the touches and puts the records back).
// After No answer, Not available or Emailed it also offers a follow-up
// (Tomorrow / In 3 days / Next week / Pick date): sets next_action
// "Follow up: call" / "Follow up: email" and next_action_at (9:00 local on
// that day). That's a leads update, so the 017 RLS rule applies (assigned
// member, unassigned, or Admin/Manager).
// One toast at a time; a new save replaces it.

const UNDO_MS = 10_000;
const FOLLOW_UP_MS = 20_000; // a toast offering a follow-up stays this long

// 9:00 in the viewer's timezone, `days` from today (or on a YYYY-MM-DD).
function followUpAt(days: number | string): Date {
  const d = typeof days === "string" ? new Date(days + "T09:00:00") : new Date();
  if (typeof days === "number") {
    d.setDate(d.getDate() + days);
    d.setHours(9, 0, 0, 0);
  }
  return d;
}

export type OutcomeToastInput = {
  text: string;
  saved: SavedOutcome[];
  // Called with each key's state after Undo (null: the record is gone).
  onUndone: (restored: { key: string; existing: ExistingLead | null }[]) => void;
  // Called after the note is saved on the touches.
  onNote: (note: string) => void;
  // Offer a follow-up; onSet gets the records it was set on.
  followUp?: { kind: "call" | "email"; onSet: (leadIds: string[], nextAction: string, at: string) => void };
};

// flash: a plain message for 2 seconds (e.g. "Copied").
type Ctx = { show: (t: OutcomeToastInput) => void; flash: (text: string) => void };
const ToastContext = createContext<Ctx>({ show: () => {}, flash: () => {} });
export const useOutcomeToast = () => useContext(ToastContext);

export function OutcomeToastProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [toast, setToast] = useState<(OutcomeToastInput & { at: number; n: number }) | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [followDone, setFollowDone] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const seq = useRef(0);

  const show = useCallback((t: OutcomeToastInput) => {
    seq.current += 1;
    setToast({ ...t, at: Date.now(), n: seq.current });
    setNoteOpen(false);
    setNote("");
    setMsg(null);
    setPicking(false);
    setFollowDone(false);
    setNow(Date.now());
  }, []);

  const flash = useCallback(
    (text: string) =>
      show({ text, saved: [], onUndone: () => {}, onNote: () => {} }),
    [show]
  );
  // Tick for the Undo window; close on its own unless a note is being written.
  useEffect(() => {
    if (!toast) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [toast]);
  const plain = !!toast && toast.saved.length === 0;
  const canUndo = !!toast && !plain && now - toast.at < UNDO_MS;
  const offerFollow = !!toast?.followUp && !followDone;
  useEffect(() => {
    if (!toast || noteOpen || busy || picking) return;
    const life = plain ? 2000 : offerFollow ? FOLLOW_UP_MS : UNDO_MS + 2000;
    if (now - toast.at > life) setToast(null);
  }, [toast, noteOpen, busy, picking, now, plain, offerFollow]);

  async function setFollowUp(when: number | string) {
    if (!toast?.followUp || busy) return;
    const at = followUpAt(when);
    if (Number.isNaN(at.getTime())) return;
    const ids = Array.from(new Set(toast.saved.map((s) => s.existing.id)));
    const nextAction = toast.followUp.kind === "email" ? "Follow up: email" : "Follow up: call";
    setBusy(true);
    const { data, error } = await supabase
      .from("leads")
      .update({ next_action: nextAction, next_action_at: at.toISOString() })
      .in("id", ids)
      .select("id");
    setBusy(false);
    setPicking(false);
    if (error) return setMsg({ tone: "error", text: error.message });
    const done = ((data ?? []) as { id: string }[]).map((r) => r.id);
    if (done.length) toast.followUp.onSet(done, nextAction, at.toISOString());
    const day = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(at);
    if (done.length === ids.length) {
      setMsg({ tone: "ok", text: `Follow-up set for ${day}.` });
      setFollowDone(true);
      setToast((t) => (t ? { ...t, at: Math.min(t.at, Date.now() - UNDO_MS) } : t)); // closes in 2s
    } else if (ids.length === 1) {
      setMsg({ tone: "error", text: (await zeroRowsReason(supabase, ids[0])).replace("Not saved", "Follow-up not set") });
    } else {
      setMsg({ tone: "error", text: `Follow-up set on ${done.length} of ${ids.length}. The rest are assigned to someone else.` });
      setFollowDone(true);
    }
  }

  async function undo() {
    if (!toast || busy) return;
    setBusy(true);
    const { restored, error } = await undoOutcome(supabase, toast.saved);
    setBusy(false);
    if (error) return setMsg({ tone: "error", text: error });
    toast.onUndone(restored);
    setToast(null);
  }

  async function saveNote() {
    if (!toast || busy || !note.trim()) return;
    setBusy(true);
    const err = await noteOutcome(supabase, toast.saved, note);
    setBusy(false);
    if (err) return setMsg({ tone: "error", text: err });
    toast.onNote(note.trim());
    setNoteOpen(false);
    setMsg({ tone: "ok", text: "Note saved." });
    setToast((t) => (t ? { ...t, at: Date.now() - UNDO_MS } : t)); // closes in 2s, no Undo after a note
  }

  const left = toast ? Math.max(0, Math.ceil((UNDO_MS - (now - toast.at)) / 1000)) : 0;

  return (
    <ToastContext.Provider value={{ show, flash }}>
      {children}
      {toast && (
        <div className="oc-toast" role="status" aria-live="polite" key={toast.n}>
          <div className="oc-toast-row">
            <span className="oc-toast-text">{toast.text}</span>
            <div className="oc-toast-btns">
              {!noteOpen && !plain && (
                <button type="button" className="btn" disabled={busy} onClick={() => setNoteOpen(true)}>
                  Add note
                </button>
              )}
              {canUndo && (
                <button type="button" className="btn" disabled={busy} onClick={() => void undo()}>
                  Undo ({left})
                </button>
              )}
              <button type="button" className="btn oc-toast-x" aria-label="Close" onClick={() => setToast(null)}>
                ×
              </button>
            </div>
          </div>
          {offerFollow && (
            <div className="oc-follow">
              <span className="hint">Follow up ({toast.followUp!.kind}):</span>
              <button type="button" className="btn" disabled={busy} onClick={() => void setFollowUp(1)}>Tomorrow</button>
              <button type="button" className="btn" disabled={busy} onClick={() => void setFollowUp(3)}>In 3 days</button>
              <button type="button" className="btn" disabled={busy} onClick={() => void setFollowUp(7)}>Next week</button>
              {picking ? (
                <input
                  className="field"
                  type="date"
                  autoFocus
                  aria-label="Follow-up date"
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => e.target.value && void setFollowUp(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setPicking(false)}
                />
              ) : (
                <button type="button" className="btn" disabled={busy} onClick={() => setPicking(true)}>Pick date</button>
              )}
            </div>
          )}
          {noteOpen && (
            <div className="oc-toast-note">
              <input
                className="field"
                autoFocus
                aria-label="Note"
                placeholder="Who you talked to, what they said…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveNote();
                  if (e.key === "Escape") setNoteOpen(false);
                }}
              />
              <button type="button" className="btn btn-gold" disabled={busy || !note.trim()} onClick={() => void saveNote()}>
                Save note
              </button>
            </div>
          )}
          {msg && <p className={msg.tone === "ok" ? "hint" : "bad-text"} style={{ marginTop: 6 }}>{msg.text}</p>}
        </div>
      )}
    </ToastContext.Provider>
  );
}
