"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TeamMember } from "@/lib/types";
import { BRANCHES, BRANCH_COLORS, type Branch } from "@/lib/theme";
import { upsertLead, type LeadInput } from "@/lib/leads/upsert";
import { LEAD_SOURCES, sourceLabel, type LeadSource } from "@/lib/leads/labels";
import { LEAD_LIST_COLUMNS, type LeadListRow } from "@/lib/leads/list";

// Manual add. Goes through upsert_lead in skip mode: if the company, email,
// website or phone already belongs to a lead, nothing is written and the
// existing lead is offered instead.

const MATCHED_ON: Record<string, string> = {
  google_place_id: "the same Google listing",
  cid: "the same Google listing",
  email: "the same email",
  domain: "the same website",
  phone: "the same phone number",
};

// Sources a person picks by hand (the rest come from integrations/imports).
const MANUAL_SOURCES: LeadSource[] = ["manual", "referral", "personal_network", "etsy", "happenstance", "gojiberry", "heyreach", "claude"];

const input = "mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm text-foreground";
const label = "block text-xs font-medium text-neutral-600";

export default function AddLeadDialog({
  me,
  onClose,
  onAdded,
  onOpenLead,
}: {
  me: TeamMember | null;
  onClose: () => void;
  onAdded: (row: LeadListRow) => void;
  onOpenLead: (id: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [f, setF] = useState({
    company: "",
    contact_name: "",
    title: "",
    email: "",
    phone: "",
    website: "",
    city: "",
    state: "",
    linkedin: "",
    source_detail: "",
    notes: "",
  });
  const [source, setSource] = useState<LeadSource>("manual");
  const [fit, setFit] = useState<Branch[]>([]);
  const [mine, setMine] = useState(true);
  const [alum, setAlum] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dupe, setDupe] = useState<{ id: string; on: string } | null>(null);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));
  const t = (v: string) => v.trim() || null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.company.trim()) {
      setError("Company is required.");
      return;
    }
    setBusy(true);
    setError(null);
    setDupe(null);
    const lead: LeadInput = {
      company: f.company.trim(),
      contact_name: t(f.contact_name),
      title: t(f.title),
      email: t(f.email),
      phone: t(f.phone),
      website: t(f.website),
      city: t(f.city),
      state: t(f.state),
      source,
      source_detail: t(f.source_detail),
      notes: t(f.notes),
      branch_fit: fit,
      wheaton_alum: alum,
      external_ids: f.linkedin.trim() ? { linkedin: f.linkedin.trim() } : {},
      found_by: me?.id ?? null,
      owner: mine && me ? me.id : null,
    };
    try {
      const res = await upsertLead(supabase, lead, "skip");
      if (res.result === "inserted" && res.leadId) {
        const { data } = await supabase.from("leads").select(LEAD_LIST_COLUMNS).eq("id", res.leadId).single();
        if (data) onAdded(data as unknown as LeadListRow);
        else onOpenLead(res.leadId);
        return;
      }
      if (res.leadId && res.matchedOn) setDupe({ id: res.leadId, on: MATCHED_ON[res.matchedOn] ?? res.matchedOn });
      else setError(res.reason ?? "Not added.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Add lead">
      <form onSubmit={submit} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-foreground">Add a lead</h2>
        <p className="mt-1 text-xs text-neutral-500">Checked against every existing lead (Google listing, email, website, phone) before it&apos;s added.</p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className={`${label} col-span-2`}>
            Company *
            <input autoFocus value={f.company} onChange={set("company")} className={input} />
          </label>
          <label className={label}>
            Contact name
            <input value={f.contact_name} onChange={set("contact_name")} className={input} />
          </label>
          <label className={label}>
            Title
            <input value={f.title} onChange={set("title")} className={input} />
          </label>
          <label className={label}>
            Email
            <input type="email" value={f.email} onChange={set("email")} className={input} />
          </label>
          <label className={label}>
            Phone
            <input value={f.phone} onChange={set("phone")} className={input} />
          </label>
          <label className={label}>
            Website
            <input value={f.website} onChange={set("website")} placeholder="example.com" className={input} />
          </label>
          <label className={label}>
            LinkedIn URL
            <input value={f.linkedin} onChange={set("linkedin")} className={input} />
          </label>
          <label className={label}>
            City
            <input value={f.city} onChange={set("city")} className={input} />
          </label>
          <label className={label}>
            State
            <input value={f.state} onChange={set("state")} className={input} />
          </label>
          <label className={label}>
            Source
            <select value={source} onChange={(e) => setSource(e.target.value as LeadSource)} className={input}>
              {MANUAL_SOURCES.filter((s) => LEAD_SOURCES.includes(s)).map((s) => (
                <option key={s} value={s}>
                  {sourceLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            Source detail <span className="font-normal text-neutral-400">e.g. who referred them</span>
            <input value={f.source_detail} onChange={set("source_detail")} className={input} />
          </label>
          <div className="col-span-2">
            <span className={label}>Branch fit</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {BRANCHES.map((b) => {
                const on = fit.includes(b);
                return (
                  <button
                    key={b}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setFit((prev) => (on ? prev.filter((x) => x !== b) : [...prev, b]))}
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${on ? BRANCH_COLORS[b] : "border border-neutral-300 text-neutral-500"}`}
                  >
                    {b}
                  </button>
                );
              })}
            </div>
          </div>
          <label className={`${label} col-span-2`}>
            Notes
            <textarea value={f.notes} onChange={set("notes")} rows={2} className={input} />
          </label>
          <label className="col-span-2 flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" className="h-4 w-4" checked={alum} onChange={(e) => setAlum(e.target.checked)} />
            Wheaton alum
          </label>
          <label className="col-span-2 flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" className="h-4 w-4" checked={mine} onChange={(e) => setMine(e.target.checked)} />
            I&apos;m working this lead (set me as owner)
          </label>
        </div>

        {dupe && (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Already a lead ({dupe.on}). Nothing was added.{" "}
            <button type="button" className="font-medium underline" onClick={() => onOpenLead(dupe.id)}>
              Open it
            </button>
          </p>
        )}
        {error && <p className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="rounded-md bg-header px-3 py-1.5 text-sm font-medium text-header-foreground disabled:opacity-50">
            {busy ? "Adding..." : "Add lead"}
          </button>
        </div>
      </form>
    </div>
  );
}
