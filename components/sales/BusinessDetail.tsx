"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import type { Lead, TeamMember } from "@/lib/types";
import type { ExistingLead, RunResult, WebScoreCache } from "@/lib/lead-finder/types";
import { SERVICE_ORDER } from "@/lib/lead-finder/sweep";
import { previewQuery } from "@/lib/lead-finder/previewQuery";
import { apiFetch } from "@/lib/lead-finder/apiFetch";
import {
  PRIORITY_TIP,
  WEBSITE_SCORE_TIP,
  freshWebScore,
  hasRealSite,
  websiteScore,
} from "@/lib/lead-finder/websiteScore";
import { canEditLead, ownedByOther } from "@/lib/leads/list";
import { logOutcome, monthsFromNow, saveBusinessContact, setNextAction, type ContactFields } from "@/lib/sales/log";
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
import { DEAD_REASONS, OUTCOME_CLASS, classifyTouch, outcomeByKey, shortDate, type LatestTouch, type Outcome, type TouchDetails } from "@/lib/sales/outcomes";
import { summarizeTouches } from "@/lib/sales/sections";
import { OutcomeChips, TouchLine, stopNotice } from "@/components/sales/OutcomeChips";
import DraftEmail from "@/components/sales/DraftEmail";
import { useOutcomeToast } from "@/components/sales/OutcomeToast";
import ConvertDialog from "@/components/sales/ConvertDialog";
import BookCall from "@/components/sales/BookCall";
import RunsOn from "@/components/sales/RunsOn";
import FindOwner from "@/components/sales/FindOwner";
import { useSalesFlags } from "@/components/sales/SalesFlags";
import { modeEmailKind, type SearchMode } from "@/lib/sales/searchModes";
import { runsOn } from "@/lib/lead-finder/software";

// The side preview for one business, used by Find (search results),
// History and the audit dossier. Order:
//   1. Header: name, category · city, Priority, Website score, Owned by
//      (Admin/Manager: Reassign, reason required), "Next: ..." chip (click to
//      change), the company's projects (projects.lead_id).
//   2. What they need: top 3 gaps from the scan.
//   3. Actions: Call, Run audit, Draft email; More: Google Maps, Visit site,
//      Preview site, Book a call with Luke.
//   4. Timeline (touches, meetings, notes, reassignments, releases).
//   5. Contact: Business block (main phone, business email, website, social;
//      from scans) and Owner block (name, title, direct phone, direct email,
//      LinkedIn; never from scans). Any team member edits either.
//   6. Log a touch: Call result / Email / LinkedIn (save on first click,
//      toast with Add note / Undo / follow-up). Owned by someone else and
//      not Admin/Manager: read-only ("Owned by X. Ask an Admin to reassign.";
//      RLS on lead_touches enforces it, migration 030).
// The dossier has no header or actions (the audit page has its own).
// Opening it runs PageSpeed in the background for the full website score
// (cached 30 days per website).

const RLS_HINT = "Only the team member it's assigned to (or an Admin/Manager) can change this.";

// One background PageSpeed run per website per page load.
const scoreRuns = new Map<string, Promise<WebScoreCache | null>>();

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
  mode = "all",
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
  // The search's branch focus: the default email draft branch and the
  // dossier's default tabs.
  mode?: SearchMode;
}) {
  const supabase = useMemo(() => createClient(), []);
  const toast = useOutcomeToast();
  // "Find owner contact" only when APOLLO_API_KEY is set (server flag).
  const flags = useSalesFlags();
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
    new URLSearchParams({
      place: l.id,
      type: r.search_type || l.category || "",
      ...(ex ? { lead: ex.id } : {}),
      ...(mode !== "all" ? { mode } : {}),
    }).toString();
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
        .select("id, meeting_note_id, channel, direction, outcome, summary, touched_by, touched_at, details, event")
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

  // ---- Contact: Business block and Owner block (migration 031) ----
  // Business: main phone, business email, website, social links (scans).
  // Owner: name, title, direct phone, direct email, LinkedIn (never from
  // scans). Any team member edits either, whoever the business is assigned to.
  const [bizEdit, setBizEdit] = useState<{ phone: string; email: string; company_linkedin: string } | null>(null);
  const [ownerEdit, setOwnerEdit] = useState<{
    contact_name: string;
    title: string;
    owner_phone: string;
    owner_email: string;
    contact_linkedin: string;
  } | null>(null);
  const [contactMsg, setContactMsg] = useState<string | null>(null);
  function startBizEdit() {
    setContactMsg(null);
    setOwnerEdit(null);
    setBizEdit({ phone: phone ?? "", email: email ?? "", company_linkedin: companyLi ?? "" });
  }
  function startOwnerEdit() {
    setContactMsg(null);
    setBizEdit(null);
    setOwnerEdit({
      contact_name: ownerName ?? "",
      title: ex?.title && ex.title !== SCAN_TITLE ? ex.title : "Owner",
      owner_phone: ex?.owner_phone ?? "",
      owner_email: ex?.owner_email ?? "",
      contact_linkedin: ex?.contact_linkedin ?? "",
    });
  }
  async function saveContact(fields: ContactFields, done: () => void) {
    if (!me) return;
    setContactMsg(null);
    const res = await saveBusinessContact(supabase, me.id, { key: l.id, place: l, searchType: r.search_type, existing: ex }, fields, sourceDetail);
    if (res.existing) onSaved(res.existing);
    if (res.error) return setContactMsg(res.error);
    done();
  }

  // ---- Next follow-up (header chip) ----
  const [nextOpen, setNextOpen] = useState(false);
  const [nextMsg, setNextMsg] = useState<string | null>(null);
  async function setNext(at: Date | null) {
    if (!ex) return;
    if (at && Number.isNaN(at.getTime())) return;
    const label = at ? ex.next_action || followLabel(ex.last_touch?.channel) : null;
    const err = await setNextAction(supabase, ex.id, label, at ? at.toISOString() : null);
    if (err) return setNextMsg(err);
    setNextMsg(null);
    setNextOpen(false);
    onSaved({ ...ex, next_action: label, next_action_at: at ? at.toISOString() : null });
  }

  // ---- Company projects (projects.lead_id) ----
  const [projects, setProjects] = useState<{ id: string; client_name: string; branch: string | null; stage: string }[]>([]);
  useEffect(() => {
    if (!ex?.id) return setProjects([]);
    let live = true;
    void supabase
      .from("projects")
      .select("id, client_name, branch, stage")
      .eq("lead_id", ex.id)
      .order("created_at")
      .then(({ data }) => live && setProjects(data ?? []));
    return () => {
      live = false;
    };
  }, [ex?.id, ex?.project_id, supabase]);

  // ---- Reassign (Admin / Manager, reason required, on the timeline) ----
  const isManager = me?.role === "Admin" || me?.role === "Manager";
  const [reassign, setReassign] = useState<{ to: string; reason: string } | null>(null);
  const [reassignMsg, setReassignMsg] = useState<string | null>(null);
  async function saveReassign() {
    if (!ex || !reassign) return;
    if (reassign.reason.trim().length < 3) return setReassignMsg("Add a reason.");
    const to = reassign.to || null;
    const { error } = await supabase.rpc("reassign_lead", { p_lead_id: ex.id, p_owner: to, p_reason: reassign.reason.trim() });
    if (error) return setReassignMsg(error.message);
    setReassign(null);
    setReassignMsg(null);
    onSaved({ ...ex, owner: to });
    setReload((n) => n + 1);
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
  // Small prompts for outcomes with a form: who said no, revisit date, dead reason.
  const [ask, setAsk] = useState<{ o: Outcome; kind: "who_said_no" | "revisit" | "dead" | "talked_to" } | null>(null);
  const [askDate, setAskDate] = useState("");

  async function save(o: Outcome): Promise<string | null> {
    if (o.form === "not_available") {
      setNaMsg(null);
      setNaForm({ spoke_with: "", role: "", said: "", email: "" });
      return null;
    }
    if (o.form === "who_said_no" || o.form === "revisit" || o.form === "dead" || o.form === "talked_to") {
      setAskDate("");
      setAsk({ o, kind: o.form });
      return null;
    }
    if (o.opensDraft) {
      setDraftOpen(true);
      return null;
    }
    return (await doSave(o)).error;
  }

  // Answers to the prompts.
  async function saveWhoSaidNo(by: "owner" | "staff") {
    if (!ask) return;
    const res = await doSave(ask.o, { details: { said_no_by: by, talked_to: by } });
    if (!res.error) setAsk(null);
    else setContactMsg(res.error);
  }
  // Interested: who did you talk to (owner reached or not).
  async function saveTalkedTo(by: "owner" | "staff") {
    if (!ask) return;
    const res = await doSave(ask.o, { details: { talked_to: by } });
    if (!res.error) setAsk(null);
    else setContactMsg(res.error);
  }
  async function saveRevisit(at: Date) {
    if (!ask || Number.isNaN(at.getTime())) return;
    const res = await doSave(ask.o);
    if (res.id === null) return setContactMsg(res.error);
    setAsk(null);
    const err = await setNextAction(supabase, res.id, "Revisit", at.toISOString());
    if (err) setContactMsg("Saved as Not now, but the revisit date wasn't: " + err);
    else if (latestRef.current) onSaved({ ...latestRef.current, next_action: "Revisit", next_action_at: at.toISOString() });
  }
  async function saveDead(reason: string) {
    if (!ask) return;
    const res = await doSave(ask.o, { details: { dead_reason: reason } });
    if (res.id === null) return setContactMsg(res.error);
    setAsk(null);
    // A dead business has no next step.
    if (!(await setNextAction(supabase, res.id, null, null)) && latestRef.current)
      onSaved({ ...latestRef.current, next_action: null, next_action_at: null });
  }
  // The record as last saved here (prompts update it after doSave).
  const latestRef = useRef<ExistingLead | null>(null);

  type SaveResult = { id: string; error: null } | { id: null; error: string };

  async function doSave(o: Outcome, extra?: { summary?: string | null; details?: TouchDetails | null }): Promise<SaveResult> {
    if (!me) return { id: null, error: "You need a team member profile to log outcomes." };
    if (o.key === "not_available") extra = { ...extra, details: { ...(extra?.details ?? {}), talked_to: "staff" } };
    let res;
    try {
      res = await logOutcome(supabase, me.id, [{ key: l.id, place: l, searchType: r.search_type, existing: ex }], o, sourceDetail, extra);
    } catch (e) {
      return { id: null, error: (e as Error).message || "Could not save." };
    }
    if (res.failed.length) return { id: null, error: res.failed[0].reason };
    const saved = res.saved[0];
    let current = saved.existing;
    latestRef.current = current;
    onSaved(current);
    setReload((n) => n + 1);
    // 5+ outreach attempts with no reply or positive outcome: suggest Not now.
    const { data: all } = await supabase
      .from("lead_touches")
      .select("channel, direction, outcome, summary, touched_by, touched_at, details")
      .eq("lead_id", current.id)
      .order("touched_at", { ascending: false });
    const sum = summarizeTouches((all ?? []) as LatestTouch[]);
    const lastKey = sum.latest ? classifyTouch(sum.latest).key : null;
    const suggestNotNow =
      sum.attemptsWithoutReply >= 5 && !["not_now", "dead", "not_interested", "staff_no", "interested", "booked_call"].includes(lastKey ?? "");
    toast.show({
      suggest: suggestNotNow
        ? {
            text: `${sum.attemptsWithoutReply} tries with no reply.`,
            label: "Move to Not now for 3 months?",
            run: async () => {
              const nn = outcomeByKey(current.last_touch?.channel === "email" ? "not_now_email" : "not_now");
              let r2;
              try {
                r2 = await logOutcome(supabase, me.id, [{ key: l.id, place: l, searchType: r.search_type, existing: current }], nn, sourceDetail);
              } catch (e) {
                return (e as Error).message || "Could not save.";
              }
              if (r2.failed.length) return r2.failed[0].reason;
              const at = monthsFromNow(3).toISOString();
              const err = await setNextAction(supabase, current.id, "Revisit", at);
              current = { ...r2.saved[0].existing, ...(err ? {} : { next_action: "Revisit", next_action_at: at }) };
              onSaved(current);
              setReload((n) => n + 1);
              return err;
            },
          }
        : undefined,
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

  // Owned by someone else (and I'm not Admin/Manager): read-only.
  const readOnly = ownedByOther(ex, me);
  const ownerMember = ex?.owner ? memberName(ex.owner) : null;
  // The person to email / book: the owner's direct email first.
  const personEmail = ex?.owner_email ?? email;
  // Top 3 gaps from the scan, as short lines.
  const topGaps = SERVICE_ORDER.filter((s) => l.services.includes(s))
    .flatMap((s) => l.tags[s])
    .slice(0, 3);
  const city = cityOf(l.address);
  const nextAtMs = ex?.next_action_at ? new Date(ex.next_action_at).getTime() : null;
  const [moreOpen, setMoreOpen] = useState(false);

  const ownerRow = ex && (
    <div className="d-chips">
      <span className="chip">{ownerMember ? `Owned by ${ownerMember}` : "Unassigned"}</span>
      {isManager && (
        <button type="button" className="chip" onClick={() => { setReassignMsg(null); setReassign(reassign ? null : { to: ex.owner ?? "", reason: "" }); }}>
          Reassign
        </button>
      )}
      {ex.next_action_at && (
        <button
          type="button"
          className={`chip next${nextAtMs != null && nextAtMs < Date.now() ? " overdue" : ""}`}
          disabled={!canEdit}
          title={canEdit ? "Change the follow-up" : RLS_HINT}
          onClick={() => setNextOpen(!nextOpen)}
        >
          Next: {ex.next_action || "Follow up"} {shortDate(ex.next_action_at)}
        </button>
      )}
    </div>
  );

  return (
    <>
      {/* 1. Header */}
      {!dossier && (
        <div className="d-head">
          <div style={{ minWidth: 0 }}>
            <div className="kicker">Business</div>
            <h3>{l.name}</h3>
            <div className="meta">{[l.category, city].filter(Boolean).join(" · ")}</div>
            {(software.length > 0 || (l.marketplaces ?? []).length > 0) && (
              <div style={{ marginTop: 6 }}>
                <RunsOn tech={l.tech} />
                {l.marketplaces?.length ? <span className="hint" style={{ marginLeft: software.length ? 6 : 0 }}>Sells on </span> : null}
                {(l.marketplaces ?? []).map((m) => (
                  <span key={m} className="badge-mkt">{m}</span>
                ))}
              </div>
            )}
            {ownerRow}
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
      )}
      {dossier && ownerRow}

      {reassign && ex && (
        <div className="chip-pop">
          <select className="field" aria-label="Assign to" style={{ width: "auto" }} value={reassign.to}
            onChange={(e) => setReassign({ ...reassign, to: e.target.value })}>
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <input className="field" autoFocus aria-label="Reason" placeholder="Reason (required)" value={reassign.reason}
            onChange={(e) => setReassign({ ...reassign, reason: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && void saveReassign()} />
          <button type="button" className="btn btn-gold" onClick={() => void saveReassign()}>Save</button>
          <button type="button" className="btn" onClick={() => setReassign(null)}>Cancel</button>
          {reassignMsg && <span className="bad-text" style={{ fontSize: 12.5 }}>{reassignMsg}</span>}
        </div>
      )}

      {nextOpen && ex && canEdit && (
        <div className="chip-pop">
          <span className="hint">Follow up:</span>
          <button type="button" className="btn-mini" onClick={() => void setNext(daysFromNow(1))}>Tomorrow</button>
          <button type="button" className="btn-mini" onClick={() => void setNext(daysFromNow(3))}>In 3 days</button>
          <button type="button" className="btn-mini" onClick={() => void setNext(daysFromNow(7))}>Next week</button>
          <input className="field" type="date" aria-label="Follow-up date" style={{ height: 30, width: "auto" }}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => e.target.value && void setNext(new Date(e.target.value + "T09:00:00"))} />
          <button type="button" className="linkbtn" onClick={() => void setNext(null)}>Clear</button>
          <button type="button" className="linkbtn" onClick={() => setNextOpen(false)}>Cancel</button>
          {nextMsg && <span className="bad-text" style={{ fontSize: 12.5 }}>{nextMsg}</span>}
        </div>
      )}

      {projects.length > 0 && (
        <div className="proj-list">
          {projects.map((p) => (
            <a key={p.id} href={`/project/${p.id}`}>
              {p.client_name}
              <span className="hint"> · {[p.branch, p.stage].filter(Boolean).join(" · ")}</span>
            </a>
          ))}
        </div>
      )}

      {/* 2. What they need */}
      <div>
        <div className="sec-title">What they need</div>
        {topGaps.length ? (
          <ul className="need-short">
            {topGaps.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        ) : (
          <p className="meta">No gaps flagged.</p>
        )}
      </div>

      {/* 3. Actions */}
      {!dossier && (
        <div>
          <div className="actions">
            {tel ? <a className="btn" href={`tel:${tel}`}>Call</a> : <button type="button" className="btn" disabled>No phone</button>}
            <a className="btn btn-gold" href={audit} target="_blank" rel="noopener noreferrer">Run audit</a>
            {!readOnly && (
              <button type="button" className="btn" disabled={!me} onClick={() => setDraftOpen(true)}>Draft email</button>
            )}
            <button type="button" className="btn" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>
              More {moreOpen ? "▴" : "▾"}
            </button>
          </div>
          {moreOpen && (
            <div className="more-menu">
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
              {!readOnly && (
                <BookCall compact members={members} name={ownerName} email={personEmail} onBooked={() => void save(outcomeByKey("booked_call"))} />
              )}
            </div>
          )}
        </div>
      )}

      {/* 4. Timeline */}
      {touches.length > 0 && (
        <div>
          <div className="sec-title">Timeline</div>
          <ul className="timeline">
            {touches.map((t) => {
              const m = t.meeting_note_id ? meetings[t.meeting_note_id] : null;
              // A call the Granola meeting attached to (migration 027): the
              // call sentence, then expandable "Granola notes".
              if (m && t.channel !== "meeting") {
                const open = openMeeting === m.id;
                const fromNotes = !!t.summary && !!m.summary_md && m.summary_md.trim().startsWith(t.summary.trim().slice(0, 40));
                return (
                  <li key={t.id}>
                    <TouchLine t={t} memberName={memberName} />
                    {t.summary && !fromNotes && <div className="latest-note">“{t.summary}”</div>}
                    <div className="granola">
                      <button type="button" className="linkbtn" onClick={() => setOpenMeeting(open ? null : m.id)}>
                        {open ? "Hide Granola notes" : "Granola notes"}
                      </button>
                      {open && (
                        <>
                          {m.summary_md && <div className="m-summary open">{m.summary_md}</div>}
                          {m.source_url && (
                            <a href={m.source_url} target="_blank" rel="noopener noreferrer">Open in Granola</a>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                );
              }
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
                  {/* Removed from pipeline carries its note in the sentence. */}
                  {t.summary && t.event !== "removed_from_pipeline" && <div className="latest-note">“{t.summary}”</div>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* 5. Contact: Business and Owner */}
      <div>
        <div className="sec-title">Contact</div>
        {contactMsg && <p className="bad-text" style={{ fontSize: 12.5, marginBottom: 6 }}>{contactMsg}</p>}

        <div className="c-block">
          <div className="c-head">
            Business
            {bizEdit == null && (
              <button type="button" className="linkbtn" disabled={!me} onClick={startBizEdit}>Edit</button>
            )}
          </div>
          {bizEdit ? (
            <div className="contact-form">
              <input className="field" autoFocus type="tel" aria-label="Main phone" placeholder="Main phone" value={bizEdit.phone}
                onChange={(e) => setBizEdit({ ...bizEdit, phone: e.target.value })} />
              <input className="field" type="email" aria-label="Business email" placeholder="Business email" value={bizEdit.email}
                onChange={(e) => setBizEdit({ ...bizEdit, email: e.target.value })} />
              <input className="field" type="url" aria-label="Company LinkedIn" placeholder="Company LinkedIn page link" value={bizEdit.company_linkedin}
                onChange={(e) => setBizEdit({ ...bizEdit, company_linkedin: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && void saveContact(bizEdit, () => setBizEdit(null))} />
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn btn-gold" onClick={() => void saveContact(bizEdit, () => setBizEdit(null))}>Save</button>
                <button type="button" className="btn" onClick={() => setBizEdit(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              {foundPhones.length ? (
                foundPhones.map((p) => (
                  <div key={p.value} className="c-row">
                    <span className="k">Main phone</span>
                    <a href={`tel:${p.value.replace(/[^0-9+]/g, "")}`}>{p.value}</a> <span className="hint">{p.source}</span>
                    {foundPhones.length > 1 &&
                      (samePhone(p.value, phone) ? (
                        <span className="primary-tag">primary</span>
                      ) : (
                        <button type="button" className="linkbtn" disabled={!me} onClick={() => void makePrimary({ phone: p.value })}>Make primary</button>
                      ))}
                  </div>
                ))
              ) : (
                <div className="c-row"><span className="k">Main phone</span><span className="meta">Not found yet</span></div>
              )}
              {foundEmails.length ? (
                foundEmails.map((e) => (
                  <div key={e.value} className="c-row">
                    <span className="k">Email</span>
                    <a href={`mailto:${e.value}`}>{e.value}</a> <span className="hint">{e.source}</span>
                    {foundEmails.length > 1 &&
                      (e.value.toLowerCase() === (email ?? "").toLowerCase() ? (
                        <span className="primary-tag">primary</span>
                      ) : (
                        <button type="button" className="linkbtn" disabled={!me} onClick={() => void makePrimary({ email: e.value })}>Make primary</button>
                      ))}
                  </div>
                ))
              ) : (
                <div className="c-row">
                  <span className="k">Email</span>
                  {l.contactPage ? (
                    <a href={l.contactPage} target="_blank" rel="noopener noreferrer">Contact page</a>
                  ) : (
                    <span className="meta">Not found yet</span>
                  )}
                </div>
              )}
              <div className="c-row">
                <span className="k">Website</span>
                {l.website ? (
                  <a href={l.website} target="_blank" rel="noopener noreferrer">{l.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a>
                ) : (
                  <span className="meta">None</span>
                )}
              </div>
              <div className="c-row">
                <span className="k">Social</span>
                {socialLinks.length || companyLi ? (
                  <span>
                    {socialLinks.map(([p, url], i) => (
                      <span key={p}>
                        {i > 0 && " · "}
                        <a href={url} target="_blank" rel="noopener noreferrer">{p}</a>
                      </span>
                    ))}
                    {companyLi && (
                      <>
                        {socialLinks.length ? " · " : ""}
                        <a href={companyLi} target="_blank" rel="noopener noreferrer">LinkedIn</a>
                      </>
                    )}
                  </span>
                ) : (
                  <span className="meta">{l.site || l.socialLinks ? "None on their website" : "Not checked"}</span>
                )}
                {!companyLi && (
                  <a className="btn-mini" href={linkedinCompanySearch(l.name)} target="_blank" rel="noopener noreferrer">Find company on LinkedIn</a>
                )}
              </div>
            </>
          )}
        </div>

        <div className="c-block">
          <div className="c-head">
            {personLabel === "Contact" ? "Contact" : "Owner"}
            {ownerEdit == null && (
              <button type="button" className="linkbtn" disabled={!me} onClick={startOwnerEdit}>Edit</button>
            )}
          </div>
          {ownerEdit ? (
            <div className="contact-form">
              <input className="field" autoFocus aria-label="Name" placeholder="First and last name" value={ownerEdit.contact_name}
                onChange={(e) => setOwnerEdit({ ...ownerEdit, contact_name: e.target.value })} />
              <input className="field" aria-label="Title" placeholder="Owner, office manager…" value={ownerEdit.title}
                onChange={(e) => setOwnerEdit({ ...ownerEdit, title: e.target.value })} />
              <input className="field" type="tel" aria-label="Direct phone" placeholder="Direct phone" value={ownerEdit.owner_phone}
                onChange={(e) => setOwnerEdit({ ...ownerEdit, owner_phone: e.target.value })} />
              <input className="field" type="email" aria-label="Direct email" placeholder="Direct email" value={ownerEdit.owner_email}
                onChange={(e) => setOwnerEdit({ ...ownerEdit, owner_email: e.target.value })} />
              <input className="field" type="url" aria-label="LinkedIn profile" placeholder="Their LinkedIn profile link" value={ownerEdit.contact_linkedin}
                onChange={(e) => setOwnerEdit({ ...ownerEdit, contact_linkedin: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && void saveContact(ownerEdit, () => setOwnerEdit(null))} />
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn btn-gold" onClick={() => void saveContact(ownerEdit, () => setOwnerEdit(null))}>Save</button>
                <button type="button" className="btn" onClick={() => setOwnerEdit(null)}>Cancel</button>
              </div>
              <span className="hint">Anyone on the team can edit the contact. Saving also saves this business for the team.</span>
            </div>
          ) : (
            <>
              <div className="c-row">
                <span className="k">Name</span>
                {ownerName ? <b>{ownerName}</b> : <span className="meta">Not found yet</span>}
              </div>
              <div className="c-row">
                <span className="k">Title</span>
                {ex?.title && ex.title !== SCAN_TITLE ? <span>{ex.title}</span> : <span className="meta">Not found yet</span>}
              </div>
              <div className="c-row">
                <span className="k">Direct phone</span>
                {ex?.owner_phone ? (
                  <a href={`tel:${ex.owner_phone.replace(/[^0-9+]/g, "")}`}>{ex.owner_phone}</a>
                ) : (
                  <span className="meta">Not found yet</span>
                )}
              </div>
              <div className="c-row">
                <span className="k">Direct email</span>
                {ex?.owner_email ? <a href={`mailto:${ex.owner_email}`}>{ex.owner_email}</a> : <span className="meta">Not found yet</span>}
              </div>
              <div className="c-row">
                <span className="k">LinkedIn</span>
                {ex?.contact_linkedin ? (
                  <a href={ex.contact_linkedin} target="_blank" rel="noopener noreferrer">{ownerName ?? "Profile"}</a>
                ) : (
                  <>
                    <span className="meta">Not found yet</span>
                    <a className="btn-mini" href={linkedinPeopleSearch(ownerName, l.name)} target="_blank" rel="noopener noreferrer">
                      Find on LinkedIn
                    </a>
                  </>
                )}
              </div>
              {flags.apollo && (
                <FindOwner place={l} existing={ex} searchType={r.search_type} me={me} sourceDetail={sourceDetail} onSaved={onSaved} />
              )}
            </>
          )}
        </div>
      </div>

      {/* 6. Log a touch */}
      <div>
        <div className="sec-title">Log a touch</div>
        {readOnly ? (
          <div className="readonly-note">Owned by {ownerMember}. Ask an Admin to reassign.</div>
        ) : (
          <OutcomeChips
            big
            disabled={!me}
            confirm={stopNotice(ex)}
            current={ex?.last_touch && !ex.project_id ? classifyTouch(ex.last_touch).key : null}
            onSave={save}
          />
        )}
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
        {ask && (
          <div className="na-form">
            {ask.kind === "talked_to" && (
              <>
                <span className="hint"><b style={{ color: "var(--bright)" }}>{ask.o.label}.</b> Who did you talk to?</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <button type="button" className="btn btn-gold" onClick={() => void saveTalkedTo("owner")}>Owner / decision maker</button>
                  <button type="button" className="btn" onClick={() => void saveTalkedTo("staff")}>Front desk / staff</button>
                </div>
              </>
            )}
            {ask.kind === "who_said_no" && (
              <>
                <span className="hint"><b style={{ color: "var(--bright)" }}>Not interested.</b> Who did you talk to?</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <button type="button" className="btn btn-gold" onClick={() => void saveWhoSaidNo("owner")}>Owner / decision maker</button>
                  <button type="button" className="btn" onClick={() => void saveWhoSaidNo("staff")}>Front desk / staff</button>
                </div>
              </>
            )}
            {ask.kind === "revisit" && (
              <>
                <span className="hint"><b style={{ color: "var(--bright)" }}>Not now.</b> When should we come back?</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  {[1, 3, 6].map((m) => (
                    <button key={m} type="button" className="btn" onClick={() => void saveRevisit(monthsFromNow(m))}>
                      {m} month{m === 1 ? "" : "s"}
                    </button>
                  ))}
                  <input className="field" type="date" aria-label="Revisit date" style={{ width: "auto" }} value={askDate}
                    min={new Date().toISOString().slice(0, 10)} onChange={(e) => setAskDate(e.target.value)} />
                  <button type="button" className="btn btn-gold" disabled={!askDate} onClick={() => void saveRevisit(new Date(askDate + "T09:00:00"))}>
                    Set date
                  </button>
                </div>
              </>
            )}
            {ask.kind === "dead" && (
              <>
                <span className="hint"><b style={{ color: "var(--bright)" }}>Dead.</b> Why?</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {DEAD_REASONS.map((reason) => (
                    <button key={reason} type="button" className="btn" onClick={() => void saveDead(reason)}>{reason}</button>
                  ))}
                </div>
              </>
            )}
            <button type="button" className="linkbtn" style={{ alignSelf: "flex-start" }} onClick={() => setAsk(null)}>Cancel</button>
          </div>
        )}
        {naForm && (
          <div className="na-form">
            <span className="hint"><b style={{ color: "var(--bright)" }}>Not available.</b> Who did you talk to? (not the decision maker)</span>
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
        {ex && !ex.project_id && !readOnly && (
          <div style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-gold" style={{ width: "100%", minHeight: 44 }} disabled={!canEdit || !me}
              onClick={() => void openConvert(ex.id)}>
              Move to Interested
            </button>
          </div>
        )}
        {convertError && <p className="error" style={{ marginTop: 6 }}>{convertError}</p>}
      </div>

      {draftOpen && me && (
        <DraftEmail
          defaultKind={modeEmailKind(mode, placeForScripts)}
          ctx={{ place: placeForScripts, ownerName, gatekeeper, senderName: me.name, bookingLink: me.booking_link }}
          to={personEmail}
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

// "123 Main St, Wheaton, IL 60187, USA" -> "Wheaton".
function cityOf(address: string): string | null {
  const parts = (address || "").split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) return parts[parts.length - (/^usa$|^united states$/i.test(parts[parts.length - 1]) ? 3 : 2)] ?? null;
  return parts.length === 2 ? parts[1] : null;
}

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(9, 0, 0, 0);
  return d;
}

function followLabel(channel: string | null | undefined): string {
  return channel === "email" ? "Follow up: email" : channel?.startsWith("linkedin") ? "Follow up: LinkedIn" : "Follow up: call";
}
