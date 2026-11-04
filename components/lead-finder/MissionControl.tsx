"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/lead-finder/apiFetch";
import type { LeadStatus, TeamMember } from "@/lib/types";
import type { LeadFinderRun, RunResult, ScannedPlace, SearchParams, ServiceKey, SweepParams } from "@/lib/lead-finder/types";
import { SERVICE_LABELS, SERVICE_ORDER } from "@/lib/lead-finder/sweep";
import { previewQuery } from "@/lib/lead-finder/previewQuery";
import { LEAD_STATUS_LABELS, TOUCH_CHANNEL_LABELS, relativeTime } from "@/lib/leads/labels";
import Dropdown from "@/components/lead-finder/Dropdown";
import { ROCKET_IDLE_SRC } from "@/components/lead-finder/assets";
import LocalDateTime from "@/components/LocalDateTime";

// Matteo's mission control (results view): stats, tabs, service filter,
// bulk bar, table, sticky detail panel. His browser-only pipeline status is
// now the shared leads.status: the four buttons write to the lead, and a
// business that isn't a lead yet shows "Add to Leads" instead.

export type Svc = Record<ServiceKey | "servicetitan", boolean>;
type Sort = "priority" | "score" | "rating" | "reviews" | "name";

const GAP_LABELS: Record<ServiceKey, string> = { website: "Website", social: "Social", ecom: "E-commerce", ai: "AI" };

// His four pipeline buttons, mapped onto leads.status.
const PIPELINE: [LeadStatus, string][] = [
  ["new", "New"],
  ["contacted", "Contacted"],
  ["interested", "Interested"],
  ["not_interested", "Not a fit"],
];
const STATUS_TEXT: Record<LeadStatus, string> = { ...LEAD_STATUS_LABELS, not_interested: "Not a fit" };
const STATUS_CLASS: Record<LeadStatus, string> = {
  new: "st-new",
  contacted: "st-contacted",
  interested: "st-interested",
  not_interested: "st-nofit",
  replied: "st-replied",
  converted: "st-converted",
  dead: "st-dead",
};

const MATCHED_ON: Record<string, string> = {
  google_place_id: "same Google listing",
  cid: "same Google listing",
  email: "same email",
  domain: "same website",
  phone: "same phone",
};

const RLS_HINT = "A Salesperson can only change leads they own or that have no owner.";

const noSite = (l: ScannedPlace) => !l.website || l.websiteStatus === "Social page only" || l.websiteStatus === "Broken";
const hasContact = (l: ScannedPlace) => (l.emails && l.emails.length > 0) || !!l.ownerName;
const fmtRating = (r: number | "N/A") => (typeof r === "number" ? r.toFixed(1) : r);
const scoreClass = (s: number) => (s >= 60 ? "s-hi" : s >= 35 ? "s-mid" : "s-lo");
const money = (n: number) => "$" + n.toFixed(2);

export default function MissionControl({
  run,
  results,
  members,
  svc,
  onToggleSvc,
  onChanged,
  onNewSearch,
}: {
  run: LeadFinderRun;
  results: RunResult[];
  members: TeamMember[];
  svc: Svc;
  onToggleSvc: (k: keyof Svc) => void;
  onChanged: () => void;
  onNewSearch: () => void;
}) {
  const isSweep = run.kind === "sweep";
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("priority");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [minPriority, setMinPriority] = useState(70);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  // Status changes made here, until the next reload of the run's results.
  const [statusOverride, setStatusOverride] = useState<Record<string, LeadStatus>>({});
  const detailRef = useRef<HTMLElement>(null);

  useEffect(() => setStatusOverride({}), [results]);

  const statusOf = (r: RunResult): LeadStatus | null =>
    r.existing ? statusOverride[r.existing.id] ?? (r.existing.status as LeadStatus) : null;

  // His tabs. "Not contacted" = not a lead yet, or a lead still at New.
  const TABS: [string, string, (r: RunResult) => boolean][] = [
    ["all", "All", () => true],
    ["nosite", "No real website", (r) => noSite(r.place)],
    ["hot", "Hot (60+)", (r) => r.place.score >= 60],
    ["reach", "Has contact", (r) => hasContact(r.place)],
    ["fresh", "Not contacted", (r) => !r.existing || statusOf(r) === "new"],
    ["notlead", "Not in Leads", (r) => !r.existing],
  ];

  // His service filter: ServiceTitan only, or any selected gap.
  const wanted = SERVICE_ORDER.filter((s) => svc[s]);
  const current = useMemo(
    () =>
      svc.servicetitan
        ? results.filter((r) => r.place.usesServiceTitan)
        : results.filter((r) => r.place.services.some((s) => wanted.includes(s))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [results, svc]
  );

  const test = (TABS.find((t) => t[0] === tab) ?? TABS[0])[2];
  const needle = q.trim().toLowerCase();
  const num = (v: number | "N/A") => (typeof v === "number" ? v : 0);
  const visible = current
    .filter(test)
    .filter((r) => !needle || r.place.name.toLowerCase().includes(needle))
    .sort((a, b) =>
      sort === "name"
        ? a.place.name.localeCompare(b.place.name)
        : sort === "rating"
          ? num(b.place.rating) - num(a.place.rating)
          : sort === "reviews"
            ? b.place.reviews - a.place.reviews
            : sort === "score"
              ? b.place.score - a.place.score
              : b.place.priority - a.place.priority || b.place.score - a.place.score
    );

  const selected =
    current.find((r) => r.google_place_id === selectedId) ?? (visible.length ? visible[0] : null);

  const checkedRows = current.filter((r) => checked.has(r.google_place_id));
  const checkedNew = checkedRows.filter((r) => !r.existing);
  const checkedLeads = checkedRows.filter((r) => r.existing && statusOf(r) !== "converted");
  const allChecked = visible.length > 0 && visible.every((r) => checked.has(r.google_place_id));
  const minCount = current.filter((r) => !r.existing && r.place.priority >= minPriority && r.place.services.length > 0).length;

  const memberName = (id: string | null) => members.find((m) => m.id === id)?.name ?? "Unknown";

  // ---- Writes ----
  async function add(body: { placeIds: string[] } | { minPriority: number }) {
    setBusy(true);
    setMessage(null);
    let res: Response;
    let json;
    try {
      res = await apiFetch(`/api/lead-finder/runs/${run.id}/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      json = await res.json();
    } catch (e) {
      setBusy(false);
      setMessage({ tone: "error", text: (e as Error).message || "Could not add." });
      return;
    }
    setBusy(false);
    if (!res.ok) {
      setMessage({ tone: "error", text: json.error ?? "Could not add." });
      return;
    }
    const parts = [`Added ${json.inserted} to Leads.`];
    if (json.skipped) parts.push(`Skipped ${json.skipped} already on the lead list.`);
    setMessage({ tone: "ok", text: parts.join(" ") });
    setChecked(new Set());
    onChanged();
  }

  // Writes leads.status. RLS decides who may: a blocked update returns no
  // rows, so count what came back.
  async function setStatus(leadIds: string[], status: LeadStatus) {
    if (!leadIds.length) return;
    setBusy(true);
    setMessage(null);
    const { data, error } = await createClient().from("leads").update({ status }).in("id", leadIds).select("id, status");
    setBusy(false);
    if (error) {
      setMessage({ tone: "error", text: error.message });
      return;
    }
    const updated = (data ?? []) as { id: string; status: LeadStatus }[];
    setStatusOverride((prev) => {
      const next = { ...prev };
      updated.forEach((u) => (next[u.id] = u.status));
      return next;
    });
    const missed = leadIds.length - updated.length;
    if (missed > 0) {
      setMessage({
        tone: "error",
        text:
          leadIds.length === 1
            ? `You can't change this lead's status. ${RLS_HINT}`
            : `Updated ${updated.length}. ${missed} not changed. ${RLS_HINT}`,
      });
    } else if (leadIds.length > 1) {
      setMessage({ tone: "ok", text: `Marked ${updated.length} as ${STATUS_TEXT[status].toLowerCase()}.` });
      setChecked(new Set());
    }
  }

  // ---- CSV (his columns, plus Priority; status comes from Leads) ----
  function exportCSV(onlyChecked: boolean) {
    const list = onlyChecked ? checkedRows : visible;
    if (!list.length) return;
    const headers = ["Priority", "Lead Score", "Business Name", "Category", "Address", "Phone", "Google Rating", "Reviews", "Website", "Website Status",
      "Possible Owner", "Emails", "Contact Page", "Social Links Found", "Online Store Found", "Marketplaces", "Software Used", "Uses ServiceTitan", "Runs Ads",
      "Other Signals", "Services Needed", "Website Reasons", "Social Reasons", "E-commerce Reasons", "AI Reasons", "Pipeline Status", "Google Maps Link"];
    const rows = list.map((r) => {
      const l = r.place;
      const st = statusOf(r);
      return [l.priority, l.score, l.name, l.category, l.address, l.phone, l.rating, l.reviews, l.website, l.websiteStatus,
        l.ownerName || "", (l.emails || []).join("; "), l.contactPage || "", (l.socials || []).join("; "), l.store || "", (l.marketplaces || []).join("; "), (l.tech || []).join("; "),
        l.usesServiceTitan ? "Yes" : "", (l.ads || []).join("; "), (l.signals || []).join("; "), l.services.map((s) => GAP_LABELS[s]).join("; "),
        l.tags.website.join("; "), l.tags.social.join("; "), l.tags.ecom.join("; "), l.tags.ai.join("; "), st ? STATUS_TEXT[st] : "Not in Leads", l.mapsUrl];
    });
    const csv = [headers, ...rows].map((r) => r.map((c) => '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"').join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    const slug = (t: string) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const p = run.params as SearchParams | SweepParams;
    const place = [p.city, p.zip, p.state].map(slug).filter(Boolean).join("-");
    a.href = url;
    a.download =
      [svc.servicetitan ? "SERVICETITAN-leads" : "fullylaunched-leads", place, new Date().toISOString().slice(0, 10)].filter(Boolean).join("-") + ".csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function toggleCheck(id: string, on: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function open(id: string) {
    setSelectedId(id);
    if (window.innerWidth < 960) detailRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  const hot = current.filter((r) => r.place.score >= 60).length;
  const ns = current.filter((r) => noSite(r.place)).length;
  const reach = current.filter((r) => hasContact(r.place)).length;
  const inLeads = current.filter((r) => r.existing).length;
  const stat = (label: string, val: number, color?: string) => (
    <div className="panel stat" key={label}>
      <span>{label}</span>
      <b style={{ color: color ?? "var(--bright)" }}>{val}</b>
    </div>
  );

  return (
    <main className="mc">
      <div className="panel mission-bar">
        <div className="who">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ROCKET_IDLE_SRC} alt="" />
          <div>
            <div className="kicker">{run.status === "cancelled" ? "Mission cancelled" : "Mission landed"}</div>
            <h2>{run.params.label || "Results"}</h2>
            <div className="meta">
              {isSweep ? "Area sweep" : "Quick search"} by {memberName(run.run_by)} · <LocalDateTime iso={run.created_at} /> · est.{" "}
              {money(Number(run.est_cost ?? 0))}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button type="button" className="btn" onClick={() => exportCSV(false)}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
            </svg>
            Export CSV
          </button>
          <button type="button" className="btn btn-gold" onClick={onNewSearch}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            New search
          </button>
        </div>
      </div>

      <section className="stats" aria-label="Mission stats">
        {stat("Businesses checked", results.length)}
        {stat("Leads matched", current.length, "var(--gold)")}
        {stat("No real website", ns, "var(--web)")}
        {stat("Hot leads (60+)", hot, "var(--warn)")}
        {stat("Owner or email found", reach, "var(--good)")}
        {stat("Already in Leads", inLeads, "var(--ai)")}
      </section>

      <div className="work">
        <section className="panel list" aria-label="Leads">
          <div className="toolbar">
            <div className="tabs" role="tablist" aria-label="Filter leads">
              {TABS.map(([key, text, t]) => (
                <button key={key} type="button" role="tab" className="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
                  {text} <span className="n">{current.filter(t).length}</span>
                </button>
              ))}
            </div>
            <div className="tools">
              <label className="sr" htmlFor="lf-q">Search leads</label>
              <input className="field" id="lf-q" type="search" placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} />
              <Dropdown
                label="Sort by"
                value={sort}
                onChange={(v) => setSort(v as Sort)}
                options={[
                  { value: "priority", label: "Sort: priority" },
                  { value: "score", label: "Sort: score" },
                  { value: "rating", label: "Sort: rating" },
                  { value: "reviews", label: "Sort: reviews" },
                  { value: "name", label: "Sort: name" },
                ]}
              />
            </div>
          </div>

          <div className="filterbar">
            <span>Services</span>
            <div className={`chips${svc.servicetitan ? " st-mode" : ""}`}>
              {[...SERVICE_ORDER, "servicetitan" as const].map((k) => (
                <button key={k} type="button" className="chip" data-s={k} aria-pressed={svc[k]} onClick={() => onToggleSvc(k)}>
                  <i />
                  {k === "servicetitan" ? "ServiceTitan only" : SERVICE_LABELS[k]}
                </button>
              ))}
            </div>
          </div>

          {isSweep && (
            <div className="filterbar">
              <span>Add all with priority at least</span>
              <input
                className="field mono"
                type="number"
                min={1}
                max={95}
                aria-label="Minimum priority"
                value={minPriority}
                onChange={(e) => setMinPriority(Math.max(1, Number(e.target.value) || 1))}
              />
              <button type="button" className="btn btn-gold" disabled={busy || minCount === 0} onClick={() => void add({ minPriority })}>
                Add {minCount} to Leads
              </button>
            </div>
          )}

          {checked.size > 0 && (
            <div className="bulk">
              <b>{checked.size} selected</b>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {checkedNew.length > 0 && (
                  <button type="button" className="btn btn-gold" disabled={busy} onClick={() => void add({ placeIds: checkedNew.map((r) => r.google_place_id) })}>
                    Add {checkedNew.length} to Leads
                  </button>
                )}
                {checkedLeads.length > 0 && (
                  <>
                    <button type="button" className="btn" disabled={busy} onClick={() => void setStatus(checkedLeads.map((r) => r.existing!.id), "contacted")}>
                      Mark contacted
                    </button>
                    <button type="button" className="btn" disabled={busy} onClick={() => void setStatus(checkedLeads.map((r) => r.existing!.id), "interested")}>
                      Mark interested
                    </button>
                  </>
                )}
                <button type="button" className="btn" onClick={() => exportCSV(true)}>
                  Export selected
                </button>
                <button type="button" className="btn" onClick={() => setChecked(new Set())}>
                  Clear
                </button>
              </div>
            </div>
          )}

          {message && (
            <div className="bar-msg">
              <p role="status" className={message.tone === "ok" ? "ok-msg" : "error"}>
                {message.text}
              </p>
            </div>
          )}

          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      className="chk"
                      aria-label="Select all shown leads"
                      checked={allChecked}
                      onChange={(e) =>
                        setChecked((prev) => {
                          const next = new Set(prev);
                          visible.forEach((r) => (e.target.checked ? next.add(r.google_place_id) : next.delete(r.google_place_id)));
                          return next;
                        })
                      }
                    />
                  </th>
                  <th title="Who to call first: established businesses missing one or two of our branches">Priority</th>
                  <th title="Matteo's lead score: how many gaps, and how big">Score</th>
                  <th>Business</th>
                  <th>Rating</th>
                  <th>Gaps we can fill</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.length ? (
                  visible.map((r) => {
                    const l = r.place;
                    const city = (l.address || "").split(",").slice(-3, -1).join(",").trim();
                    const st = statusOf(r);
                    const isSel = selected?.google_place_id === r.google_place_id;
                    return (
                      <tr key={r.google_place_id} className={`lead${isSel ? " sel" : ""}`} onClick={() => open(r.google_place_id)}>
                        <td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="chk"
                            checked={checked.has(r.google_place_id)}
                            onChange={(e) => toggleCheck(r.google_place_id, e.target.checked)}
                            aria-label={`Select ${l.name}`}
                          />
                        </td>
                        <td>
                          <div className="prio">{l.priority}</div>
                        </td>
                        <td>
                          <div className={`score ${scoreClass(l.score)}`}>{l.score}</div>
                          <div className="strip" aria-hidden="true">
                            {SERVICE_ORDER.map((s) => (
                              <span key={s} className={l.services.includes(s) ? s : ""} />
                            ))}
                          </div>
                        </td>
                        <td>
                          <button type="button" className="name" onClick={(e) => { e.stopPropagation(); open(r.google_place_id); }}>
                            {l.name}
                          </button>
                          {l.usesServiceTitan && <span className="badge-st">ServiceTitan</span>}
                          {(l.marketplaces ?? []).map((m) => (
                            <span key={m} className="badge-mkt">{m}</span>
                          ))}
                          <div className="meta">
                            {[l.category, city].filter(Boolean).join(" · ")} ·{" "}
                            {!l.website ? (
                              <span className="site-flag">No website</span>
                            ) : l.websiteStatus === "Has website" ? (
                              "Has website"
                            ) : (
                              <span className="site-flag">{l.websiteStatus}</span>
                            )}
                          </div>
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {l.rating !== "N/A" ? (
                            <>
                              <span className="mono" style={{ color: "var(--bright)", fontWeight: 600 }}>★ {fmtRating(l.rating)}</span>
                              <div className="meta">{l.reviews} reviews</div>
                            </>
                          ) : (
                            <span className="meta">No rating</span>
                          )}
                        </td>
                        <td>
                          <div className="gaps">
                            {SERVICE_ORDER.filter((s) => l.services.includes(s)).map((s) => (
                              <span key={s} className={`gap g-${s}`}>{GAP_LABELS[s]}</span>
                            ))}
                          </div>
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {st ? (
                            <>
                              <span className={`st ${STATUS_CLASS[st]}`}>{STATUS_TEXT[st]}</span>
                              <div className="meta">{r.existing!.owner ? memberName(r.existing!.owner) : "Unassigned"}</div>
                            </>
                          ) : (
                            <button type="button" className="btn-add" disabled={busy} onClick={() => void add({ placeIds: [r.google_place_id] })}>
                              Add to Leads
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty-list">
                        {current.length
                          ? "No leads in this view."
                          : `Checked ${results.length} businesses. None matched${
                              svc.servicetitan
                                ? ": no ServiceTitan users spotted. Many only use it inside the office, so it doesn’t show on their website."
                                : " the services you picked."
                            } Try other services or a wider area.`}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="foot">
            Showing {visible.length} of {current.length} leads · pipeline status is shared with the team on{" "}
            <Link href="/leads">Leads</Link>
          </div>
        </section>

        <aside ref={detailRef} className="panel detail" aria-label="Lead details">
          {selected ? (
            <Detail r={selected} status={statusOf(selected)} busy={busy} memberName={memberName}
              onAdd={() => void add({ placeIds: [selected.google_place_id] })}
              onStatus={(s) => void setStatus([selected.existing!.id], s)} />
          ) : (
            <>
              <div className="kicker">Lead detail</div>
              <p className="meta">Select a business to see everything we found.</p>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}

function Detail({
  r,
  status,
  busy,
  memberName,
  onAdd,
  onStatus,
}: {
  r: RunResult;
  status: LeadStatus | null;
  busy: boolean;
  memberName: (id: string | null) => string;
  onAdd: () => void;
  onStatus: (s: LeadStatus) => void;
}) {
  const l = r.place;
  const tel = l.phone && l.phone !== "No phone listed" ? l.phone.replace(/[^0-9+]/g, "") : "";
  const preview = "/api/lead-finder/preview?" + previewQuery({ ...l, type: r.search_type || l.category });
  const ex = r.existing;
  // His audit page (app/lead-finder/audit). With a lead id the result is
  // saved to leads.audit, and a saved audit reopens without a Google call.
  const audit =
    "/lead-finder/audit?" +
    new URLSearchParams({ place: r.google_place_id, type: r.search_type || l.category || "", ...(ex ? { lead: ex.id } : {}) }).toString();
  const inPipeline = status ? PIPELINE.some(([k]) => k === status) : false;

  return (
    <>
      <div className="d-head">
        <div style={{ minWidth: 0 }}>
          <div className="kicker">Lead detail</div>
          <h3>{l.name}</h3>
          <div className="meta">{[l.category, l.address].filter(Boolean).join(" · ")}</div>
          {(l.usesServiceTitan || (l.marketplaces ?? []).length > 0) && (
            <div style={{ marginTop: 6 }}>
              {l.marketplaces?.length ? <span className="hint">Sells on </span> : null}
              {(l.marketplaces ?? []).map((m) => (
                <span key={m} className="badge-mkt">{m}</span>
              ))}
              {l.usesServiceTitan && <span className="badge-st">ServiceTitan</span>}
            </div>
          )}
        </div>
        <div className="d-score">
          <div>
            <b style={{ color: "var(--bright)" }}>{l.priority}</b>
            <small>priority</small>
          </div>
          <div>
            <b className={scoreClass(l.score)}>{l.score}</b>
            <small>lead score</small>
          </div>
        </div>
      </div>

      <div className="actions">
        {tel ? <a className="btn" href={`tel:${tel}`}>Call</a> : <button type="button" className="btn" disabled>No phone</button>}
        <a className="btn" href={l.mapsUrl} target="_blank" rel="noopener noreferrer">Google Maps</a>
        {l.website ? (
          <a className="btn" href={l.website} target="_blank" rel="noopener noreferrer">Visit site</a>
        ) : (
          <button type="button" className="btn" disabled>No website</button>
        )}
        <a className="btn" href={preview} target="_blank" rel="noopener noreferrer">Preview site</a>
        <a className="btn btn-gold" style={{ gridColumn: "1 / -1" }} href={audit} target="_blank" rel="noopener noreferrer">
          Run audit
        </a>
      </div>

      <div>
        <div className="sec-title">Pipeline</div>
        {ex && status ? (
          <>
            <div className="seg" role="group" aria-label="Pipeline status">
              {PIPELINE.map(([k, text]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={status === k}
                  disabled={busy || status === "converted"}
                  onClick={() => status !== k && onStatus(k)}
                >
                  {text}
                </button>
              ))}
            </div>
            <p className="hint" style={{ marginTop: 6 }}>
              {!inPipeline && <>On Leads as <b>{STATUS_TEXT[status]}</b>. </>}
              Owner: {ex.owner ? memberName(ex.owner) : "Unassigned"} ·{" "}
              {ex.last_touch_at
                ? `${TOUCH_CHANNEL_LABELS[ex.last_touch_channel ?? ""] ?? "Touched"} ${relativeTime(ex.last_touch_at)}`
                : "No touches yet"}
              {" · "}Already a lead ({MATCHED_ON[ex.matched_on]}
              {ex.company && ex.company !== l.name ? `: ${ex.company}` : ""})
            </p>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-gold" style={{ width: "100%", minHeight: 44 }} disabled={busy} onClick={onAdd}>
              Add to Leads
            </button>
            <p className="hint" style={{ marginTop: 6 }}>Not on the lead list yet. Adding makes you the owner.</p>
          </>
        )}
      </div>

      <div>
        <div className="sec-title">Contact</div>
        <div className="contact-list">
          {l.ownerName && (
            <div>
              <b>{l.ownerName}</b> <span className="hint">possible owner</span>
            </div>
          )}
          {tel && <a href={`tel:${tel}`}>{l.phone}</a>}
          {l.emails.map((m) => (
            <a key={m} href={`mailto:${m}`}>{m}</a>
          ))}
          {l.contactPage && (
            <a href={l.contactPage} target="_blank" rel="noopener noreferrer">Contact page</a>
          )}
          {!l.ownerName && !tel && !l.emails.length && !l.contactPage && <span className="meta">No contact found</span>}
        </div>
      </div>

      <div>
        <div className="sec-title">What they need</div>
        {SERVICE_ORDER.filter((s) => l.services.includes(s)).map((s) => (
          <div key={s} className={`need ${s}`}>
            <b>{SERVICE_LABELS[s]}</b>
            <ul>
              {l.tags[s].map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        ))}
        {l.services.length === 0 && <p className="meta">No gaps flagged.</p>}
      </div>

      {l.signals.length > 0 && (
        <div className="info">
          <span className="kicker">Worth knowing</span>
          {l.signals.map((s, i) => (
            <span key={s}>
              {i > 0 && <br />}
              {s}
            </span>
          ))}
        </div>
      )}
      {l.complaints.length > 0 && (
        <div className="info">
          <span className="kicker">From their reviews</span>
          {l.complaints.map((c, i) => (
            <span key={c}>
              {i > 0 && (
                <>
                  <br />
                  <br />
                </>
              )}
              “{c}”
            </span>
          ))}
        </div>
      )}
    </>
  );
}
