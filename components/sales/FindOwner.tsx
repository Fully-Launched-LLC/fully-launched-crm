"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/lead-finder/apiFetch";
import type { ExistingLead, ScannedPlace } from "@/lib/lead-finder/types";
import type { TeamMember } from "@/lib/types";
import { saveBusinessContact } from "@/lib/sales/log";

// "Find owner contact" (Apollo.io, on demand only; side preview + dossier).
// Looks up people at the business's website domain with owner-type titles
// (POST /api/sales/apollo, logged in enrichment_lookups). Emails Apollo
// hasn't unlocked can be revealed one at a time (one Apollo credit each).
// "Use as business owner" saves name, title, the owner's direct email and
// phone (owner_email / owner_phone, migration 031) and LinkedIn through
// update_business_contact (any team member; creates the record).

type Person = { id: string; name: string; title: string | null; email: string | null; phone: string | null; linkedin: string | null };

export default function FindOwner({
  place,
  existing,
  searchType,
  me,
  sourceDetail,
  onSaved,
}: {
  place: ScannedPlace;
  existing: ExistingLead | null;
  searchType: string | null;
  me: TeamMember | null;
  sourceDetail: string;
  onSaved: (ex: ExistingLead) => void;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [domain, setDomain] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const base = { placeId: place.id, leadId: existing?.id ?? null, businessName: place.name };

  async function post(body: Record<string, unknown>) {
    const res = await apiFetch("/api/sales/apollo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...base, ...body }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Apollo lookup failed.");
    return json;
  }

  async function search() {
    setBusy("search");
    setMsg(null);
    try {
      const json = await post({ action: "search", website: place.website });
      setPeople(json.people);
      setDomain(json.domain);
      if (typeof json.credits === "number") setCredits(json.credits);
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
    }
    setBusy(null);
  }

  async function reveal(p: Person) {
    setBusy(p.id);
    setMsg(null);
    try {
      const json = await post({ action: "reveal", personId: p.id, personName: p.name });
      const got = json.person as Person | null;
      if (typeof json.credits === "number") setCredits(json.credits);
      if (!got?.email) setMsg({ tone: "error", text: `Apollo has no email for ${p.name}.` });
      setPeople((prev) => (prev ?? []).map((x) => (x.id === p.id ? { ...x, ...(got ?? {}), id: x.id, name: x.name } : x)));
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
    }
    setBusy(null);
  }

  async function use(p: Person) {
    if (!me) return;
    setBusy("use-" + p.id);
    setMsg(null);
    const fields: Record<string, string> = { contact_name: p.name, title: p.title || "Owner" };
    if (p.email) fields.owner_email = p.email;
    if (p.phone) fields.owner_phone = p.phone;
    if (p.linkedin) fields.contact_linkedin = p.linkedin;
    const res = await saveBusinessContact(createClient(), me.id, { key: place.id, place, searchType, existing }, fields, sourceDetail);
    setBusy(null);
    if (res.existing) onSaved(res.existing);
    setMsg(res.error ? { tone: "error", text: res.error } : { tone: "ok", text: `${p.name} saved as the business owner.` });
  }

  const noDomain = !place.website || place.websiteStatus === "Social page only";

  return (
    <div className="find-owner">
      {people === null ? (
        <button type="button" className="btn-mini" disabled={!me || noDomain || busy === "search"} onClick={() => void search()}
          title={noDomain ? "Needs the business's own website domain" : "Looks up owners at their domain on Apollo.io"}>
          {busy === "search" ? "Looking up…" : "Find owner contact (Apollo)"}
        </button>
      ) : (
        <div className="fo-results">
          <div className="hint">
            Apollo: {people.length ? `${people.length} at ${domain}` : `no owners found at ${domain}`}
            {credits != null && ` · ${credits} credits left`}
          </div>
          {people.map((p) => (
            <div key={p.id} className="fo-row">
              <div>
                <b>{p.name}</b>
                {p.title && <span className="hint"> · {p.title}</span>}
              </div>
              <div className="fo-links">
                {p.email ? (
                  <a href={`mailto:${p.email}`}>{p.email}</a>
                ) : (
                  <button type="button" className="linkbtn" disabled={!!busy} onClick={() => void reveal(p)}>
                    {busy === p.id ? "Revealing…" : "Reveal email (1 credit)"}
                  </button>
                )}
                {p.phone && <a href={`tel:${p.phone.replace(/[^0-9+]/g, "")}`}>{p.phone}</a>}
                {p.linkedin && (
                  <a href={p.linkedin} target="_blank" rel="noopener noreferrer">LinkedIn</a>
                )}
              </div>
              <button type="button" className="btn-mini" disabled={!me || !!busy} onClick={() => void use(p)}>
                {busy === "use-" + p.id ? "Saving…" : "Use as business owner"}
              </button>
            </div>
          ))}
        </div>
      )}
      {msg && <span className={msg.tone === "ok" ? "hint" : "bad-text"} style={{ fontSize: 12.5 }}>{msg.text}</span>}
    </div>
  );
}
