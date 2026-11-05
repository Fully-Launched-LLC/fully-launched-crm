"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import type { Lead, TeamMember } from "@/lib/types";
import type { ExistingLead, RunResult } from "@/lib/lead-finder/types";
import { SERVICE_LABELS, SERVICE_ORDER } from "@/lib/lead-finder/sweep";
import { previewQuery } from "@/lib/lead-finder/previewQuery";
import { canEditLead } from "@/lib/leads/list";
import { logOutcome } from "@/lib/sales/log";
import { OUTCOME_CLASS, classifyTouch, type LatestTouch, type Outcome } from "@/lib/sales/outcomes";
import { OutcomeChips, LatestOutcome } from "@/components/sales/OutcomeChips";
import ConvertDialog from "@/components/sales/ConvertDialog";
import LocalDateTime from "@/components/LocalDateTime";

// The detail panel for one business, used by Find (search results) and
// History: actions (call, maps, site, Preview site, audit), outcome buttons,
// latest outcome, next action, Move to Interested, the full touch timeline,
// and the scan findings.

const RLS_HINT = "Only the business's owner or an Admin/Manager can change it.";

const scoreClass = (s: number) => (s >= 60 ? "s-hi" : s >= 35 ? "s-mid" : "s-lo");

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Touch = LatestTouch & { id: string };

export default function BusinessDetail({
  r,
  me,
  members,
  sourceDetail,
  onSaved,
}: {
  r: RunResult;
  me: TeamMember | null;
  members: TeamMember[];
  sourceDetail: string;
  onSaved: (existing: ExistingLead) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const l = r.place;
  const ex = r.existing;
  const memberName = useCallback((id: string | null) => members.find((m) => m.id === id)?.name ?? "Unknown", [members]);
  const tel = l.phone && l.phone !== "No phone listed" ? l.phone.replace(/[^0-9+]/g, "") : "";
  const preview = "/api/lead-finder/preview?" + previewQuery({ ...l, type: r.search_type || l.category });
  // His audit page (app/lead-finder/audit). With a record id the result is
  // saved to it, and a saved audit reopens without a Google call.
  const audit =
    "/lead-finder/audit?" +
    new URLSearchParams({ place: l.id, type: r.search_type || l.category || "", ...(ex ? { lead: ex.id } : {}) }).toString();
  const canEdit = !!ex && canEditLead(ex, me);

  // ---- Timeline ----
  const [touches, setTouches] = useState<Touch[]>([]);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!ex?.id) {
      setTouches([]);
      return;
    }
    let live = true;
    void supabase
      .from("lead_touches")
      .select("id, channel, direction, outcome, summary, touched_by, touched_at")
      .eq("lead_id", ex.id)
      .order("touched_at", { ascending: false })
      .then(({ data }) => live && setTouches((data ?? []) as Touch[]));
    return () => {
      live = false;
    };
  }, [ex?.id, reload, supabase]);

  // ---- Next action ----
  const [nextText, setNextText] = useState(ex?.next_action ?? "");
  const [nextAt, setNextAt] = useState(toLocalInput(ex?.next_action_at ?? null));
  const [nextMsg, setNextMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  useEffect(() => {
    setNextText(ex?.next_action ?? "");
    setNextAt(toLocalInput(ex?.next_action_at ?? null));
    setNextMsg(null);
  }, [ex?.id, ex?.next_action, ex?.next_action_at]);

  async function saveNext() {
    if (!ex) return;
    const patch = { next_action: nextText.trim() || null, next_action_at: nextAt ? new Date(nextAt).toISOString() : null };
    const { data, error } = await supabase.from("leads").update(patch).eq("id", ex.id).select("id");
    if (error) return setNextMsg({ tone: "error", text: error.message });
    if (!data?.length) return setNextMsg({ tone: "error", text: `Not saved. ${RLS_HINT}` });
    setNextMsg({ tone: "ok", text: "Saved." });
    onSaved({ ...ex, ...patch });
  }

  // ---- Move to Interested ----
  const [convert, setConvert] = useState<{ lead: Lead; firstTouch: { channel: string; direction: string } | null } | null>(null);
  const [convertError, setConvertError] = useState<string | null>(null);

  async function openConvert(leadId: string) {
    setConvertError(null);
    const [{ data: lead, error }, { data: first }] = await Promise.all([
      supabase.from("leads").select("*").eq("id", leadId).single(),
      supabase.from("lead_touches").select("channel, direction").eq("lead_id", leadId).order("touched_at").limit(1),
    ]);
    if (error || !lead) return setConvertError(error?.message ?? "Could not load this business.");
    setConvert({ lead: lead as Lead, firstTouch: first?.[0] ?? null });
  }

  // ---- Outcomes ----
  async function save(o: Outcome, note: string): Promise<string | null> {
    if (!me) return "You need a team member profile to log outcomes.";
    let res;
    try {
      res = await logOutcome(supabase, me.id, [{ key: l.id, place: l, searchType: r.search_type, existing: ex }], o, note, sourceDetail);
    } catch (e) {
      return (e as Error).message || "Could not save.";
    }
    if (res.failed.length) return res.failed[0].reason;
    const saved = res.saved[0].existing;
    onSaved(saved);
    setReload((n) => n + 1);
    // Interested: offer Move to Interested right away (as the Leads drawer did).
    if (o.key === "interested" && !saved.project_id && canEditLead(saved, me)) void openConvert(saved.id);
    return null;
  }

  return (
    <>
      <div className="d-head">
        <div style={{ minWidth: 0 }}>
          <div className="kicker">Business</div>
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
            <small>score</small>
          </div>
        </div>
      </div>

      <div className="actions">
        {tel ? <a className="btn" href={`tel:${tel}`}>Call</a> : <button type="button" className="btn" disabled>No phone</button>}
        {l.mapsUrl ? (
          <a className="btn" href={l.mapsUrl} target="_blank" rel="noopener noreferrer">Google Maps</a>
        ) : (
          <button type="button" className="btn" disabled>No map link</button>
        )}
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
        <div className="sec-title">Log an outcome</div>
        <OutcomeChips big disabled={!me} onSave={save} />
        <div style={{ marginTop: 8 }}>
          {ex?.last_touch || ex?.project_id ? (
            <LatestOutcome existing={ex} memberName={memberName} />
          ) : (
            <p className="hint">No one has contacted this business yet.</p>
          )}
          {ex && <p className="hint" style={{ marginTop: 4 }}>Owner: {ex.owner ? memberName(ex.owner) : "Unassigned"}</p>}
        </div>
      </div>

      {ex && (
        <div>
          <div className="sec-title">Next action</div>
          <div className="next-form">
            <input
              className="field"
              aria-label="Next action"
              placeholder="Call back Tuesday…"
              value={nextText}
              disabled={!canEdit}
              onChange={(e) => setNextText(e.target.value)}
            />
            <input
              className="field"
              type="datetime-local"
              aria-label="Next action date"
              value={nextAt}
              disabled={!canEdit}
              onChange={(e) => setNextAt(e.target.value)}
            />
            <button type="button" className="btn" disabled={!canEdit} onClick={() => void saveNext()}>
              Save
            </button>
          </div>
          {!canEdit && <p className="hint" style={{ marginTop: 4 }}>{RLS_HINT}</p>}
          {nextMsg && <p className={`hint ${nextMsg.tone === "error" ? "bad-text" : ""}`} style={{ marginTop: 4 }}>{nextMsg.text}</p>}
        </div>
      )}

      {ex && (
        <div>
          {ex.project_id ? (
            <a className="btn" style={{ width: "100%" }} href={`/project/${ex.project_id}`}>
              Open project
            </a>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-gold"
                style={{ width: "100%", minHeight: 44 }}
                disabled={!canEdit || !me}
                onClick={() => void openConvert(ex.id)}
              >
                Move to Interested
              </button>
              {!canEdit && <p className="hint" style={{ marginTop: 4 }}>{RLS_HINT}</p>}
            </>
          )}
          {convertError && <p className="error" style={{ marginTop: 6 }}>{convertError}</p>}
        </div>
      )}

      {touches.length > 0 && (
        <div>
          <div className="sec-title">Timeline</div>
          <ul className="timeline">
            {touches.map((t) => {
              const c = classifyTouch(t);
              return (
                <li key={t.id}>
                  <span className={`st ${OUTCOME_CLASS[c.key ?? "other"]}`}>{c.label}</span>{" "}
                  <span className="hint">
                    {memberName(t.touched_by)} · <LocalDateTime iso={t.touched_at} />
                  </span>
                  {t.summary && <div className="latest-note">“{t.summary}”</div>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

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

      {convert &&
        me &&
        createPortal(
          <ConvertDialog
            lead={convert.lead}
            firstTouch={convert.firstTouch}
            members={members}
            me={me}
            onClose={() => setConvert(null)}
            onConverted={(projectId) => {
              setConvert(null);
              if (ex) onSaved({ ...ex, project_id: projectId, status: "converted" });
              setReload((n) => n + 1);
            }}
          />,
          document.body
        )}
    </>
  );
}
