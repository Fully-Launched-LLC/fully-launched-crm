"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TeamMember } from "@/lib/types";
import {
  GENERIC_FIELDS,
  genericRowToLead,
  guessMapping,
  isLegacyCsv,
  legacyRowToLead,
  parseCsv,
  type GenericField,
  type GenericMapping,
} from "@/lib/leads/csv";
import { upsertLeads, type LeadInput, type UpsertSummary } from "@/lib/leads/upsert";
import { LEAD_SOURCES, LEAD_STATUS_LABELS, sourceLabel, type LeadSource } from "@/lib/leads/labels";

// CSV import: parse in the browser, map with a preset, then upsert_leads in
// merge mode (existing leads get their empty fields filled, never
// overwritten). One lead_imports row per import records the counts.
//   Legacy preset: Matteo's Lead Finder CSV export. Rows carry no place id;
//   the Google Maps link's cid (external_ids.cid) matches them to leads the
//   new Lead Finder already added, and future results to them.
//   Generic preset: map any CSV's columns to lead fields.

type Preset = "legacy" | "generic";
type Step = "pick" | "map" | "running" | "done";

const input = "mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm text-foreground";
const label = "block text-xs font-medium text-neutral-600";
const btn = "rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50";
const primaryBtn = "rounded-md bg-header px-3 py-1.5 text-sm font-medium text-header-foreground disabled:opacity-50";

export default function ImportDialog({
  me,
  onClose,
  onImported,
}: {
  me: TeamMember | null;
  onClose: () => void;
  onImported: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [step, setStep] = useState<Step>("pick");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [preset, setPreset] = useState<Preset>("generic");
  const [mapping, setMapping] = useState<GenericMapping>({});
  const [source, setSource] = useState<LeadSource>("csv_import");
  const [sourceDetail, setSourceDetail] = useState("");
  const [ownMe, setOwnMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<UpsertSummary | null>(null);

  async function onFile(file: File) {
    setError(null);
    const text = await file.text();
    const parsed = parseCsv(text);
    if (!parsed.headers.length || !parsed.rows.length) {
      setError("That file has no rows.");
      return;
    }
    const legacy = isLegacyCsv(parsed.headers);
    setFileName(file.name);
    setHeaders(parsed.headers);
    setRows(parsed.rows);
    setPreset(legacy ? "legacy" : "generic");
    setMapping(guessMapping(parsed.headers));
    setSource(legacy ? "lead_finder" : "csv_import");
    setSourceDetail(legacy ? `Legacy Lead Finder CSV: ${file.name}` : file.name);
    setStep("map");
  }

  // Mapped rows (null = no company, skipped).
  const mapped: (LeadInput | null)[] = useMemo(
    () => rows.map((r) => (preset === "legacy" ? legacyRowToLead(r) : genericRowToLead(r, mapping))),
    [rows, preset, mapping]
  );
  const valid = mapped.filter(Boolean) as LeadInput[];
  const withCid = valid.filter((l) => l.external_ids && (l.external_ids as Record<string, string>).cid).length;

  async function run() {
    if (!valid.length) return;
    setStep("running");
    setError(null);
    const leads = valid.map((l) => ({
      ...l,
      source,
      source_detail: sourceDetail.trim() || null,
      found_by: me?.id ?? null,
      owner: ownMe && me ? me.id : null,
    }));
    const { data: imp, error: e1 } = await supabase
      .from("lead_imports")
      .insert({ source, file_name: fileName, row_count: rows.length, imported_by: me?.id })
      .select("id")
      .single();
    if (e1) {
      setError(e1.message);
      setStep("map");
      return;
    }
    try {
      const res = await upsertLeads(supabase, leads, {
        mode: "merge",
        onProgress: (done, total) => setProgress({ done, total }),
      });
      const skippedNoCompany = rows.length - valid.length;
      await supabase
        .from("lead_imports")
        .update({ inserted: res.inserted, merged: res.merged, skipped: res.skipped + skippedNoCompany })
        .eq("id", imp.id);
      setSummary(res);
      setStep("done");
      onImported();
    } catch (e) {
      setError((e as Error).message + " Rows before this batch were saved; re-running the import is safe (it merges).");
      setStep("map");
      onImported();
    }
  }

  const reasons = useMemo(() => {
    if (!summary) return [];
    const counts = new Map<string, number>();
    summary.outcomes
      .filter((o) => o.result === "skipped")
      .forEach((o) => counts.set(o.reason ?? "Skipped", (counts.get(o.reason ?? "Skipped") ?? 0) + 1));
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [summary]);

  const preview = valid.slice(0, 5);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Import leads">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Import leads from CSV</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Rows that match an existing lead (Google listing, email, website, phone) fill in its empty fields. Nothing is overwritten.
            </p>
          </div>
          {step !== "running" && (
            <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100">
              Close
            </button>
          )}
        </div>

        {error && <p className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {step === "pick" && (
          <label className="mt-5 flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-neutral-300 px-6 py-10 text-sm text-neutral-600 hover:bg-neutral-50">
            <span className="font-medium text-foreground">Choose a CSV file</span>
            <span className="text-xs">Matteo&apos;s Lead Finder exports are recognized automatically.</span>
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
          </label>
        )}

        {step === "map" && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className={label}>
                Format
                <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)} className={input}>
                  <option value="legacy">Lead Finder export (legacy)</option>
                  <option value="generic">Other CSV (map columns)</option>
                </select>
              </label>
              <label className={label}>
                Source
                <select value={source} onChange={(e) => setSource(e.target.value as LeadSource)} className={input}>
                  {LEAD_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {sourceLabel(s)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={`${label} sm:col-span-2`}>
                Source detail
                <input value={sourceDetail} onChange={(e) => setSourceDetail(e.target.value)} className={input} />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input type="checkbox" className="h-4 w-4" checked={ownMe} onChange={(e) => setOwnMe(e.target.checked)} />
              Set me as owner of new leads (otherwise they&apos;re unassigned)
            </label>

            {preset === "legacy" && !isLegacyCsv(headers) && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                This file doesn&apos;t have the Lead Finder columns (Business Name, Google Maps Link). Use &quot;Other CSV&quot;.
              </p>
            )}
            {preset === "legacy" && (
              <p className="text-xs text-neutral-500">
                Lead Finder export: business, contact, scan findings, scores, pipeline status and the Google Maps cid (used for matching).
                E-commerce fit is kept only for businesses that already sell online (current rule).
              </p>
            )}

            {preset === "generic" && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
                {GENERIC_FIELDS.map((fdef) => (
                  <label key={fdef.key} className={label}>
                    {fdef.label}
                    <select
                      value={mapping[fdef.key as GenericField] ?? ""}
                      onChange={(e) => setMapping((m) => ({ ...m, [fdef.key]: e.target.value || undefined }))}
                      className={input}
                    >
                      <option value="">(not in file)</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            )}

            <div className="rounded-md bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
              <b>{fileName}</b>: {rows.length} rows, {valid.length} with a company name
              {rows.length - valid.length > 0 && <> ({rows.length - valid.length} will be skipped)</>}
              {withCid > 0 && <>, {withCid} with a Google Maps cid</>}.
            </div>

            {preview.length > 0 && (
              <div className="overflow-x-auto rounded-md border border-neutral-200">
                <table className="w-full min-w-[640px] text-xs">
                  <thead>
                    <tr className="bg-neutral-50 text-left text-neutral-500">
                      <th className="px-2 py-1.5">Company</th>
                      <th className="px-2 py-1.5">Contact</th>
                      <th className="px-2 py-1.5">Email / phone</th>
                      <th className="px-2 py-1.5">Website</th>
                      <th className="px-2 py-1.5">City</th>
                      {preset === "legacy" && <th className="px-2 py-1.5">Fit / status</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((l, i) => (
                      <tr key={i} className="border-t border-neutral-100">
                        <td className="px-2 py-1.5 font-medium text-foreground">{l.company}</td>
                        <td className="px-2 py-1.5">{l.contact_name ?? ""}</td>
                        <td className="px-2 py-1.5">{l.email ?? l.phone ?? ""}</td>
                        <td className="max-w-[160px] truncate px-2 py-1.5">{l.website ?? ""}</td>
                        <td className="px-2 py-1.5">{[l.city, l.state].filter(Boolean).join(", ")}</td>
                        {preset === "legacy" && (
                          <td className="px-2 py-1.5">
                            {(l.branch_fit ?? []).join(", ")}
                            {l.status ? ` · ${LEAD_STATUS_LABELS[l.status]}` : ""}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-between gap-2">
              <button type="button" className={btn} onClick={() => setStep("pick")}>
                Choose another file
              </button>
              <button type="button" className={primaryBtn} disabled={!valid.length} onClick={() => void run()}>
                Import {valid.length} rows
              </button>
            </div>
          </div>
        )}

        {step === "running" && (
          <div className="mt-6 space-y-2">
            <p className="text-sm text-neutral-700">
              Importing{progress ? `: ${progress.done} of ${progress.total}` : "..."} Keep this window open.
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${progress ? (100 * progress.done) / Math.max(1, progress.total) : 5}%` }}
              />
            </div>
          </div>
        )}

        {step === "done" && summary && (
          <div className="mt-5 space-y-3 text-sm">
            <div className="grid grid-cols-3 gap-2 text-center">
              {(
                [
                  ["Added", summary.inserted],
                  ["Merged into existing", summary.merged],
                  ["Skipped", summary.skipped + (rows.length - valid.length)],
                ] as [string, number][]
              ).map(([k, v]) => (
                <div key={k} className="rounded-md border border-neutral-200 py-2">
                  <div className="text-xl font-semibold tabular-nums text-foreground">{v}</div>
                  <div className="text-xs text-neutral-500">{k}</div>
                </div>
              ))}
            </div>
            {(reasons.length > 0 || rows.length > valid.length) && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Why rows were skipped</div>
                <ul className="mt-1 list-disc pl-5 text-neutral-700">
                  {rows.length > valid.length && <li>No company name: {rows.length - valid.length}</li>}
                  {reasons.map(([r, n]) => (
                    <li key={r}>
                      {r}: {n}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end">
              <button type="button" className={primaryBtn} onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
