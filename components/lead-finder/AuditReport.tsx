"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@/components/lead-finder/audit.css";
import "@/components/lead-finder/lead-finder.css";
import { LF_FONT_VARS } from "@/components/lead-finder/fonts";
import { createClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/lead-finder/apiFetch";
import type { TeamMember } from "@/lib/types";
import type { ExistingLead, PageSpeed, SavedAudit, ScannedPlace } from "@/lib/lead-finder/types";
import { buildRecommendations } from "@/lib/lead-finder/recommendations";
import { buildCallScript, type PitchKey } from "@/lib/lead-finder/callScript";
import { CHECK_GROUPS, websiteChecks, websiteScore } from "@/lib/lead-finder/websiteScore";
import { gbpChecks } from "@/lib/lead-finder/gbpScore";
import { logOutcome, zeroRowsReason } from "@/lib/sales/log";
import { contactEmail, contactPhone, ownerNameOf } from "@/lib/sales/owner";
import { defaultEmailKind } from "@/lib/sales/emailTemplates";
import { outcomeByKey, type Outcome } from "@/lib/sales/outcomes";
import { OutcomeToastProvider, useOutcomeToast } from "@/components/sales/OutcomeToast";
import { LatestOutcome } from "@/components/sales/OutcomeChips";
import BusinessDetail from "@/components/sales/BusinessDetail";
import BookCall from "@/components/sales/BookCall";
import DraftEmail from "@/components/sales/DraftEmail";

// The business dossier (opened from Run audit), in this order:
//   a. header: business, category, address, rating, Assigned to, latest
//      outcome, Book a call with Luke                          (screen only)
//   b. the side preview: contact (editable), LinkedIn, social, badges,
//      timeline, outcome buttons (BusinessDetail, dossier)        (screen only)
//   c. website score breakdown (lib/lead-finder/websiteScore.ts)    (printed)
//   d. Google Business Profile completeness (gbpScore.ts)           (printed)
//      + recommendations and next step                             (printed)
//   e. email drafts, five branch templates                        (screen only)
//   f. call script, five branch tabs                              (screen only)
// Print / Save as PDF prints only the client report (c, d, recommendations).
// Data: /api/lead-finder/audit (Place Details + website scan), then
// /api/lead-finder/pagespeed (also caches the full website score). With a
// Sales record the finished audit is saved to leads.audit / audit_at.


type Part1 = { lead: ScannedPlace; speedUrl: string | null; previewUrl: string };
type Speed = PageSpeed | null | "loading";

const grade = (n: number | null | undefined) => (n == null ? "" : n >= 90 ? "good" : n >= 50 ? "ok" : "bad");
const longDate = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

// Call script text markers (lib/lead-finder/callScript.ts): {{blank}} and ((stage direction)).
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\{\{.*?\}\}|\(\(.*?\)\))/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("{{") ? (
          <span key={i} className="fill">{p.slice(2, -2)}</span>
        ) : p.startsWith("((") ? (
          <i key={i}>({p.slice(2, -2)})</i>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

export default function AuditReport(props: AuditProps) {
  return (
    <OutcomeToastProvider wrapClassName={`lf-root ${LF_FONT_VARS} toast-host`}>
      <AuditInner {...props} />
    </OutcomeToastProvider>
  );
}

type AuditProps = {
  placeId: string;
  type: string;
  me: TeamMember;
  members: TeamMember[];
  saved: SavedAudit | null;
  // The Sales record, if there is one (any touch or edit here creates it).
  initialExisting: ExistingLead | null;
  sourceDetail: string;
};

function AuditInner({ placeId, type, me, members, saved, initialExisting, sourceDetail }: AuditProps) {
  const toast = useOutcomeToast();
  const [existing, setExisting] = useState<ExistingLead | null>(initialExisting);
  const leadId = existing?.id ?? null;
  const [part1, setPart1] = useState<Part1 | null>(
    saved ? { lead: saved.place, speedUrl: null, previewUrl: saved.previewUrl } : null
  );
  const [speed, setSpeed] = useState<Speed>(saved ? saved.speed : null);
  const [error, setError] = useState<string | null>(null);
  const [ranAt, setRanAt] = useState<string | null>(saved?.ran_at ?? null);
  const [fromSaved, setFromSaved] = useState(!!saved);
  const [save, setSave] = useState<{ tone: "ok" | "bad"; text: string } | null>(
    saved ? { tone: "ok", text: `Saved audit from ${longDate(new Date(saved.ran_at))}.` } : null
  );
  const savedRun = useRef<string | null>(null);
  const memberName = useCallback((id: string | null) => members.find((m) => m.id === id)?.name ?? "Unknown", [members]);

  const run = useCallback(async () => {
    setError(null);
    setPart1(null);
    setSpeed(null);
    setSave(null);
    setFromSaved(false);
    if (!placeId) {
      setError("Missing business id.");
      return;
    }
    let p: Part1;
    try {
      const r = await apiFetch("/api/lead-finder/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId, type }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not build the audit.");
      p = d;
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const stamp = new Date().toISOString();
    setRanAt(stamp);
    setPart1(p);
    if (!p.speedUrl) return setSpeed(null);
    setSpeed("loading");
    try {
      const r = await apiFetch("/api/lead-finder/pagespeed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: p.speedUrl, placeId }),
      });
      const d = await r.json();
      setSpeed(r.ok ? d : { error: d.error || "PageSpeed check failed." });
    } catch {
      setSpeed({ error: "PageSpeed check failed." });
    }
  }, [placeId, type]);

  useEffect(() => {
    if (!saved) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The scan, with the Sales record's contact on top: the business owner a
  // person entered (or a confident scan guess), the record's phone. The
  // call script and email drafts use this.
  const scanned = part1?.lead ?? null;
  const L = useMemo(
    () =>
      scanned
        ? { ...scanned, ownerName: ownerNameOf(scanned, existing), phone: contactPhone(scanned, existing) ?? "No phone listed" }
        : null,
    [scanned, existing]
  );
  const S = speed === "loading" ? null : speed;
  const recommendations = L ? buildRecommendations(L, S) : [];

  useEffect(() => {
    if (L) document.title = "Business dossier: " + L.name;
  }, [L]);

  // Save a fresh, finished audit to the Sales record (once per run).
  useEffect(() => {
    if (!leadId || fromSaved || !L || !ranAt || speed === "loading" || savedRun.current === ranAt) return;
    savedRun.current = ranAt;
    const body: SavedAudit = {
      version: 1,
      place: L,
      type,
      speed: S ? { ...S, screenshot: undefined } : null,
      recommendations,
      previewUrl: part1!.previewUrl,
      ran_at: ranAt,
      ran_by: me.id,
    };
    void (async () => {
      const { data, error: err } = await createClient()
        .from("leads")
        .update({ audit: body, audit_at: ranAt })
        .eq("id", leadId)
        .select("id");
      if (err) setSave({ tone: "bad", text: "Not saved: " + err.message });
      else if (!data?.length) setSave({ tone: "bad", text: await zeroRowsReason(createClient(), leadId) });
      else setSave({ tone: "ok", text: "Saved to this business." });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, fromSaved, L, ranAt, speed]);

  // Logging from the header (Book a call) and the email drafts (Mark as
  // sent); the side preview section logs through BusinessDetail.
  async function quickLog(o: Outcome, extra?: { summary?: string | null; details?: Record<string, string> | null }): Promise<string | null> {
    if (!scanned) return "The audit is still loading.";
    let res;
    try {
      res = await logOutcome(createClient(), me.id, [{ key: placeId, place: scanned, searchType: type || null, existing }], o, sourceDetail, extra);
    } catch (e) {
      return (e as Error).message || "Could not save.";
    }
    if (res.failed.length) return res.failed[0].reason;
    let current = res.saved[0].existing;
    setExisting(current);
    toast.show({
      text: `${o.label} saved for ${scanned.name}.`,
      saved: res.saved,
      onUndone: (restored) => setExisting(restored[0]?.existing ?? null),
      onNote: (note) => {
        current = { ...current, last_touch: current.last_touch && { ...current.last_touch, summary: note } };
        setExisting(current);
      },
      followUp: o.followUp
        ? { kind: o.followUp, onSet: (_ids, next_action, next_action_at) => setExisting((current = { ...current, next_action, next_action_at })) }
        : undefined,
    });
    return null;
  }

  const busy = !error && (!L || speed === "loading");
  const result = scanned ? { google_place_id: placeId, search_type: type || null, place: scanned, existing } : null;
  const gatekeeper = existing?.last_touch?.details?.spoke_with ?? null;

  return (
    <div className="lfa">
      <div className="page">
        <div className="toolbar">
          {save && <span className={`saved${save.tone === "bad" ? " bad" : ""}`}>{save.text}</span>}
          {fromSaved && (
            <button type="button" className="plain" onClick={() => void run()}>
              Run again
            </button>
          )}
          {part1 && (
            <a className="alt" href={part1.previewUrl} target="_blank" rel="noopener noreferrer">
              Show sample website
            </a>
          )}
          <button type="button" disabled={busy} onClick={() => window.print()}>
            Print client report / Save as PDF
          </button>
        </div>

        {error ? (
          <div className="error">{error}</div>
        ) : !L || !result ? (
          <div className="loading">
            <div className="spinner" />
            <div>Building the dossier: checking the website, then running Google’s speed test. This takes 20 to 60 seconds…</div>
          </div>
        ) : (
          <>
            {/* a + b: internal, screen only */}
            <div className={`lf-root ${LF_FONT_VARS} dossier no-print`}>
              <div className="dossier-head">
                <div style={{ minWidth: 0 }}>
                  <div className="kicker">Business dossier</div>
                  <h1 className="dossier-title">{L.name}</h1>
                  <div className="meta">{[L.category, L.address].filter(Boolean).join(" · ")}</div>
                  <div className="meta">
                    {L.rating !== "N/A" ? `★ ${L.rating} from ${L.reviews} Google reviews` : "No Google rating yet"} · Assigned to:{" "}
                    {existing?.owner ? memberName(existing.owner) : "nobody yet"}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    {existing?.last_touch || existing?.project_id ? (
                      <LatestOutcome existing={existing} memberName={memberName} />
                    ) : (
                      <span className="hint">No one has contacted this business yet.</span>
                    )}
                  </div>
                </div>
                <div className="dossier-book">
                  <BookCall
                    members={members}
                    name={L.ownerName}
                    email={contactEmail(scanned!, existing)}
                    onBooked={() => void quickLog(outcomeByKey("booked_call"))}
                  />
                </div>
              </div>
              <div className="dossier-body">
                <BusinessDetail
                  dossier
                  r={result}
                  me={me}
                  members={members}
                  sourceDetail={sourceDetail}
                  onSaved={setExisting}
                  onRestored={setExisting}
                  onWebScore={() => {}}
                />
              </div>
            </div>

            {/* c + d + recommendations: the client report, printed */}
            <Report L={L} speed={speed} recommendations={recommendations} date={ranAt ? new Date(ranAt) : new Date()} />

            {/* e: email drafts, screen only */}
            <div className={`lf-root ${LF_FONT_VARS} dossier no-print`}>
              <DraftEmail
                inline
                ctx={{ place: L, ownerName: L.ownerName, gatekeeper, senderName: me.name, bookingLink: me.booking_link }}
                to={contactEmail(scanned!, existing)}
                onClose={() => {}}
                onMarkSent={(subject, to) => quickLog(outcomeByKey("emailed"), { summary: subject, details: to ? { to } : null })}
              />
            </div>

            {/* f: call script, screen only */}
            <CallScriptBox L={L} speed={S} recommendations={recommendations} />
          </>
        )}
      </div>
    </div>
  );
}

// The client report: website score breakdown, Google Business Profile,
// recommendations, next step. The only part that prints.
function Report({
  L,
  speed,
  recommendations,
  date,
}: {
  L: ScannedPlace;
  speed: Speed;
  recommendations: ReturnType<typeof buildRecommendations>;
  date: Date;
}) {
  const S = speed && speed !== "loading" && !speed.error ? speed : null;
  const card = (n: number | null | undefined, lbl: string) => (
    <div className="score">
      <div className={`num ${grade(n)}`}>{n == null ? "n/a" : n}</div>
      <div className="lbl">{lbl}</div>
    </div>
  );
  const checks = websiteChecks(L, S);
  const ws = websiteScore(L, S);
  const webMissing = checks.filter((c) => c.earned < c.possible).map((c) => c.missing);
  const gbp = gbpChecks(L);
  const gbpTotal = gbp.reduce((a, c) => a + c.earned, 0);
  const gbpMissing = gbp.filter((c) => c.earned < c.possible).map((c) => c.missing);
  const photos = L.photos ?? 0;

  return (
    <>
      <header>
        <div className="kicker">Online Presence Audit</div>
        <h1>{L.name}</h1>
        <p>{(L.category ? L.category + " · " : "") + L.address}</p>
        <p style={{ marginTop: 10 }}>Prepared by FullyLaunched · {longDate(date)}</p>
      </header>

      <section>
        <h2>Website score</h2>
        <div className="bigscore">
          <div className={`num ${grade(ws.score)}`}>{ws.score}</div>
          <div>
            <b>out of 100</b>
            <p className="note">
              {ws.kind === "full"
                ? "Basics, search (SEO), AI-search readiness (AEO) and speed."
                : speed === "loading"
                  ? "Running Google’s speed test now. The speed part is added when it finishes."
                  : "Basics, search (SEO) and AI-search readiness (AEO). Speed wasn’t tested."}
            </p>
          </div>
        </div>
        {CHECK_GROUPS.map(([g, label]) => {
          const rows = checks.filter((c) => c.group === g);
          const earned = rows.reduce((a, c) => a + c.earned, 0);
          const possible = rows.reduce((a, c) => a + c.possible, 0);
          return (
            <div key={g} className="checkgroup">
              <h3>
                {label} <span>{earned} / {possible}</span>
              </h3>
              <ul className="checks">
                {rows.map((c) => (
                  <li key={c.label} className={c.earned >= c.possible ? "ok" : c.earned > 0 ? "part" : "no"}>
                    <span className="k">{c.label}</span>
                    <span className="d">{c.detail ?? ""}</span>
                    <span className="pts">{c.earned} / {c.possible}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        <p className="note">
          Images on the homepage: {L.site?.imageCount ?? "not counted"} · Google profile photos: {photos >= 10 ? "10+" : photos}
        </p>
        {S && (
          <>
            <h3 className="subhead">Google’s scores for the website (on a phone)</h3>
            <div className={`split${S.screenshot ? "" : " one"}`}>
              <div className="scores">
                {card(S.performance, "Speed")}
                {card(S.seo, "Search (SEO)")}
                {card(S.accessibility, "Accessibility")}
                {card(S.bestPractices, "Best practices")}
              </div>
              {S.screenshot && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="shot" src={S.screenshot} alt="Phone view of the website" />
              )}
            </div>
            <p className="note">
              Scores out of 100 from Google PageSpeed Insights, mobile test.
              {S.loadTime ? ` Main content appears after ${S.loadTime}.` : ""}
            </p>
          </>
        )}
        {webMissing.length > 0 && (
          <>
            <h3 className="subhead">What’s missing</h3>
            <ul className="missing">
              {webMissing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section>
        <h2>Google Business Profile</h2>
        <div className="bigscore">
          <div className={`num ${grade(gbpTotal)}`}>{gbpTotal}</div>
          <div>
            <b>out of 100</b>
            <p className="note">How complete the business’s Google profile is. It’s what most customers see first.</p>
          </div>
        </div>
        <ul className="checks">
          {gbp.map((c) => (
            <li key={c.label} className={c.earned >= c.possible ? "ok" : c.earned > 0 ? "part" : "no"}>
              <span className="k">{c.label}</span>
              <span className="d">{c.value}</span>
              <span className="pts">{c.earned} / {c.possible}</span>
            </li>
          ))}
        </ul>
        {gbpMissing.length > 0 && (
          <>
            <h3 className="subhead">What’s missing</h3>
            <ul className="missing">
              {gbpMissing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      {recommendations.length > 0 && (
        <section>
          <h2>Our recommendations</h2>
          {recommendations.map((r, i) => (
            <div key={r.title} className="rec">
              <div className="n">{i + 1}</div>
              <div>
                <h3>{r.title}</h3>
                <p>{r.why}</p>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="cta">
        <h2>Next step</h2>
        <p>
          FullyLaunched helps local businesses with <b>websites, social media, e-commerce and AI automation</b>. We’d be glad
          to walk you through these findings, no cost, no pressure.
        </p>
      </section>
    </>
  );
}

// His call script box. Screen only (hidden in print).
function CallScriptBox({
  L,
  speed,
  recommendations,
}: {
  L: ScannedPlace;
  speed: PageSpeed | null;
  recommendations: ReturnType<typeof buildRecommendations>;
}) {
  const built = buildCallScript(L, speed, recommendations);
  // Five branch tabs, like the email drafts. AI uses the ServiceTitan pitch
  // for ServiceTitan users. Default: the business's top gap.
  const aiKey: PitchKey = L.usesServiceTitan ? "servicetitan" : "ai";
  const TABS: [PitchKey, string][] = [
    [aiKey, "AI"],
    ["website", "Website"],
    ["social", "Social media"],
    ["ecom", "E-commerce"],
    ["general", "General"],
  ];
  const top = defaultEmailKind(L);
  const [pick, setPick] = useState<PitchKey>(top === "ai" ? aiKey : top);
  const s = built.scripts[pick];
  const tel = L.phone && L.phone !== "No phone listed" ? L.phone.replace(/[^0-9+]/g, "") : "";

  return (
    <div className="script">
      <div className="script-top">
        <h2>Call script</h2>
        <div className="script-tabs">
          {TABS.map(([k, label]) => (
            <button key={k} type="button" className={k === pick ? "on" : ""} onClick={() => setPick(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="private">For you only. Left out when you print the client report. Emails are in Email drafts above.</div>
      <div className="prep">
        <div>
          <b>Ask for</b>
          {built.askFor}
        </div>
        <div>
          <b>Call</b>
          {tel ? <a href={`tel:${tel}`}>{L.phone}</a> : "No phone listed"}
        </div>
        <div>
          <b>Email</b>
          {L.emails.length ? <a href={`mailto:${L.emails[0]}`}>{L.emails[0]}</a> : "None found"}
        </div>
      </div>

      <div className="step">
        <h3>1. Open</h3>
        <div className="say"><Rich text={s.opener} /></div>
      </div>
      <div className="step">
        <h3>2. Why you’re calling</h3>
        <div className="say"><Rich text={s.hook} /></div>
      </div>
      <div className="step">
        <h3>3. Ask, then listen</h3>
        <ul className="qs">
          {s.questions.map((q) => (
            <li key={q}><Rich text={q} /></li>
          ))}
        </ul>
      </div>
      <div className="step">
        <h3>4. What we’d do</h3>
        <div className="say"><Rich text={s.pitch} /></div>
      </div>
      <div className="step">
        <h3>5. Book the meeting</h3>
        <div className="say"><Rich text={s.close} /></div>
      </div>
      <div className="step">
        <h3>If they push back</h3>
        {s.objections.map(([o, a]) => (
          <div key={o} className="obj">
            <b>{o}</b>
            <span><Rich text={a} /></span>
          </div>
        ))}
      </div>
      <div className="step">
        <h3>If you get voicemail</h3>
        <div className="say"><Rich text={built.voicemail} /></div>
      </div>
    </div>
  );
}
