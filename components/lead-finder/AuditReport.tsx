"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "@/components/lead-finder/audit.css";
import { createClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/lead-finder/apiFetch";
import type { PageSpeed, SavedAudit, ScannedPlace, ServiceKey } from "@/lib/lead-finder/types";
import { buildRecommendations } from "@/lib/lead-finder/recommendations";
import { buildCallScript, type PitchKey } from "@/lib/lead-finder/callScript";

// Matteo's audit.html: call script (screen only), Google's PageSpeed scores,
// snapshot, findings, recommendations, next step. Two requests instead of
// his one (each fits Vercel's 60s): /api/lead-finder/audit (Place Details +
// website scan), then /api/lead-finder/pagespeed for a real website. When
// the business is already a lead, the finished audit is saved to
// leads.audit / audit_at (RLS decides who may).

const LABELS: Record<ServiceKey, string> = { website: "Website", social: "Social", ecom: "E-commerce", ai: "AI" };
const RLS_HINT = "A Salesperson can only change leads they own or that have no owner.";

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

export default function AuditReport({
  placeId,
  type,
  leadId,
  memberId,
  saved,
}: {
  placeId: string;
  type: string;
  leadId: string | null;
  memberId: string;
  saved: SavedAudit | null;
}) {
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
        body: JSON.stringify({ url: p.speedUrl }),
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

  const L = part1?.lead ?? null;
  const S = speed === "loading" ? null : speed;
  const recommendations = L ? buildRecommendations(L, S) : [];

  useEffect(() => {
    if (L) document.title = "Online Presence Audit: " + L.name;
  }, [L]);

  // Save a fresh, finished audit to the lead (once per run).
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
      ran_by: memberId,
    };
    void (async () => {
      const { data, error: err } = await createClient()
        .from("leads")
        .update({ audit: body, audit_at: ranAt })
        .eq("id", leadId)
        .select("id");
      if (err) setSave({ tone: "bad", text: "Not saved to the lead: " + err.message });
      else if (!data?.length) setSave({ tone: "bad", text: "Not saved to the lead. " + RLS_HINT });
      else setSave({ tone: "ok", text: "Saved to the lead." });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, fromSaved, L, ranAt, speed]);

  const busy = !error && (!L || speed === "loading");

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
            Print client audit / Save as PDF
          </button>
        </div>

        {error ? (
          <div className="error">{error}</div>
        ) : !L ? (
          <div className="loading">
            <div className="spinner" />
            <div>Building the audit: checking the website, then running Google’s speed test. This takes 20 to 60 seconds…</div>
          </div>
        ) : (
          <>
            <CallScriptBox L={L} speed={S} recommendations={recommendations} />
            <Report L={L} speed={speed} recommendations={recommendations} date={ranAt ? new Date(ranAt) : new Date()} />
          </>
        )}
      </div>
    </div>
  );
}

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
  const hasSite = L.websiteStatus === "Has website";
  const facts: [string, React.ReactNode][] = [
    ["Google rating", L.rating !== "N/A" ? `★ ${L.rating} from ${L.reviews} reviews` : "No rating yet"],
    [
      "Website",
      L.website ? (
        <>
          <a href={L.website} target="_blank" rel="noopener noreferrer">{L.website}</a> ({L.websiteStatus})
        </>
      ) : (
        "None listed on Google"
      ),
    ],
    ["Social media", L.socials.length ? L.socials.join(", ") : hasSite ? "No links found on the website" : "Not checked"],
    ["Online store", L.store ? L.store : hasSite ? "None found" : "Not checked"],
    ["Sells on", L.marketplaces === undefined ? "Not checked" : L.marketplaces.length ? L.marketplaces.join(", ") : hasSite ? "No marketplaces found" : "Not checked"],
    ["Online booking", L.hasBooking == null ? "Not checked" : L.hasBooking ? "Yes" : "None found"],
    ["Software spotted", L.tech.length ? L.tech.join(", ") : "None spotted"],
    ["Paid ads", L.ads.length ? L.ads.join(", ") : "None detected"],
  ];
  if (L.shopify && L.shopify.products)
    facts.push([
      "Shopify catalog",
      `${L.shopify.products}${L.shopify.capped ? "+" : ""} products · ${L.shopify.noPhoto} without photos · ${L.shopify.thinDescription} with thin descriptions`,
    ]);
  const findings: [ServiceKey, string][] = [];
  (Object.keys(LABELS) as ServiceKey[]).forEach((k) => (L.tags[k] || []).forEach((t) => findings.push([k, t])));

  return (
    <>
      <header>
        <div className="kicker">Online Presence Audit</div>
        <h1>{L.name}</h1>
        <p>{(L.category ? L.category + " · " : "") + L.address}</p>
        <p style={{ marginTop: 10 }}>Prepared by FullyLaunched · {longDate(date)}</p>
      </header>

      {speed === "loading" && (
        <section>
          <h2>Google’s scores for your website (on a phone)</h2>
          <div className="loading small">
            <div className="spinner" />
            <div>Running Google’s speed test. This can take up to a minute…</div>
          </div>
        </section>
      )}
      {S && (
        <section>
          <h2>Google’s scores for your website (on a phone)</h2>
          <div className="scores">
            {card(S.performance, "Speed")}
            {card(S.seo, "Search (SEO)")}
            {card(S.accessibility, "Accessibility")}
            {card(S.bestPractices, "Best practices")}
          </div>
          <p className="note">
            Scores out of 100 from Google PageSpeed Insights, mobile test.
            {S.loadTime ? ` Main content appears after ${S.loadTime}.` : ""}
          </p>
        </section>
      )}

      <section>
        <h2>Snapshot</h2>
        <div className={`split${S?.screenshot ? "" : " one"}`}>
          <ul className="facts">
            {facts.map(([k, v]) => (
              <li key={k}>
                <span className="k">{k}</span>
                <span>{v}</span>
              </li>
            ))}
          </ul>
          {S?.screenshot && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="shot" src={S.screenshot} alt="Phone view of the website" />
          )}
        </div>
      </section>

      {findings.length > 0 && (
        <section>
          <h2>What we found</h2>
          {findings.map(([k, t], i) => (
            <div key={i} className="finding">
              <span className={`pill ${k}`}>{LABELS[k]}</span>
              <span>{t}</span>
            </div>
          ))}
        </section>
      )}

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
  const [pick, setPick] = useState<PitchKey>(built.order[0]);
  const [copied, setCopied] = useState(false);
  const all = [...built.order, ...(Object.keys(built.scripts) as PitchKey[]).filter((k) => !built.order.includes(k))];
  const s = built.scripts[pick];
  const tel = L.phone && L.phone !== "No phone listed" ? L.phone.replace(/[^0-9+]/g, "") : "";

  return (
    <div className="script">
      <div className="script-top">
        <h2>Call script</h2>
        <div className="script-tabs">
          {all.map((k) => (
            <button key={k} type="button" className={k === pick ? "on" : ""} onClick={() => setPick(k)}>
              {built.scripts[k].label}
              {built.order.includes(k) ? "" : " (not flagged)"}
            </button>
          ))}
        </div>
      </div>
      <div className="private">For you only. This section is left out when you print or save the audit.</div>
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
      <div className="step">
        <h3>Follow-up email (attach the printed audit as a PDF)</h3>
        <div className="email">{built.emailBody}</div>
        <button
          type="button"
          className="copy"
          onClick={() =>
            void navigator.clipboard.writeText(built.emailBody).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? "Copied" : "Copy email"}
        </button>
      </div>
    </div>
  );
}
