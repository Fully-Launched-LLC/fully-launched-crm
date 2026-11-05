"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TeamMember } from "@/lib/types";
import type { ExistingLead, LeadFinderRun, RunResult, ScannedPlace, SearchParams, ServiceKey, SweepParams } from "@/lib/lead-finder/types";
import { SERVICE_LABELS, SERVICE_ORDER } from "@/lib/lead-finder/sweep";
import { logOutcome } from "@/lib/sales/log";
import { classifyTouch, type Outcome } from "@/lib/sales/outcomes";
import Dropdown from "@/components/lead-finder/Dropdown";
import { ROCKET_IDLE_SRC } from "@/components/lead-finder/assets";
import LocalDateTime from "@/components/LocalDateTime";
import BusinessDetail from "@/components/sales/BusinessDetail";
import { LatestOutcome, OutcomeChips, isHiddenOutcome } from "@/components/sales/OutcomeChips";

// Matteo's mission control (Sales > Find results): stats, tabs, service
// filter, bulk bar, table, sticky detail panel. Every row has one-click
// outcomes; logging one on a business with no record saves it first
// (lib/sales/log.ts). Businesses already worked show their latest outcome;
// Not interested / Bad fit are hidden until "Show already contacted".

export type Svc = Record<ServiceKey | "servicetitan", boolean>;
type Sort = "priority" | "score" | "rating" | "reviews" | "name";

const GAP_LABELS: Record<ServiceKey, string> = { website: "Website", social: "Social", ecom: "E-commerce", ai: "AI" };
const STALE_MS = 7 * 24 * 3600 * 1000;

const noSite = (l: ScannedPlace) => !l.website || l.websiteStatus === "Social page only" || l.websiteStatus === "Broken";
const hasContact = (l: ScannedPlace) => (l.emails && l.emails.length > 0) || !!l.ownerName;
const fmtRating = (r: number | "N/A") => (typeof r === "number" ? r.toFixed(1) : r);
const scoreClass = (s: number) => (s >= 60 ? "s-hi" : s >= 35 ? "s-mid" : "s-lo");
const money = (n: number) => "$" + n.toFixed(2);

export default function MissionControl({
  run,
  results,
  members,
  me,
  svc,
  onToggleSvc,
  onNewSearch,
  onRerun,
}: {
  run: LeadFinderRun;
  results: RunResult[];
  members: TeamMember[];
  me: TeamMember | null;
  svc: Svc;
  onToggleSvc: (k: keyof Svc) => void;
  onNewSearch: () => void;
  // null: this user can't start this kind of search (sweeps: Admin/Manager).
  onRerun: (() => void) | null;
}) {
  const isSweep = run.kind === "sweep";
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("priority");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showContacted, setShowContacted] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  // Records created or touched here, until the run's results reload.
  const [overrides, setOverrides] = useState<Record<string, ExistingLead>>({});
  const detailRef = useRef<HTMLElement>(null);
  const sourceDetail = (run.params as SearchParams | SweepParams).label;

  useEffect(() => setOverrides({}), [results]);

  const withOverrides = useMemo(
    () => results.map((r) => (overrides[r.google_place_id] ? { ...r, existing: overrides[r.google_place_id] } : r)),
    [results, overrides]
  );

  // His tabs. "Not contacted" = no outcome logged yet.
  const TABS: [string, string, (r: RunResult) => boolean][] = [
    ["all", "All", () => true],
    ["nosite", "No real website", (r) => noSite(r.place)],
    ["hot", "Hot (60+)", (r) => r.place.score >= 60],
    ["reach", "Has contact", (r) => hasContact(r.place)],
    ["fresh", "Not contacted", (r) => !r.existing?.last_touch && !r.existing?.project_id],
  ];

  // His service filter: ServiceTitan only, or any selected gap.
  const wanted = SERVICE_ORDER.filter((s) => svc[s]);
  const current = useMemo(
    () =>
      svc.servicetitan
        ? withOverrides.filter((r) => r.place.usesServiceTitan)
        : withOverrides.filter((r) => r.place.services.some((s) => wanted.includes(s))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [withOverrides, svc]
  );
  const hiddenCount = current.filter((r) => isHiddenOutcome(r.existing)).length;
  const pool = showContacted ? current : current.filter((r) => !isHiddenOutcome(r.existing));

  const test = (TABS.find((t) => t[0] === tab) ?? TABS[0])[2];
  const needle = q.trim().toLowerCase();
  const num = (v: number | "N/A") => (typeof v === "number" ? v : 0);
  const visible = pool
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
    withOverrides.find((r) => r.google_place_id === selectedId) ?? (visible.length ? visible[0] : null);

  const checkedRows = current.filter((r) => checked.has(r.google_place_id));
  const allChecked = visible.length > 0 && visible.every((r) => checked.has(r.google_place_id));

  const memberName = (id: string | null) => members.find((m) => m.id === id)?.name ?? "Unknown";

  // ---- Writes ----
  function applySaved(saved: { key: string; existing: ExistingLead }[]) {
    setOverrides((prev) => {
      const next = { ...prev };
      saved.forEach((s) => (next[s.key] = s.existing));
      return next;
    });
  }

  async function log(rows: RunResult[], o: Outcome, note: string): Promise<string | null> {
    if (!me) return "You need a team member profile to log outcomes.";
    setMessage(null);
    let res;
    try {
      res = await logOutcome(
        createClient(),
        me.id,
        rows.map((r) => ({ key: r.google_place_id, place: r.place, searchType: r.search_type, existing: r.existing })),
        o,
        note,
        sourceDetail
      );
    } catch (e) {
      return (e as Error).message || "Could not save.";
    }
    applySaved(res.saved);
    if (rows.length === 1) return res.failed[0]?.reason ?? null;
    if (res.failed.length) {
      setMessage({ tone: "error", text: `Logged ${o.label} on ${res.saved.length}. ${res.failed.length} not saved: ${res.failed[0].reason}` });
    } else {
      setMessage({ tone: "ok", text: `Logged ${o.label} on ${res.saved.length}.` });
      setChecked(new Set());
    }
    return null;
  }

  // ---- CSV (his columns, plus Priority and the latest outcome) ----
  function exportCSV(onlyChecked: boolean) {
    const list = onlyChecked ? checkedRows : visible;
    if (!list.length) return;
    const headers = ["Priority", "Score", "Business Name", "Category", "Address", "Phone", "Google Rating", "Reviews", "Website", "Website Status",
      "Possible Owner", "Emails", "Contact Page", "Social Links Found", "Online Store Found", "Marketplaces", "Software Used", "Uses ServiceTitan", "Runs Ads",
      "Other Signals", "Services Needed", "Website Reasons", "Social Reasons", "E-commerce Reasons", "AI Reasons",
      "Latest Outcome", "Outcome By", "Outcome Date", "Outcome Note", "Google Maps Link"];
    const rows = list.map((r) => {
      const l = r.place;
      const t = r.existing?.last_touch ?? null;
      const outcome = r.existing?.project_id ? "Moved to Interested" : t ? classifyTouch(t).label : "";
      return [l.priority, l.score, l.name, l.category, l.address, l.phone, l.rating, l.reviews, l.website, l.websiteStatus,
        l.ownerName || "", (l.emails || []).join("; "), l.contactPage || "", (l.socials || []).join("; "), l.store || "", (l.marketplaces || []).join("; "), (l.tech || []).join("; "),
        l.usesServiceTitan ? "Yes" : "", (l.ads || []).join("; "), (l.signals || []).join("; "), l.services.map((s) => GAP_LABELS[s]).join("; "),
        l.tags.website.join("; "), l.tags.social.join("; "), l.tags.ecom.join("; "), l.tags.ai.join("; "),
        outcome, t ? memberName(t.touched_by) : "", t ? t.touched_at.slice(0, 10) : "", t?.summary ?? "", l.mapsUrl];
    });
    const csv = [headers, ...rows].map((r) => r.map((c) => '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"').join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    const slug = (t: string) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const p = run.params as SearchParams | SweepParams;
    const place = [p.city, p.zip, p.state].map(slug).filter(Boolean).join("-");
    a.href = url;
    a.download =
      [svc.servicetitan ? "SERVICETITAN-sales" : "fullylaunched-sales", place, new Date().toISOString().slice(0, 10)].filter(Boolean).join("-") + ".csv";
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
  const contacted = current.filter((r) => r.existing?.last_touch || r.existing?.project_id).length;
  const resultsAt = run.finished_at ?? run.updated_at;
  const stale = Date.now() - new Date(resultsAt).getTime() > STALE_MS;
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
              {isSweep ? "Area sweep" : "Quick search"} by {memberName(run.run_by)} · est. {money(Number(run.est_cost ?? 0))}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <span className="mc-when">
            Results from <LocalDateTime iso={resultsAt} /> · {run.params.label}
            {stale && onRerun && (
              <>
                {" "}
                <button type="button" className="linkbtn" onClick={onRerun}>
                  Re-run for fresh data
                </button>
              </>
            )}
          </span>
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
        {stat("Matches", current.length, "var(--gold)")}
        {stat("No real website", ns, "var(--web)")}
        {stat("Hot (60+)", hot, "var(--warn)")}
        {stat("Owner or email found", reach, "var(--good)")}
        {stat("Already contacted", contacted, "var(--ai)")}
      </section>

      <div className="work">
        <section className="panel list" aria-label="Businesses">
          <div className="toolbar">
            <div className="tabs" role="tablist" aria-label="Filter businesses">
              {TABS.map(([key, text, t]) => (
                <button key={key} type="button" role="tab" className="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
                  {text} <span className="n">{pool.filter(t).length}</span>
                </button>
              ))}
            </div>
            <div className="tools">
              <label className="sr" htmlFor="lf-q">Search businesses</label>
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
            <label className="toggle">
              <input type="checkbox" className="chk" checked={showContacted} onChange={(e) => setShowContacted(e.target.checked)} />
              Show already contacted ({hiddenCount})
            </label>
          </div>

          {checked.size > 0 && (
            <div className="bulk">
              <b>{checked.size} selected</b>
              <div className="bulk-out">
                <OutcomeChips disabled={!me} onSave={(o, note) => log(checkedRows, o, note)} />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
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
                      aria-label="Select all shown businesses"
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
                  <th title="Matteo's score: how many gaps, and how big">Score</th>
                  <th>Business</th>
                  <th>Rating</th>
                  <th>Gaps we can fill</th>
                  <th>Log outcome</th>
                </tr>
              </thead>
              <tbody>
                {visible.length ? (
                  visible.map((r) => {
                    const l = r.place;
                    const city = (l.address || "").split(",").slice(-3, -1).join(",").trim();
                    const isSel = selected?.google_place_id === r.google_place_id;
                    const touched = !!(r.existing?.last_touch || r.existing?.project_id);
                    return (
                      <tr
                        key={r.google_place_id}
                        className={`lead${isSel ? " sel" : ""}${touched ? " touched" : ""}`}
                        onClick={() => open(r.google_place_id)}
                      >
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
                          <LatestOutcome existing={r.existing} memberName={memberName} />
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
                        <td className="oc-cell">
                          <OutcomeChips disabled={!me} onSave={(o, note) => log([r], o, note)} />
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty-list">
                        {current.length
                          ? hiddenCount && !showContacted
                            ? "Nothing new in this view. Turn on Show already contacted to see the rest."
                            : "No businesses in this view."
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
            Showing {visible.length} of {current.length} businesses · outcomes are shared with the whole team (see History)
          </div>
        </section>

        <aside ref={detailRef} className="panel detail" aria-label="Business details">
          {selected ? (
            <BusinessDetail
              key={selected.google_place_id}
              r={selected}
              me={me}
              members={members}
              sourceDetail={sourceDetail}
              onSaved={(ex) => applySaved([{ key: selected.google_place_id, existing: ex }])}
            />
          ) : (
            <>
              <div className="kicker">Business</div>
              <p className="meta">Select a business to see everything we found.</p>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
