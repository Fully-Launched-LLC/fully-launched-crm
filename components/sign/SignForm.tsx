"use client";

import { useMemo, useState } from "react";
import { choiceGroups, money, priceText, totals } from "@/lib/deals/money";
import { CONSENT_TEXT, DEAL_BRANCH_NAMES, type DealLineItem } from "@/lib/deals/types";

export default function SignForm({
  token,
  items,
  defaults,
  hasChoices,
}: {
  token: string;
  items: DealLineItem[];
  defaults: string[];
  hasChoices: boolean;
}) {
  const groups = useMemo(() => choiceGroups(items), [items]);
  const [selected, setSelected] = useState<Set<string>>(new Set(defaults));
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [signature, setSignature] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const t = totals(items, { items: Array.from(selected) });
  const anySelected = items.some((i) => selected.has(i.id));
  const complete =
    !!name.trim() && !!title.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && !!signature.trim() && consent && anySelected;

  function pickTier(groupTierIds: string[], id: string | null) {
    setSelected((prev) => {
      const next = new Set(prev);
      groupTierIds.forEach((x) => next.delete(x));
      if (id) next.add(id);
      return next;
    });
  }
  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sign/${token}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, title, email, signature, consent, selections: Array.from(selected) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Signing failed. Please try again.");
      setDone(body.download as string);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Signing failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="card state">
        <h1>Thank you, it&apos;s signed</h1>
        <p>
          Your signed Statement of Work is ready. Fully Launched will countersign it and be in touch about next steps.
        </p>
        <a className="btn primary" href={done}>
          Download your signed copy (PDF)
        </a>
        <p className="muted" style={{ marginTop: 14 }}>
          The download link works for a few minutes. You can come back to this page any time for a fresh one.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <h2>{hasChoices ? "Package selection" : "What you're signing for"}</h2>
        <p className="muted" style={{ margin: "0 0 12px" }}>
          {hasChoices ? "Choose what to include. Only selected items are contracted." : "These items are included."}
        </p>
        {groups.map((g) => {
          const label = g.branch === "other" ? "Other" : DEAL_BRANCH_NAMES[g.branch];
          const tierIds = g.tiers.map((x) => x.id);
          const chosenTier = g.tiers.find((x) => selected.has(x.id))?.id ?? null;
          return (
            <div className="group" key={g.branch}>
              <h2 style={{ fontSize: 16 }}>{label}</h2>
              {g.required.map((i) => (
                <div className="choice on fixed" key={i.id}>
                  <input type="checkbox" checked readOnly disabled aria-label={`${i.label} (included)`} />
                  <span>
                    {i.label}
                    <span className="muted"> (included)</span>
                  </span>
                  <span className="price">{priceText(i)}</span>
                </div>
              ))}
              {g.tiers.map((i, n) => (
                <label className={`choice ${chosenTier === i.id ? "on" : ""}`} key={i.id}>
                  <input
                    type="radio"
                    name={`tier-${g.branch}`}
                    checked={chosenTier === i.id}
                    onChange={() => pickTier(tierIds, i.id)}
                  />
                  <span>
                    Tier {n + 1}: {i.tier_name}
                    {i.label && i.label !== i.tier_name ? <span className="muted"> ({i.label})</span> : null}
                  </span>
                  <span className="price">{priceText(i)}</span>
                </label>
              ))}
              {g.tiers.length > 0 && (
                <label className={`choice ${chosenTier === null ? "on" : ""}`}>
                  <input
                    type="radio"
                    name={`tier-${g.branch}`}
                    checked={chosenTier === null}
                    onChange={() => pickTier(tierIds, null)}
                  />
                  <span>Declined</span>
                </label>
              )}
              {g.optional.map((i) => (
                <label className={`choice ${selected.has(i.id) ? "on" : ""}`} key={i.id}>
                  <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                  <span>
                    {i.label}
                    <span className="muted"> (optional{selected.has(i.id) ? "" : ", declined"})</span>
                  </span>
                  <span className="price">{priceText(i)}</span>
                </label>
              ))}
            </div>
          );
        })}
        <div className="group">
          <div className="totals">
            <b>One-time total</b>
            <b className="r">{money(t.oneTime)}</b>
            {t.oneTime > 0 && (
              <>
                <span>Deposit at signature (50%)</span>
                <span className="r">{money(t.deposit)}</span>
                <span>Due at launch (50%)</span>
                <span className="r">{money(t.dueAtLaunch)}</span>
              </>
            )}
            <b>Monthly total</b>
            <b className="r">{money(t.monthly)}/month</b>
            {t.hourly.map((h) => (
              <span key={h.id} style={{ display: "contents" }}>
                <span>{h.label}</span>
                <span className="r">{priceText(h)}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Sign</h2>
        <div className="grid2" style={{ marginTop: 12 }}>
          <label className="f">
            Full name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          <label className="f">
            Title
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="organization-title" />
          </label>
          <label className="f">
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          <label className="f">
            Type your signature
            <input type="text" value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="Your full name" />
          </label>
        </div>
        <div className="sig-preview" aria-hidden>
          {signature}
        </div>
        <label className="consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>{CONSENT_TEXT}</span>
        </label>
        {!anySelected && <div className="error">Select at least one item to sign.</div>}
        {error && <div className="error">{error}</div>}
        <button type="button" className="btn primary" disabled={!complete || busy} onClick={submit}>
          {busy ? "Signing..." : "Sign the Statement of Work"}
        </button>
      </div>
    </>
  );
}
