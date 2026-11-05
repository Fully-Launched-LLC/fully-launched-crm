"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ExistingLead } from "@/lib/lead-finder/types";
import { noteOutcome, undoOutcome, type SavedOutcome } from "@/lib/sales/log";

// The confirmation after an outcome is saved (first click): "Not interested
// saved for X", with Add note (optional, any time while the toast is open)
// and Undo (10 seconds; deletes the touches and puts the records back).
// One toast at a time; a new save replaces it.

const UNDO_MS = 10_000;

export type OutcomeToastInput = {
  text: string;
  saved: SavedOutcome[];
  // Called with each key's state after Undo (null: the record is gone).
  onUndone: (restored: { key: string; existing: ExistingLead | null }[]) => void;
  // Called after the note is saved on the touches.
  onNote: (note: string) => void;
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
  const [now, setNow] = useState(() => Date.now());
  const seq = useRef(0);

  const show = useCallback((t: OutcomeToastInput) => {
    seq.current += 1;
    setToast({ ...t, at: Date.now(), n: seq.current });
    setNoteOpen(false);
    setNote("");
    setMsg(null);
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
  useEffect(() => {
    if (!toast || noteOpen || busy) return;
    if (now - toast.at > (plain ? 2000 : UNDO_MS + 2000)) setToast(null);
  }, [toast, noteOpen, busy, now, plain]);

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
