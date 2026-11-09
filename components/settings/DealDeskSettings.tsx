"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DealSettings } from "@/lib/deals/types";

type Field = {
  key: keyof DealSettings;
  label: string;
  hint: string;
  unit: "$/hr" | "%" | "date";
  nullable?: boolean;
};

const FIELDS: Field[] = [
  { key: "project_hourly_rate", label: "Project hourly rate", hint: "Labor on the internal deal doc: est. project hours x this rate. Not set: margin shows as incomplete.", unit: "$/hr", nullable: true },
  { key: "management_hourly_rate", label: "Management hourly rate", hint: "Approved management time (time clock, Phase 2 payouts). Not part of deal labor.", unit: "$/hr" },
  { key: "commission_pct", label: "Sales commission", hint: "Of deal value, to the deal owner, accrued as cash is collected.", unit: "%" },
  { key: "earn_up_pct", label: "Earn-up", hint: "Of deal value, to the earn-up pool, accrued as cash is collected.", unit: "%" },
  { key: "earn_up_ends", label: "Earn-up ends", hint: "Last month the earn-up pool applies.", unit: "date" },
  { key: "default_overage_rate", label: "Default overage rate", hint: "Suggested overage rate on line items.", unit: "$/hr" },
];

const input = "w-40 rounded border border-neutral-300 px-2 py-1.5 text-sm";

function toForm(s: DealSettings | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of FIELDS) {
    const v = s?.[f.key];
    out[f.key] = v == null ? "" : String(v);
  }
  return out;
}

export default function DealDeskSettings({
  initial,
  memberId,
  templates,
}: {
  initial: DealSettings | null;
  memberId: string;
  templates: { label: string; url: string | null }[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [saved, setSaved] = useState(initial);
  const [form, setForm] = useState(() => toForm(initial));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(saved));

  function validate(): Record<string, number | string | null> | string {
    const patch: Record<string, number | string | null> = {};
    for (const f of FIELDS) {
      const raw = form[f.key].trim();
      if (f.unit === "date") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${f.label}: pick a date.`;
        patch[f.key] = raw;
        continue;
      }
      if (!raw) {
        if (f.nullable) {
          patch[f.key] = null;
          continue;
        }
        return `${f.label} is required.`;
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return `${f.label}: enter a number, 0 or more.`;
      if (f.unit === "%" && n > 100) return `${f.label}: 100 at most.`;
      patch[f.key] = n;
    }
    return patch;
  }

  async function save() {
    const patch = validate();
    if (typeof patch === "string") {
      setMsg({ ok: false, text: patch });
      return;
    }
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabase
      .from("deal_settings")
      .update({ ...patch, updated_by: memberId })
      .eq("id", true)
      .select("*");
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    // RLS refusals come back as zero rows, not an error.
    if (!data?.length) return setMsg({ ok: false, text: "Not saved: only Admins can change these settings." });
    const next = data[0] as DealSettings;
    setSaved(next);
    setForm(toForm(next));
    setMsg({ ok: true, text: "Saved." });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-neutral-200 p-5">
        <h2 className="text-base font-semibold text-foreground">Rates</h2>
        <div className="mt-4 space-y-4">
          {FIELDS.map((f) => (
            <label key={f.key} className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="w-48 text-sm font-medium text-neutral-700">{f.label}</span>
              <span className="flex items-center gap-1.5">
                <input
                  type={f.unit === "date" ? "date" : "number"}
                  inputMode={f.unit === "date" ? undefined : "decimal"}
                  min={f.unit === "date" ? undefined : 0}
                  max={f.unit === "%" ? 100 : undefined}
                  step="any"
                  value={form[f.key]}
                  placeholder={f.nullable ? "Not set" : undefined}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  className={input}
                />
                {f.unit !== "date" && <span className="text-sm text-neutral-500">{f.unit}</span>}
              </span>
              <span className="w-full text-xs text-neutral-500 sm:ml-52">{f.hint}</span>
            </label>
          ))}
        </div>
        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={busy || !dirty}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Saving..." : "Save"}
          </button>
          {msg && <span className={`text-sm ${msg.ok ? "text-green-700" : "text-red-700"}`}>{msg.text}</span>}
          {saved?.updated_at && !msg && (
            <span className="text-xs text-neutral-500">
              Last changed {new Date(saved.updated_at).toLocaleString()}
            </span>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 p-5">
        <h2 className="text-base font-semibold text-foreground">Edit legal text in Google Docs</h2>
        <p className="mt-1 text-sm text-neutral-500">
          The fixed wording of proposals and SOWs lives in the two master Docs. New documents copy them, so edits
          apply from the next Generate on. Keep the {"{{tokens}}"} and [[BEGIN / END]] markers intact.
        </p>
        <ul className="mt-3 space-y-1.5">
          {templates.map((t) => (
            <li key={t.label} className="text-sm">
              {t.url ? (
                <a href={t.url} target="_blank" rel="noreferrer" className="font-medium text-accent underline">
                  {t.label}
                </a>
              ) : (
                <span className="text-neutral-500">{t.label}: template ID not set</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
