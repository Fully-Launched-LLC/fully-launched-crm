"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import type { Lead, TeamMember } from "@/lib/types";
import type { ExistingLead, RunResult, WebScoreCache } from "@/lib/lead-finder/types";
import { SERVICE_LABELS, SERVICE_ORDER } from "@/lib/lead-finder/sweep";
import { previewQuery } from "@/lib/lead-finder/previewQuery";
import { apiFetch } from "@/lib/lead-finder/apiFetch";
import {
  PRIORITY_TIP,
  WEBSITE_SCORE_TIP,
  freshWebScore,
  hasRealSite,
  websiteScore,
} from "@/lib/lead-finder/websiteScore";
import { canEditLead } from "@/lib/leads/list";
import { logOutcome, saveBusinessContact, zeroRowsReason } from "@/lib/sales/log";
import {
  SCAN_TITLE,
  companyLinkedin,
  contactEmail,
  contactLabel,
  contactPhone,
  linkedinCompanySearch,
  linkedinPeopleSearch,
  ownerNameOf,
} from "@/lib/sales/owner";
import { SOCIAL_PLATFORMS } from "@/lib/lead-finder/types";
import { OUTCOME_CLASS, classifyTouch, outcomeByKey, shortDate, type LatestTouch, type Outcome, type TouchDetails } from "@/lib/sales/outcomes";
import { OutcomeChips, LatestOutcome, TouchLine, stopNotice } from "@/components/sales/OutcomeChips";
import DraftEmail from "@/components/sales/DraftEmail";
import { useOutcomeToast } from "@/components/sales/OutcomeToast";
import ConvertDialog from "@/components/sales/ConvertDialog";
import BookCall from "@/components/sales/BookCall";
import RunsOn from "@/components/sales/RunsOn";
import { runsOn } from "@/lib/lead-finder/software";

// The side preview for one business, used by Find (search results) and
// History: actions (call, maps, site, Preview site, audit), outcome buttons
// (save on first click, toast with Add note / Undo), latest outcome,
// Assigned to (leads.owner, the CRM user), the business's contact (the
// person there: name, title, email, phone; any team member can edit it),
// next action, Move to Interested, the full touch timeline,
// and the scan findings. Opening it runs PageSpeed in the background for the
// full website score (cached 30 days per website).

const RLS_HINT = "Only the team member it's assigned to (or an Admin/Manager) can change this.";

// One background PageSpeed run per website per page load.
const scoreRuns = new Map<string, Promise<WebScoreCache | null>>();

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Touch = LatestTouch & { id: string; meeting_note_id: string | null };
type Meeting = { id: string; title: string | null; started_at: string | null; summary_md: string | null; source_url: string | null };

export default function BusinessDetail({
  r,
  me,
  members,
  sourceDetail,
  onSaved,
  onRestored,
  onWebScore,
  dossier = false,
}: {
  r: RunResult;
  me: TeamMember | null;
  members: TeamMember[];
  sourceDetail: string;
  onSaved: (existing: ExistingLead) => void;
  // After Undo: the record's state again (null: it no longer exists).
  onRestored: (existing: ExistingLead | null) => void;
  onWebScore: (w: WebScoreCache) => void;
  // Audit page dossier: its own header (with Book a call) replaces the
  // preview's header, actions and Book a call, and it runs PageSpeed itself.
  dossier?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const toast = useOutcomeToast();
  const l = r.place;
  const ex = r.existing;
  const memberName = useCallback((id: string | null) => members.find((m) => m.id === id)?.name ?? "Unknown", [members]);
  const ownerName = ownerNameOf(l, ex);
  const personLabel = contactLabel(ex?.title);
  const email = contactEmail(l, ex);
  const phone = contactPhone(l, ex);
  const placeForScripts = { ...l, ownerName, phone: phone ?? "No phone listed" };
  const companyLi = companyLinkedin(l, ex);
  const socialLinks = SOCIAL_PLATFORMS.filter((p) => p !== "LinkedIn" && l.socialLinks?.[p]).map((p) => [p, l.socialLinks![p]!] as const);
  const tel = phone ? phone.replace(/[^0-9+]/g, "") : "";
  const preview = "/api/lead-finder/preview?" + previewQuery({ ...placeForScripts, type: r.search_type || l.category });
  // His audit page (app/lead-finder/audit). With a record id the result is
  // saved to it, and a saved audit reopens without a Google call.
  const audit =
    "/lead-finder/audit?" +
    new URLSearchParams({ place: l.id, type: r.search_type || l.category || "", ...(ex ? { lead: ex.id } : {}) }).toString();
  const canEdit = !!ex && canEditLead(ex, me);
  const software = runsOn(l.tech);
  const ws = websiteScore(l);

  // ---- Full website score (background PageSpeed) ----
  const [scoreState, setScoreState] = useState<"idle" | "running" | "failed">("idle");
  useEffect(() => {
    if (dossier || !hasRealSite(l) || freshWebScore(l)) return;
    const url = l.website;
    let live = true;
    setScoreState("running");
    let run = scoreRuns.get(url);
    if (!run) {
      run = apiFetch("/api/lead-finder/website-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId: l.id, website: url }),
      })
        .then((res) => res.json())
        .then((j) => (j.webScore as WebScoreCache) ?? null)
        .catch(() => null);
      scoreRuns.set(url, run);
    }
    void run.then((w) => {
      if (!live) return;
      if (w) {
        setScoreState("idle");
        onWebScore(w);
      } else {
        scoreRuns.delete(url);
        setScoreState("failed");
      }
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [l.id, l.website, l.webScore?.at]);

  // ---- Timeline ----
  // Meetings (Granola, migration 022) are touches with a meeting_note_id.
  const [touches, setTouches] = useState<Touch[]>([]);
  const [meetings, setMeetings] = useState<Record<string, Meeting>>({});
  const [openMeeting, setOpenMeeting] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!ex?.id) {
      setTouches([]);
      setMeetings({});
      return;
    }
    let live = true;
    void (async () => {
      const { data } = await supabase
        .from("lead_touches")
        .select("id, meeting_note_id, channel, direction, outcome, summary, touched_by, touched_at, details")
        .eq("lead_id", ex.id)
        .order("touched_at", { ascending: false });
      if (!live) return;
      const list = (data ?? []) as Touch[];
      setTouches(list);
      const ids = list.map((t) => t.meeting_note_id).filter((id): id is string => !!id);
      if (!ids.length) return setMeetings({});
      const { data: notes } = await supabase
        .from("meeting_notes")
        .select("id, title, started_at, summary_md, source_url")
        .in("id", ids);
      if (live) setMeetings(Object.fromEntries(((notes ?? []) as Meeting[]).map((n) => [n.id, n])));
    })();
    return () => {
      live = false;
    };
  }, [ex?.id, ex?.last_touch?.touched_at, ex?.last_touch?.summary, reload, supabase]);

  // ---- Emails and phones found (scan), plus whatever the record holds ----
  const foundEmails: { value: string; source: string }[] = [
    ...(ex?.email && !(l.contacts?.emails ?? []).some((e) => e.value.toLowerCase() === ex.email!.toLowerCase())
      ? [{ value: ex.email, source: "saved" }]
      : []),
    ...(l.contacts?.emails ?? l.emails.map((v) => ({ value: v, source: "website" }))),
  ];
  const samePhone = (a: string | null, b: string | null) => !!a && !!b && a.replace(/\D/g, "").slice(-10) === b.replace(/\D/g, "").slice(-10);
  const scanPhones = l.contacts?.phones ?? (l.phone && l.phone !== "No phone listed" ? [{ value: l.phone, source: "Google profile" }] : []);
  const foundPhones: { value: string; source: string }[] = [
    ...(ex?.phone && !scanPhones.some((p) => samePhone(p.value, ex.phone)) ? [{ value: ex.phone, source: "saved" }] : []),
    ...scanPhones,
  ];
  async function makePrimary(fields: { email?: string; phone?: string }) {
    if (!me) return;
    setContactMsg(null);
    const res = await saveBusinessContact(supabase, me.id, { key: l.id, place: l, searchType: r.search_type, existing: ex }, fields, sourceDetail);
    if (res.existing) onSaved(res.existing);
    if (res.error) setContactMsg(res.error);
  }

  // ---- Contact (the person at the business): any team member ----
  const [contactEdit, setContactEdit] = useState<{
    contact_name: string;
    title: string;
    email: string;
    phone: string;
    contact_linkedin: string;
    company_linkedin: string;
  } | null>(null);
  const [contactMsg, setContactMsg] = useState<string | null>(null);
  function startContactEdit() {
    setContactMsg(null);
    setContactEdit({
      contact_name: ownerName ?? "",
      title: ex?.title && ex.title !== SCAN_TITLE ? ex.title : "Owner",
      email: email ?? "",
      phone: phone ?? "",
      contact_linkedin: ex?.contact_linkedin ?? "",
      company_linkedin: companyLi ?? "",
    });
  }
  async function saveContact() {
    if (!me || !contactEdit) return;
    setContactMsg(null);
    const res = await saveBusinessContact(
      supabase,
      me.id,
      { key: l.id, place: l, searchType: r.search_type, existing: ex },
      contactEdit,
      sourceDetail
    );
    if (res.existing) onSaved(res.existing);
    if (res.error) return setContactMsg(res.error);
    setContactEdit(null);
  }

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
    if (!data?.length) return setNextMsg({ tone: "error", text: await zeroRowsReason(supabase, ex.id) });
    setNextMsg({ tone: "ok", text: "Saved." });
    onSaved({ ...ex, ...patch });
  }

  // ---- Move to Interested ----
  const [convert, setConvert] = useState<{
    lead: Lead;
    firstTouch: { channel: string; direction: string } | null;
    callBooked: boolean;
  } | null>(null);
  const [convertError, setConvertError] = useState<string | null>(null);

  async function openConvert(leadId: string, callBooked = false) {
    setConvertError(null);
    const [{ data: lead, error }, { data: first }] = await Promise.all([
      supabase.from("leads").select("*").eq("id", leadId).single(),
      supabase.from("lead_touches").select("channel, direction").eq("lead_id", leadId).order("touched_at").limit(1),
    ]);
    if (error || !lead) return setConvertError(error?.message ?? "Could not load this business.");
    setConvert({ lead: lead as Lead, firstTouch: first?.[0] ?? null, callBooked });
  }

  // ---- Outcomes: saved on the first click ----
  // Not available opens a small form first (who we spoke with); Emailed opens
  // the Draft email modal (its Mark as sent logs it); the rest save right
  // away. The toast offers Add note, Undo, and a follow-up date where the
  // outcome has one. LinkedIn outcomes then ask for the business owner's
  // LinkedIn profile if it's empty.
  const [naForm, setNaForm] = useState<{ spoke_with: string; role: string; said: string; email: string } | null>(null);
  const [naMsg, setNaMsg] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [liPrompt, setLiPrompt] = useState<string | null>(null); // the pasted link, while asking
  const [liMsg, setLiMsg] = useState<string | null>(null);

  // OutcomeChips: returns an error message or null.
  async function save(o: Outcome): Promise<string | null> {
    if (o.needsForm) {
      setNaMsg(null);
      setNaForm({ spoke_with: "", role: "", said: "", email: "" });
      return null;
    }
    if (o.opensDraft) {
      setDraftOpen(true);
      return null;
    }
    return (await doSave(o)).error;
  }

  type SaveResult = { id: string; error: null } | { id: null; error: string };

  async function doSave(o: Outcome, extra?: { summary?: string | null; details?: TouchDetails | null }): Promise<SaveResult> {
    if (!me) return { id: null, error: "You need a team member profile to log outcomes." };
    let res;
    try {
      res = await logOutcome(supabase, me.id, [{ key: l.id, place: l, searchType: r.search_type, existing: ex }], o, sourceDetail, extra);
    } catch (e) {
      return { id: null, error: (e as Error).message || "Could not save." };
    }
    if (res.failed.length) return { id: null, error: res.failed[0].reason };
    const saved = res.saved[0];
    let current = saved.existing;
    onSaved(current);
    setReload((n) => n + 1);
    toast.show({
      text: `${o.label} saved for ${l.name}.`,
      saved: res.saved,
      onUndone: (restored) => {
        onRestored(restored[0]?.existing ?? null);
        setReload((n) => n + 1);
      },
      onNote: (note) => {
        current = { ...current, last_touch: current.last_touch && { ...current.last_touch, summary: note } };
        onSaved(current);
        setReload((n) => n + 1);
      },
      followUp: o.followUp
        ? {
            kind: o.followUp,
            onSet: (_ids, next_action, next_action_at) => {
              current = { ...current, next_action, next_action_at };
              onSaved(current);
            },
          }
        : undefined,
    });
    if (o.asksLinkedin && !saved.existing.contact_linkedin) {
      setLiMsg(null);
      setLiPrompt("");
    }
    // Interested / Booked call: Move to Interested right away (when allowed).
    if (o.opensMove && !saved.existing.project_id && canEditLead(saved.existing, me))
      void openConvert(saved.existing.id, o.key === "booked_call");
    return { id: saved.existing.id, error: null };
  }

  async function saveNotAvailable() {
    if (!naForm || !me) return;
    if (!naForm.spoke_with.trim()) return setNaMsg("Who did you speak with?");
    setNaMsg(null);
    const email = naForm.email.trim();
    const details: TouchDetails = { spoke_with: naForm.spoke_with.trim() };
    if (naForm.role.trim()) details.role = naForm.role.trim();
    if (email) details.email = email;
    const res = await doSave(outcomeByKey("not_available"), { summary: naForm.said, details });
    if (res.error) return setNaMsg(res.error);
    setNaForm(null);
    if (email) {
      const c = await saveBusinessContact(supabase, me.id, { key: l.id, place: l, searchType: r.search_type, existing: null }, { email }, sourceDetail);
      if (c.existing) onSaved(c.existing);
      if (c.error) setContactMsg("Call saved, but the email wasn't: " + c.error);
    }
  }

  async function saveLinkedinPrompt() {
    if (!me || liPrompt == null || !liPrompt.trim()) return;
    if (!/linkedin\.com\//i.test(liPrompt)) return setLiMsg("That doesn't look like a LinkedIn link.");
    const c = await saveBusinessContact(supabase, me.id, { key: l.id, place: l, searchType: r.search_type, existing: ex }, { contact_linkedin: liPrompt }, sourceDetail);
    if (c.existing) onSaved(c.existing);
    if (c.error) return setLiMsg(c.error);
    setLiPrompt(null);
  }

  // Last gatekeeper we spoke with (Not available), for the email draft.
  const gatekeeper =
    touches.find((t) => t.details?.spoke_with)?.details?.spoke_with ?? ex?.last_touch?.details?.spoke_with ?? null;

  return (
    <>
      {!dossier && (
        <>
      <div className="d-head">
        <div style={{ minWidth: 0 }}>
          <div className="kicker">Business</div>
          <h3>{l.name}</h3>
          <div className="meta">{[l.category, l.address].filter(Boolean).join(" · ")}</div>
          {(software.length > 0 || (l.marketplaces ?? []).length > 0) && (
            <div style={{ marginTop: 6 }}>
              <RunsOn tech={l.tech} />
              {l.marketplaces?.length ? <span className="hint" style={{ marginLeft: software.length ? 6 : 0 }}>Sells on </span> : null}
              {(l.marketplaces ?? []).map((m) => (
                <span key={m} className="badge-mkt">{m}</span>
              ))}
            </div>
          )}
        </div>
        <div className="d-score">
          <div title={PRIORITY_TIP}>
            <b style={{ color: "var(--bright)" }}>{l.priority}</b>
            <small>priority</small>
          </div>
          <div title={WEBSITE_SCORE_TIP}>
            <b className="ws">{ws.score}</b>
            <small>
              website · {ws.kind}
              {scoreState === "running" && <span className="ws-run"> · checking</span>}
            </small>
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
        <button type="button" className="btn" style={{ gridColumn: "1 / -1" }} disabled={!me} onClick={() => setDraftOpen(true)}>
          Draft email
        </button>
      </div>

        </>
      )}

      {/* Order: header, actions, timeline, contact, log an outcome, book a call; then the scan findings. */}
      {touches.length > 0 && (
        <div>
          <div className="sec-title">Timeline</div>
          <ul className="timeline">
            {touches.map((t) => {
              const m = t.meeting_note_id ? meetings[t.meeting_note_id] : null;
              if (m) {
                const open = openMeeting === m.id;
                return (
                  <li key={t.id} className="meeting">
                    <span className="touch-line">
                      Met {shortDate(m.started_at ?? t.touched_at)} · <span className={`st ${OUTCOME_CLASS.meeting}`}>Meeting</span> ·{" "}
                      <b className="m-title">{m.title || "Untitled meeting"}</b> · {memberName(t.touched_by)}
                    </span>
                    {m.summary_md && (
                      <>
                        <div className={`m-summary${open ? " open" : ""}`}>{m.summary_md}</div>
                        <button type="button" className="linkbtn" onClick={() => setOpenMeeting(open ? null : m.id)}>
                          {open ? "Show less" : "Show full summary"}
                        </button>
                      </>
                    )}
                    {m.source_url && (
                      <>
                        {m.summary_md ? " · " : null}
                        <a href={m.source_url} target="_blank" rel="noopener noreferrer">Open in Granola</a>
                      </>
                    )}
                  </li>
                );
              }
              return (
                <li key={t.id}>
                  <TouchLine t={t} memberName={memberName} />
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
          {contactEdit == null ? (
            <div>
              {personLabel}: {ownerName ? <b>{ownerName}</b> : <span className="meta">unknown</span>}
              {ownerName && ex?.title && ex.title !== SCAN_TITLE && !/^owner$/i.test(ex.title) && <span className="hint"> ({ex.title})</span>}{" "}
              <button type="button" className="linkbtn" disabled={!me} onClick={startContactEdit}>
                Edit contact
              </button>
            </div>
          ) : (
            <div className="contact-form">
              <input className="field" autoFocus aria-label="Name" placeholder="First and last name" value={contactEdit.contact_name}
                onChange={(e) => setContactEdit({ ...contactEdit, contact_name: e.target.value })} />
              <input className="field" aria-label="Title" placeholder="Owner, office manager…" value={contactEdit.title}
                onChange={(e) => setContactEdit({ ...contactEdit, title: e.target.value })} />
              <input className="field" type="email" aria-label="Email" placeholder="Email" value={contactEdit.email}
                onChange={(e) => setContactEdit({ ...contactEdit, email: e.target.value })} />
              <input className="field" type="tel" aria-label="Phone" placeholder="Phone" value={contactEdit.phone}
                onChange={(e) => setContactEdit({ ...contactEdit, phone: e.target.value })} />
              <input className="field" type="url" aria-label="Business owner's LinkedIn" placeholder="Their LinkedIn profile link" value={contactEdit.contact_linkedin}
                onChange={(e) => setContactEdit({ ...contactEdit, contact_linkedin: e.target.value })} />
              <input className="field" type="url" aria-label="Company LinkedIn" placeholder="Company LinkedIn page link" value={contactEdit.company_linkedin}
                onChange={(e) => setContactEdit({ ...contactEdit, company_linkedin: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && void saveContact()} />
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn btn-gold" onClick={() => void saveContact()}>Save</button>
                <button type="button" className="btn" onClick={() => setContactEdit(null)}>Cancel</button>
              </div>
              <span className="hint">Anyone on the team can edit the contact. Saving also saves this business for the team.</span>
            </div>
          )}
          {contactMsg && <span className="bad-text" style={{ fontSize: 12.5 }}>{contactMsg}</span>}
          {/* Every email and phone found, with where; pick the primary (saved to the business contact). */}
          {foundPhones.map((p) => (
            <div key={p.value} className="found-row">
              <a href={`tel:${p.value.replace(/[^0-9+]/g, "")}`}>{p.value}</a> <span className="hint">{p.source}</span>{" "}
              {samePhone(p.value, phone) ? (
                <span className="primary-tag">primary</span>
              ) : (
                <button type="button" className="linkbtn" disabled={!me} onClick={() => void makePrimary({ phone: p.value })}>Make primary</button>
              )}
            </div>
          ))}
          {foundEmails.map((e) => (
            <div key={e.value} className="found-row">
              <a href={`mailto:${e.value}`}>{e.value}</a> <span className="hint">{e.source}</span>{" "}
              {e.value.toLowerCase() === (email ?? "").toLowerCase() ? (
                <span className="primary-tag">primary</span>
              ) : (
                <button type="button" className="linkbtn" disabled={!me} onClick={() => void makePrimary({ email: e.value })}>Make primary</button>
              )}
            </div>
          ))}
          {foundEmails.length ? null : l.contactPage ? (
            <a href={l.contactPage} target="_blank" rel="noopener noreferrer">Contact page</a>
          ) : l.website ? (
            <a href={l.website} target="_blank" rel="noopener noreferrer">Website</a>
          ) : (
            <span className="meta">No email or website found</span>
          )}
          <div className="li-row">
            {ex?.contact_linkedin ? (
              <a href={ex.contact_linkedin} target="_blank" rel="noopener noreferrer">LinkedIn: {ownerName ?? "profile"}</a>
            ) : (
              <a className="btn-mini" href={linkedinPeopleSearch(ownerName, l.name)} target="_blank" rel="noopener noreferrer">
                Find {ownerName ? ownerName.split(" ")[0] : "the owner"} on LinkedIn
              </a>
            )}
            {companyLi ? (
              <a href={companyLi} target="_blank" rel="noopener noreferrer">Company LinkedIn</a>
            ) : (
              <a className="btn-mini" href={linkedinCompanySearch(l.name)} target="_blank" rel="noopener noreferrer">
                Find company on LinkedIn
              </a>
            )}
          </div>
          <div>
            {socialLinks.length ? (
              <>
                Social:{" "}
                {socialLinks.map(([p, url], i) => (
                  <span key={p}>
                    {i > 0 && " · "}
                    <a href={url} target="_blank" rel="noopener noreferrer">{p}</a>
                  </span>
                ))}
              </>
            ) : (
              <span className="meta">{l.site || l.socialLinks ? "No social links on their website" : "Social links not checked"}</span>
            )}
          </div>
          {!ex?.contact_linkedin && !companyLi && (
            <span className="hint">Found them? Paste the links in Edit contact.</span>
          )}
        </div>
      </div>

      <div>
        <div className="sec-title">Log an outcome</div>
        <OutcomeChips
          big
          disabled={!me}
          confirm={stopNotice(ex)}
          current={ex?.last_touch && !ex.project_id ? classifyTouch(ex.last_touch).key : null}
          onSave={save}
        />
        {liPrompt != null && (
          <div className="li-prompt">
            <span className="hint">
              Paste {ownerName ? `${ownerName.split(" ")[0]}'s` : "the business owner's"} LinkedIn profile link so the team has it.
            </span>
            <input className="field" autoFocus type="url" aria-label="Business owner's LinkedIn profile" placeholder="https://www.linkedin.com/in/…"
              value={liPrompt} onChange={(e) => setLiPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveLinkedinPrompt();
                if (e.key === "Escape") setLiPrompt(null);
              }} />
            {liMsg && <span className="bad-text" style={{ fontSize: 12.5 }}>{liMsg}</span>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <button type="button" className="btn btn-gold" onClick={() => void saveLinkedinPrompt()}>Save</button>
              <a className="btn" href={linkedinPeopleSearch(ownerName, l.name)} target="_blank" rel="noopener noreferrer">Find on LinkedIn</a>
              <button type="button" className="btn" onClick={() => setLiPrompt(null)}>Not now</button>
            </div>
          </div>
        )}
        {naForm && (
          <div className="na-form">
            <span className="hint"><b style={{ color: "var(--bright)" }}>Not available.</b> Reached someone, not the decision maker.</span>
            <input className="field" autoFocus aria-label="Who you spoke with" placeholder="Who you spoke with (name)" value={naForm.spoke_with}
              onChange={(e) => setNaForm({ ...naForm, spoke_with: e.target.value })} />
            <input className="field" aria-label="Their role" placeholder="Their role, e.g. front desk" value={naForm.role}
              onChange={(e) => setNaForm({ ...naForm, role: e.target.value })} />
            <input className="field" aria-label="What they said" placeholder="What they said" value={naForm.said}
              onChange={(e) => setNaForm({ ...naForm, said: e.target.value })} />
            <input className="field" type="email" aria-label="Email they gave" placeholder="Email they gave (optional)" value={naForm.email}
              onChange={(e) => setNaForm({ ...naForm, email: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && void saveNotAvailable()} />
            {naMsg && <span className="bad-text" style={{ fontSize: 12.5 }}>{naMsg}</span>}
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="btn btn-gold" onClick={() => void saveNotAvailable()}>Save</button>
              <button type="button" className="btn" onClick={() => setNaForm(null)}>Cancel</button>
            </div>
          </div>
        )}
        <div style={{ marginTop: 8 }}>
          {ex?.last_touch || ex?.project_id ? (
            <LatestOutcome existing={ex} memberName={memberName} />
          ) : (
            <p className="hint">No one has contacted this business yet.</p>
          )}
          {ex && <p className="hint" style={{ marginTop: 4 }}>Assigned to: {ex.owner ? memberName(ex.owner) : "nobody yet"}</p>}
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

      {!dossier && (
        <BookCall
          members={members}
          name={ownerName}
          email={email}
          onBooked={() => void save(outcomeByKey("booked_call"))}
        />

      )}

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

      {draftOpen && me && (
        <DraftEmail
          ctx={{ place: placeForScripts, ownerName, gatekeeper, senderName: me.name, bookingLink: me.booking_link }}
          to={email}
          onClose={() => setDraftOpen(false)}
          onMarkSent={async (subject, to) => {
            return (await doSave(outcomeByKey("emailed"), { summary: subject, details: to ? { to } : null })).error;
          }}
        />
      )}

      {convert &&
        me &&
        createPortal(
          <ConvertDialog
            lead={convert.lead}
            firstTouch={convert.firstTouch}
            members={members}
            me={me}
            callBooked={convert.callBooked}
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
