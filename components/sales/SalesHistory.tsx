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
import { BRANCH_TAG, classifyTouch, outcomeByKey, type LatestTouch, type OutcomeKey } from "@/lib/sales/outcomes";
import { ownedByOther } from "@/lib/leads/list";
import { SECTIONS, sectionsFor, summarizeTouches, type SectionKey, type TouchSummary } from "@/lib/sales/sections";
import { logOutcome, setNextAction } from "@/lib/sales/log";
import { linkedinPeopleSearch } from "@/lib/sales/owner";
import { useOutcomeToast } from "@/components/sales/OutcomeToast";
import { useSalesFlags } from "@/components/sales/SalesFlags";
import Dropdown from "@/components/lead-finder/Dropdown";
import BusinessDetail from "@/components/sales/BusinessDetail";
import { LatestOutcome } from "@/components/sales/OutcomeChips";
import UnmatchedMeetings from "@/components/sales/UnmatchedMeetings";
import { runsOnText } from "@/lib/lead-finder/software";

// Leads > History > Businesses: every business record (all sources: Lead
// Finder, personal network, Etsy, manual, referral, ...; one per company,
// its projects linked by projects.lead_id), split into sections
// (lib/sales/sections.ts) shown as tabs with counts. Mine / All (assigned
// to me) applies to every section, with search, branch and dates (by the
// latest outcome). Default section: Follow up today if it has rows, else
// In progress. The Sales nav badge links here with ?due=1.

type Row = {
  lead: SalesLeadRow;
  latest: LatestTouch | null;
  summary: TouchSummary;
  isClient: boolean;
  hasProject: boolean;
  sections: SectionKey[];
};

const PAGE = 1000;
// Projects at these stages count as clients (the Clients section).
const CLIENT_STAGES = ["Signed", "In Progress", "Complete", "Subscriber"];

function whenOf(r: Row) {
  return r.latest?.touched_at ?? r.lead.created_at;
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
  initialDue,
  onSelect,
}: {
  me: TeamMember | null;
  members: TeamMember[];
  initialLeadId: string | null;
  // ?due=1: start on Follow-ups due, Mine.
  initialDue: boolean;
  onSelect: (leadId: string | null) => void;
}) {
  const toast = useOutcomeToast();
  const flags = useSalesFlags();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialLeadId);
  // null until rows load: then Follow up today if it has rows, else In progress.
  const [section, setSection] = useState<SectionKey | null>(initialDue ? "follow_up" : null);
  const [who, setWho] = useState<"mine" | "all">("mine");
  const [followFor, setFollowFor] = useState<string | null>(null); // "Set follow-up" open on this row
  const [rowMsg, setRowMsg] = useState<{ id: string; text: string } | null>(null);
  const [branch, setBranch] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const detailRef = useRef<HTMLElement>(null);
  const memberName = useCallback((id: string | null) => members.find((m) => m.id === id)?.name ?? "Unknown", [members]);

  const load = useCallback(async () => {
    setError(null);
    const leads: SalesLeadRow[] = [];
    for (let p = 0; ; p += PAGE) {
      const { data, error: e } = await supabase
        .from("leads")
        .select(LEAD_LIST_COLUMNS + ", scan_tags")
        .order("created_at", { ascending: false })
        .range(p, p + PAGE - 1);
      if (e) return setError(e.message);
      leads.push(...((data ?? []) as unknown as SalesLeadRow[]));
      if ((data ?? []).length < PAGE) break;
    }
    // Every touch per business, newest first (timeline events included;
    // summarizeTouches skips the ones that aren't outcomes).
    const touches = new Map<string, LatestTouch[]>();
    for (let p = 0; ; p += PAGE) {
      const { data, error: e } = await supabase
        .from("lead_touches")
        .select("lead_id, channel, direction, outcome, summary, touched_by, touched_at, details, event")
        .order("touched_at", { ascending: false })
        .range(p, p + PAGE - 1);
      if (e) return setError(e.message);
      (data ?? []).forEach((t) => {
        if (!touches.has(t.lead_id)) touches.set(t.lead_id, []);
        touches.get(t.lead_id)!.push({
          channel: t.channel,
          direction: t.direction,
          outcome: t.outcome,
          summary: t.summary,
          touched_by: t.touched_by,
          touched_at: t.touched_at,
          details: t.details ?? null,
          event: t.event ?? null,
        });
      });
      if ((data ?? []).length < PAGE) break;
    }
    // The company's projects (projects.lead_id): in the pipeline = any stage
    // but Lost (Moved to project); a client = Signed and later (Clients).
    const { data: projects } = await supabase.from("projects").select("lead_id, stage").not("lead_id", "is", null);
    const active = new Set<string>();
    const clients = new Set<string>();
    (projects ?? []).forEach((p) => {
      if (p.stage !== "Lost") active.add(p.lead_id as string);
      if (CLIENT_STAGES.includes(p.stage)) clients.add(p.lead_id as string);
    });
    setRows(
      leads.map((lead) => {
        const summary = summarizeTouches(touches.get(lead.id) ?? []);
        const isClient = clients.has(lead.id);
        const hasProject = active.has(lead.id) || (!!lead.project_id && !(projects ?? []).some((p) => p.lead_id === lead.id));
        return {
          lead,
          latest: summary.latest,
          summary,
          isClient,
          hasProject,
          sections: sectionsFor({ summary, hasProject, nextActionAt: lead.next_action_at, isClient }),
        };
      })
    );
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const needle = q.trim().toLowerCase();
  // Mine / All, branch, dates, search: apply to every section and its count.
  const base = useMemo(
    () =>
      (rows ?? [])
        .filter((r) => who === "all" || r.lead.owner === me?.id)
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
        ),
    [rows, who, branch, from, to, needle, me?.id]
  );
  const counts = useMemo(() => {
    const c = {} as Record<SectionKey, number>;
    SECTIONS.forEach(([k]) => (c[k] = base.filter((r) => r.sections.includes(k)).length));
    return c;
  }, [base]);
  // Default section once rows are in.
  useEffect(() => {
    if (rows && section === null) setSection(counts.follow_up > 0 ? "follow_up" : "in_progress");
  }, [rows, section, counts.follow_up]);
  const tab: SectionKey = section ?? "follow_up";
  const at = (r: Row) => r.lead.next_action_at ?? "";
  const visible = useMemo(
    () =>
      base
        .filter((r) => r.sections.includes(tab))
        .sort((a, b) =>
          tab === "follow_up" || tab === "not_now"
            ? at(a).localeCompare(at(b))
            : tab === "reach_owner"
              ? (b.lead.priority_score ?? 0) - (a.lead.priority_score ?? 0)
              : whenOf(b).localeCompare(whenOf(a))
        ),
    [base, tab]
  );

  // ---- Row actions (No next step, Reach the owner) ----
  const followLabel = (r: Row) =>
    r.latest?.channel === "email" ? "Follow up: email" : r.latest?.channel?.startsWith("linkedin") ? "Follow up: LinkedIn" : "Follow up: call";
  async function setFollowUp(r: Row, when: Date) {
    if (Number.isNaN(when.getTime())) return;
    const err = await setNextAction(supabase, r.lead.id, followLabel(r), when.toISOString());
    setFollowFor(null);
    if (err) return setRowMsg({ id: r.lead.id, text: err });
    setRowMsg(null);
    void load();
  }
  const daysFromNow = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    d.setHours(9, 0, 0, 0);
    return d;
  };
  async function quickLog(r: Row, key: OutcomeKey) {
    if (!me) return;
    const o = outcomeByKey(key);
    let res;
    try {
      res = await logOutcome(
        supabase,
        me.id,
        [{ key: r.lead.id, place: placeFromLead(r.lead), searchType: r.lead.industry, existing: resultFromLead(r.lead, r.latest).existing }],
        o,
        r.lead.source_detail ?? ""
      );
    } catch (e) {
      return setRowMsg({ id: r.lead.id, text: (e as Error).message || "Could not save." });
    }
    if (res.failed.length) return setRowMsg({ id: r.lead.id, text: res.failed[0].reason });
    toast.show({
      text: `${o.label} saved for ${r.lead.company ?? r.lead.name}.`,
      saved: res.saved,
      onUndone: () => void load(),
      onNote: () => void load(),
    });
    void load();
  }

  const selectedRow = (rows ?? []).find((r) => r.lead.id === selectedId) ?? null;
  const selected = selectedRow ? resultFromLead(selectedRow.lead, selectedRow.latest) : null;

  function open(id: string) {
    setSelectedId(id);
    onSelect(id);
    if (window.innerWidth < 960) detailRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  // A change from the side preview (outcome, note, owner name, next action,
  // moved, undo). null: the record was deleted by Undo.
  const [savedTick, setSavedTick] = useState(0);
  function applySaved(id: string, ex: ExistingLead | null) {
    setSavedTick((n) => n + 1);
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
                    owner_email: ex.owner_email,
                    owner_phone: ex.owner_phone,
                    owner: ex.owner,
                    contact_linkedin: ex.contact_linkedin,
                    company_linkedin: ex.company_linkedin,
                  },
                  latest: ex.last_touch,
                  summary: r.summary,
                  isClient: r.isClient,
                  hasProject: r.hasProject,
                  sections: r.sections,
                }
              : r
          )
    );
  }
  // Sections depend on every touch: refresh quietly after a change.
  useEffect(() => {
    if (!rows) return;
    const t = setTimeout(() => void load(), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedTick]);
  function applyWebScore(id: string, w: WebScoreCache) {
    setRows((prev) =>
      (prev ?? []).map((r) => (r.lead.id === id ? { ...r, lead: { ...r.lead, scan_tags: { ...(r.lead.scan_tags ?? {}), webScore: w } } } : r))
    );
  }

  function exportCSV() {
    if (!visible.length) return;
    const headers = ["Business", "Business Owner / Contact", "Contact Title", "Assigned To", "Latest Outcome", "Outcome By", "Outcome Date", "Outcome Note", "Branches", "Priority", "Website Score", "Need Score", "Runs On", "Next Action", "Next Action Date", "Business Phone", "Business Email", "Owner Phone", "Owner Email", "Business Owner LinkedIn", "Company LinkedIn", "Instagram", "Facebook", "TikTok", "YouTube", "Website", "Address", "Google Maps Link"];
    const out = visible.map((r) => {
      const l = r.lead;
      const t = r.latest;
      const label = r.hasProject ? "Moved to Interested" : t ? classifyTouch(t).label : "";
      const place = placeFromLead(l);
      return [l.company ?? l.name, ownerNameOf(place, { ...resultFromLead(l, t).existing! }) ?? "", l.title && l.title !== "Possible owner" ? l.title : "", l.owner ? memberName(l.owner) : "", label, t ? memberName(t.touched_by) : "", t ? t.touched_at.slice(0, 10) : "", t?.summary ?? "",
        (l.branch_fit ?? []).join("; "), l.priority_score ?? "", websiteScore(place).score, l.lead_score ?? "", runsOnText(place.tech), l.next_action ?? "", l.next_action_at?.slice(0, 10) ?? "", l.phone ?? "", l.email ?? "", l.owner_phone ?? "", l.owner_email ?? "",
        l.contact_linkedin ?? "", l.company_linkedin ?? place.socialLinks?.LinkedIn ?? "",
        place.socialLinks?.Instagram ?? "", place.socialLinks?.Facebook ?? "", place.socialLinks?.TikTok ?? "", place.socialLinks?.YouTube ?? "",
        l.website ?? "", l.address ?? "", l.maps_url ?? ""];
    });
    const csv = [headers, ...out].map((r) => r.map((c) => '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"').join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `fullylaunched-leads-history-${new Date().toISOString().slice(0, 10)}.csv`;
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
              <div className="modes" role="tablist" aria-label="Mine or all">
                {(["mine", "all"] as const).map((k) => (
                  <button key={k} type="button" role="tab" aria-selected={who === k} onClick={() => setWho(k)}>
                    {k === "mine" ? "Mine" : "All"}
                  </button>
                ))}
              </div>
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

          <div className="toolbar">
            <div className="tabs sections" role="tablist" aria-label="Sections">
              {SECTIONS.map(([k, label]) => (
                <button key={k} type="button" role="tab" className="tab" aria-selected={tab === k} onClick={() => setSection(k)}>
                  {label} <span className="n">{counts[k]}</span>
                </button>
              ))}
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
                          {r.isClient && <span className="badge-mkt" style={{ marginLeft: 0 }}>Client</span>}
                          {l.owner && l.owner !== me?.id && (
                            <span className="badge-owned">Owned by {memberName(l.owner)}</span>
                          )}
                          {tab === "reach_owner" && (
                            <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                              <div className="staff-no">
                                Front desk said no
                                {r.summary.gatekeeper?.name
                                  ? ` · ${r.summary.gatekeeper.name}${r.summary.gatekeeper.role ? ` (${r.summary.gatekeeper.role})` : ""}`
                                  : ""}{" "}
                                · owner not reached
                              </div>
                              <a className="btn-mini" href={linkedinPeopleSearch(l.contact_name, l.company ?? l.name)} target="_blank" rel="noopener noreferrer">
                                Find on LinkedIn
                              </a>
                              {!ownedByOther(l, me) && (
                                <>
                                  <button type="button" className="btn-mini" disabled={!me} onClick={() => void quickLog(r, "connection_sent")}>Connection sent</button>
                                  <button type="button" className="btn-mini" disabled={!me} onClick={() => void quickLog(r, "visited")}>Visited</button>
                                </>
                              )}
                              {flags.apollo && (
                                <button type="button" className="btn-mini" onClick={() => open(l.id)}>Find owner contact</button>
                              )}
                            </div>
                          )}
                          {tab === "no_next_step" && !ownedByOther(l, me) && (
                            <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                              {followFor === l.id ? (
                                <>
                                  <button type="button" className="btn-mini" onClick={() => void setFollowUp(r, daysFromNow(1))}>Tomorrow</button>
                                  <button type="button" className="btn-mini" onClick={() => void setFollowUp(r, daysFromNow(3))}>In 3 days</button>
                                  <button type="button" className="btn-mini" onClick={() => void setFollowUp(r, daysFromNow(7))}>Next week</button>
                                  <input className="field" type="date" aria-label="Follow-up date" style={{ height: 30, width: "auto" }}
                                    min={new Date().toISOString().slice(0, 10)}
                                    onChange={(e) => e.target.value && void setFollowUp(r, new Date(e.target.value + "T09:00:00"))} />
                                  <button type="button" className="linkbtn" onClick={() => setFollowFor(null)}>Cancel</button>
                                </>
                              ) : (
                                <button type="button" className="btn-mini" onClick={() => setFollowFor(l.id)}>Set follow-up</button>
                              )}
                            </div>
                          )}
                          {rowMsg?.id === l.id && <div className="bad-text" style={{ fontSize: 12 }}>{rowMsg.text}</div>}
                        </td>
                        <td>
                          {r.latest || r.hasProject ? (
                            <LatestOutcome
                              existing={{
                                id: l.id, company: l.company, contact_name: l.contact_name, title: l.title, email: l.email, phone: l.phone, owner_email: l.owner_email, owner_phone: l.owner_phone, contact_linkedin: l.contact_linkedin, company_linkedin: l.company_linkedin, status: l.status, owner: l.owner, project_id: r.hasProject ? l.project_id : null,
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
                        {rows.length ? "Nothing in this section." : "Nothing yet. Businesses from Find, projects and imports show up here."}
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
                {selectedId && rows ? "That business isn't in Leads." : "Select a business to see its timeline and next steps."}
              </p>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
