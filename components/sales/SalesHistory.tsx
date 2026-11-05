"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TeamMember } from "@/lib/types";
import type { ExistingLead, WebScoreCache } from "@/lib/lead-finder/types";
import { PRIORITY_TIP, WEBSITE_SCORE_TIP, websiteScore } from "@/lib/lead-finder/websiteScore";
import { ownerNameOf } from "@/lib/sales/owner";
import { BRANCHES, type Branch } from "@/lib/theme";
import { LEAD_LIST_COLUMNS } from "@/lib/leads/list";
import { placeFromLead, resultFromLead, type SalesLeadRow } from "@/lib/sales/fromLead";
import { BRANCH_TAG, OUTCOMES, SALES_SOURCES, classifyTouch, type DisplayKey, type LatestTouch } from "@/lib/sales/outcomes";
import Dropdown from "@/components/lead-finder/Dropdown";
import BusinessDetail from "@/components/sales/BusinessDetail";
import { LatestOutcome } from "@/components/sales/OutcomeChips";
import UnmatchedMeetings from "@/components/sales/UnmatchedMeetings";

// Sales > History: every Sales business (leads with source in
// SALES_SOURCES; legacy outreach never shows), latest outcome first.
// "Person" and the date range go by the latest outcome (who logged it,
// when); a business with no outcome yet goes by who found it and when.

type Row = { lead: SalesLeadRow; latest: LatestTouch | null };

const PAGE = 1000;

function personOf(r: Row) {
  return r.latest?.touched_by ?? r.lead.found_by;
}
function whenOf(r: Row) {
  return r.latest?.touched_at ?? r.lead.created_at;
}
function outcomeOf(r: Row): DisplayKey | "moved" | "none" {
  if (r.lead.project_id) return "moved";
  if (!r.latest) return "none";
  return classifyTouch(r.latest).key;
}
// YYYY-MM-DD of an ISO time in the viewer's timezone (date inputs are local).
function localDay(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function SalesHistory({
  me,
  members,
  initialLeadId,
  onSelect,
}: {
  me: TeamMember | null;
  members: TeamMember[];
  initialLeadId: string | null;
  onSelect: (leadId: string | null) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialLeadId);
  const [outcome, setOutcome] = useState("all");
  const [person, setPerson] = useState("all");
  const [branch, setBranch] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const detailRef = useRef<HTMLElement>(null);
  const memberName = useCallback((id: string | null) => members.find((m) => m.id === id)?.name ?? "Unknown", [members]);

  const load = useCallback(async () => {
    setError(null);
    const sources = SALES_SOURCES as unknown as string[];
    const leads: SalesLeadRow[] = [];
    for (let p = 0; ; p += PAGE) {
      const { data, error: e } = await supabase
        .from("leads")
        .select(LEAD_LIST_COLUMNS + ", scan_tags")
        .in("source", sources)
        .order("created_at", { ascending: false })
        .range(p, p + PAGE - 1);
      if (e) return setError(e.message);
      leads.push(...((data ?? []) as unknown as SalesLeadRow[]));
      if ((data ?? []).length < PAGE) break;
    }
    // Latest touch per Sales business (newest first, first one wins).
    const latest = new Map<string, LatestTouch>();
    for (let p = 0; ; p += PAGE) {
      const { data, error: e } = await supabase
        .from("lead_touches")
        .select("lead_id, channel, direction, outcome, summary, touched_by, touched_at, leads!inner(source)")
        .in("leads.source", sources)
        .order("touched_at", { ascending: false })
        .range(p, p + PAGE - 1);
      if (e) return setError(e.message);
      (data ?? []).forEach((t) => {
        if (!latest.has(t.lead_id))
          latest.set(t.lead_id, {
            channel: t.channel,
            direction: t.direction,
            outcome: t.outcome,
            summary: t.summary,
            touched_by: t.touched_by,
            touched_at: t.touched_at,
          });
      });
      if ((data ?? []).length < PAGE) break;
    }
    setRows(leads.map((lead) => ({ lead, latest: latest.get(lead.id) ?? null })));
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const needle = q.trim().toLowerCase();
  const visible = useMemo(
    () =>
      (rows ?? [])
        .filter((r) => outcome === "all" || outcomeOf(r) === outcome)
        .filter((r) => person === "all" || personOf(r) === (person === "mine" ? me?.id : person))
        .filter((r) => branch === "all" || (r.lead.branch_fit ?? []).includes(branch as Branch))
        .filter((r) => {
          if (!from && !to) return true;
          const d = localDay(whenOf(r));
          return (!from || d >= from) && (!to || d <= to);
        })
        .filter(
          (r) =>
            !needle ||
            [r.lead.company, r.lead.name, r.lead.address, r.lead.phone, r.lead.city]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(needle))
        )
        .sort((a, b) => whenOf(b).localeCompare(whenOf(a))),
    [rows, outcome, person, branch, from, to, needle, me?.id]
  );

  const selectedRow = (rows ?? []).find((r) => r.lead.id === selectedId) ?? null;
  const selected = selectedRow ? resultFromLead(selectedRow.lead, selectedRow.latest) : null;

  function open(id: string) {
    setSelectedId(id);
    onSelect(id);
    if (window.innerWidth < 960) detailRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  // A change from the side preview (outcome, note, owner name, next action,
  // moved, undo). null: the record was deleted by Undo.
  function applySaved(id: string, ex: ExistingLead | null) {
    setRows((prev) =>
      ex === null
        ? (prev ?? []).filter((r) => r.lead.id !== id)
        : (prev ?? []).map((r) =>
            r.lead.id === ex.id
              ? {
                  lead: {
                    ...r.lead,
                    status: ex.status as SalesLeadRow["status"],
                    project_id: ex.project_id,
                    next_action: ex.next_action,
                    next_action_at: ex.next_action_at,
                    contact_name: ex.contact_name,
                    title: ex.title,
                    email: ex.email,
                    phone: ex.phone,
                    contact_linkedin: ex.contact_linkedin,
                    company_linkedin: ex.company_linkedin,
                  },
                  latest: ex.last_touch,
                }
              : r
          )
    );
  }
  function applyWebScore(id: string, w: WebScoreCache) {
    setRows((prev) =>
      (prev ?? []).map((r) => (r.lead.id === id ? { ...r, lead: { ...r.lead, scan_tags: { ...(r.lead.scan_tags ?? {}), webScore: w } } } : r))
    );
  }

  function exportCSV() {
    if (!visible.length) return;
    const headers = ["Business", "Business Owner / Contact", "Contact Title", "Assigned To", "Latest Outcome", "Outcome By", "Outcome Date", "Outcome Note", "Branches", "Priority", "Website Score", "Need Score", "Next Action", "Next Action Date", "Phone", "Email", "Business Owner LinkedIn", "Company LinkedIn", "Instagram", "Facebook", "TikTok", "YouTube", "Website", "Address", "Google Maps Link"];
    const out = visible.map((r) => {
      const l = r.lead;
      const t = r.latest;
      const label = l.project_id ? "Moved to Interested" : t ? classifyTouch(t).label : "";
      const place = placeFromLead(l);
      return [l.company ?? l.name, ownerNameOf(place, { ...resultFromLead(l, t).existing! }) ?? "", l.title && l.title !== "Possible owner" ? l.title : "", l.owner ? memberName(l.owner) : "", label, t ? memberName(t.touched_by) : "", t ? t.touched_at.slice(0, 10) : "", t?.summary ?? "",
        (l.branch_fit ?? []).join("; "), l.priority_score ?? "", websiteScore(place).score, l.lead_score ?? "", l.next_action ?? "", l.next_action_at?.slice(0, 10) ?? "", l.phone ?? "", l.email ?? "",
        l.contact_linkedin ?? "", l.company_linkedin ?? place.socialLinks?.LinkedIn ?? "",
        place.socialLinks?.Instagram ?? "", place.socialLinks?.Facebook ?? "", place.socialLinks?.TikTok ?? "", place.socialLinks?.YouTube ?? "",
        l.website ?? "", l.address ?? "", l.maps_url ?? ""];
    });
    const csv = [headers, ...out].map((r) => r.map((c) => '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"').join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `fullylaunched-sales-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const now = Date.now();

  return (
    <main className="mc">
      <div className="panel mission-bar">
        <div>
          <div className="kicker">History</div>
          <h2>Every business the team has worked</h2>
          <div className="meta">Latest outcome first. Click a business for its timeline, audit and next steps.</div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button type="button" className="btn" onClick={() => void load()}>
            Refresh
          </button>
          <button type="button" className="btn" onClick={exportCSV} disabled={!visible.length}>
            Export CSV
          </button>
        </div>
      </div>

      {(me?.role === "Admin" || me?.role === "Manager") && (
        <UnmatchedMeetings
          members={members}
          businesses={(rows ?? []).map((r) => ({ id: r.lead.id, name: r.lead.company ?? r.lead.name, city: r.lead.city }))}
          onLinked={() => void load()}
        />
      )}

      <div className="work">
        <section className="panel list" aria-label="History">
          <div className="toolbar">
            <div className="tools hist-filters">
              <label className="sr" htmlFor="hist-q">Search businesses</label>
              <input className="field" id="hist-q" type="search" placeholder="Search name, address, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
              <Dropdown
                label="Outcome"
                value={outcome}
                onChange={setOutcome}
                options={[
                  { value: "all", label: "Outcome: all" },
                  ...OUTCOMES.map((o) => ({ value: o.key, label: o.label })),
                  { value: "talked", label: "Called (talked), older" },
                  { value: "bad_fit", label: "Bad fit, older" },
                  { value: "meeting", label: "Meeting held" },
                  { value: "moved", label: "Moved to Interested" },
                  { value: "none", label: "No outcome yet" },
                ]}
              />
              <Dropdown
                label="Person"
                value={person}
                onChange={setPerson}
                options={[
                  { value: "all", label: "Person: all" },
                  ...(me ? [{ value: "mine", label: "Mine" }] : []),
                  ...members.map((m) => ({ value: m.id, label: m.name })),
                ]}
              />
              <Dropdown
                label="Branch"
                value={branch}
                onChange={setBranch}
                options={[{ value: "all", label: "Branch: all" }, ...BRANCHES.map((b) => ({ value: b, label: b }))]}
              />
              <label className="date-f">
                <span>From</span>
                <input className="field" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="date-f">
                <span>To</span>
                <input className="field" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
          </div>

          {error && (
            <div className="bar-msg">
              <p role="alert" className="error">{error}</p>
            </div>
          )}

          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Business</th>
                  <th>Latest outcome</th>
                  <th>Branches</th>
                  <th title={PRIORITY_TIP}>Priority</th>
                  <th title={WEBSITE_SCORE_TIP}>Website score</th>
                  <th>Next action</th>
                </tr>
              </thead>
              <tbody>
                {rows === null ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="empty-list">Loading…</div>
                    </td>
                  </tr>
                ) : visible.length ? (
                  visible.map((r) => {
                    const l = r.lead;
                    const overdue = l.next_action_at && new Date(l.next_action_at).getTime() < now;
                    const ws = websiteScore(placeFromLead(l));
                    return (
                      <tr key={l.id} className={`lead${selectedId === l.id ? " sel" : ""}`} onClick={() => open(l.id)}>
                        <td>
                          <button type="button" className="name" onClick={(e) => { e.stopPropagation(); open(l.id); }}>
                            {l.company ?? l.name}
                          </button>
                          <div className="meta">{[l.category, l.city].filter(Boolean).join(" · ")}</div>
                        </td>
                        <td>
                          {r.latest || l.project_id ? (
                            <LatestOutcome
                              existing={{
                                id: l.id, company: l.company, contact_name: l.contact_name, title: l.title, email: l.email, phone: l.phone, contact_linkedin: l.contact_linkedin, company_linkedin: l.company_linkedin, status: l.status, owner: l.owner, project_id: l.project_id,
                                next_action: l.next_action, next_action_at: l.next_action_at, last_touch: r.latest, matched_on: "google_place_id",
                              }}
                              memberName={memberName}
                            />
                          ) : (
                            <span className="meta">No outcome yet</span>
                          )}
                        </td>
                        <td>
                          <div className="gaps">
                            {(l.branch_fit ?? []).map((b) => (
                              <span key={b} className={`gap g-${BRANCH_TAG[b] ?? "website"}`}>{b}</span>
                            ))}
                          </div>
                        </td>
                        <td title={PRIORITY_TIP}>
                          <div className="prio">{l.priority_score ?? ""}</div>
                        </td>
                        <td title={WEBSITE_SCORE_TIP}>
                          <div className="prio">{ws.score}</div>
                          <div className="ws-kind">{ws.kind}</div>
                        </td>
                        <td>
                          {l.next_action || l.next_action_at ? (
                            <>
                              <div style={{ color: "var(--ink)" }}>{l.next_action}</div>
                              {l.next_action_at && (
                                <div className={`meta${overdue ? " overdue" : ""}`}>
                                  {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(l.next_action_at))}
                                  {overdue ? " · overdue" : ""}
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="meta">None</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6}>
                      <div className="empty-list">
                        {rows.length ? "No businesses match these filters." : "Nothing yet. Outcomes logged in Find show up here."}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="foot">
            Showing {visible.length} of {rows?.length ?? 0} businesses
          </div>
        </section>

        <aside ref={detailRef} className="panel detail" aria-label="Business details">
          {selected && selectedRow ? (
            <BusinessDetail
              key={selectedRow.lead.id}
              r={selected}
              me={me}
              members={members}
              sourceDetail={selectedRow.lead.source_detail ?? ""}
              onSaved={(ex) => applySaved(selectedRow.lead.id, ex)}
              onRestored={(ex) => applySaved(selectedRow.lead.id, ex)}
              onWebScore={(w) => applyWebScore(selectedRow.lead.id, w)}
            />
          ) : (
            <>
              <div className="kicker">Business</div>
              <p className="meta">
                {selectedId && rows ? "That business isn't in Sales." : "Select a business to see its timeline and next steps."}
              </p>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
