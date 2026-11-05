"use client";

import { useState } from "react";
import { buildEmail, defaultEmailKind, EMAIL_KINDS, gmailComposeUrl, type EmailContext, type EmailKind } from "@/lib/sales/emailTemplates";
import { useOutcomeToast } from "@/components/sales/OutcomeToast";

// Draft email modal (side preview): To, Subject, Body from a branch
// template (lib/sales/emailTemplates.ts), editable. "Open in Gmail" opens a
// Gmail compose window in a new tab; "Copy" copies subject and body; "Mark
// as sent" logs Emailed (subject as the note, the address in details) and
// the toast then offers a follow-up.

export default function DraftEmail({
  ctx,
  to: initialTo,
  onClose,
  onMarkSent,
}: {
  ctx: EmailContext;
  to: string | null;
  onClose: () => void;
  onMarkSent: (subject: string, to: string) => Promise<string | null>;
}) {
  const toast = useOutcomeToast();
  const [kind, setKind] = useState<EmailKind>(() => defaultEmailKind(ctx.place));
  const initial = buildEmail(kind, ctx);
  const [to, setTo] = useState(initialTo ?? "");
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pick(k: EmailKind) {
    setKind(k);
    const e = buildEmail(k, ctx);
    setSubject(e.subject);
    setBody(e.body);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      toast.flash("Copied");
    } catch {
      toast.flash("Couldn't copy. Select the text and copy it instead.");
    }
  }

  async function markSent() {
    setBusy(true);
    setError(null);
    const err = await onMarkSent(subject.trim(), to.trim());
    setBusy(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <div className="draft-overlay" role="dialog" aria-modal="true" aria-label="Draft email" onClick={onClose}>
      <div className="panel draft" onClick={(e) => e.stopPropagation()}>
        <div className="draft-head">
          <div>
            <div className="kicker">Draft email</div>
            <h3>{ctx.place.name}</h3>
          </div>
          <button type="button" className="btn oc-toast-x" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="chips" role="group" aria-label="Template">
          {EMAIL_KINDS.map(([k, label]) => (
            <button key={k} type="button" className="chip" aria-pressed={kind === k} onClick={() => pick(k)}>
              {label}
            </button>
          ))}
        </div>
        <label className="f">
          <span className="lt">To</span>
          <input className="field" type="email" value={to} placeholder="No email found. Add one." onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="f">
          <span className="lt">Subject</span>
          <input className="field" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="f">
          <span className="lt">Body</span>
          <textarea className="field draft-body" value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="draft-btns">
          <a className="btn btn-gold" href={gmailComposeUrl(to.trim(), subject, body)} target="_blank" rel="noopener noreferrer">
            Open in Gmail
          </a>
          <button type="button" className="btn" onClick={() => void copy()}>Copy</button>
          <button type="button" className="btn" disabled={busy || !subject.trim()} onClick={() => void markSent()}>
            {busy ? "Saving…" : "Mark as sent"}
          </button>
        </div>
      </div>
    </div>
  );
}
