"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import "@/components/lead-finder/lead-finder.css";
import { LF_FONT_VARS } from "@/components/lead-finder/fonts";
import Dropdown from "@/components/lead-finder/Dropdown";
import RocketStage, { type Phase } from "@/components/lead-finder/RocketStage";
import MissionControl, { type Svc } from "@/components/lead-finder/MissionControl";
import SalesHistory from "@/components/sales/SalesHistory";
import LocalDateTime from "@/components/LocalDateTime";
import { SessionExpiredError, apiFetch, readLastRun, writeLastRun } from "@/lib/lead-finder/apiFetch";
import { createClient } from "@/lib/supabase/client";
import type { TeamMember } from "@/lib/types";
import type { LeadFinderRun, RunProgress, RunResult, SearchParams, SweepParams } from "@/lib/lead-finder/types";
import {
  COST_PER_SEARCH,
  MAX_SWEEP_SEARCHES,
  SEARCH_DEPTHS,
  SERVICE_LABELS,
  SERVICE_ORDER,
  STATES,
  SWEEP_PRESETS,
  SWEEP_RADII,
  searchPages,
  sweepPlan,
} from "@/lib/lead-finder/sweep";

// Sales (/sales): Matteo's Lead Finder UI under one top bar with two views.
//   Find:    launch pad + mission control on the CRM's Supabase-backed runs.
//            POST /api/lead-finder/runs creates a run, this tab drives it
//            with /step calls while the rocket launches, and ?run=<id> lets
//            a refresh or a teammate open the same run.
//   History: every Sales business and its latest outcome (?view=history,
//            ?lead=<id> opens one).
// Styles: lead-finder.css, scoped to .lf-root.

type Mode = "search" | "sweep";
type View = "launch" | "mission";
type Tab = "find" | "history";

const ALL_ON: Svc = { website: true, social: true, ecom: true, ai: true, servicetitan: false };
const FINISHED = ["done", "failed", "cancelled"];
// A running run whose row hasn't changed in this long has no tab driving it.
const STALL_MS = 75_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const money = (n: number) => "$" + n.toFixed(2);

const ROCKET_ICON = (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2c3 2.5 4.5 6 4.5 10l-2 4h-5l-2-4C7.5 8 9 4.5 12 2z" />
    <circle cx="12" cy="9" r="1.6" />
    <path d="M9.5 16l-2.5 3h3M14.5 16l2.5 3h-3M12 18v4" />
  </svg>
);

function locationLabel(state: string, city: string, zip: string) {
  let l = city ? city + ", " + state : state;
  if (zip) l += " " + zip;
  return l;
}

export default function LeadFinder({
  member,
  members,
  recentRuns,
  initialRunId,
  fallbackRunId,
  initialTab,
  initialLeadId,
}: {
  member: TeamMember | null;
  members: TeamMember[];
  recentRuns: LeadFinderRun[];
  initialRunId: string | null;
  // This user's most recent run, for when there's no ?run= and nothing in localStorage.
  fallbackRunId: string | null;
  initialTab: Tab;
  initialLeadId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const canSweep = member?.role === "Admin" || member?.role === "Manager";
  const [view, setView] = useState<View>("launch");
  const [tab, setTab] = useState<Tab>(initialTab);

  // ---- Form ----
  const [mode, setMode] = useState<Mode>("search");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [zip, setZip] = useState("");
  const [type, setType] = useState("");
  const [depth, setDepth] = useState<number>(20);
  const [radius, setRadius] = useState<number>(5);
  const [svc, setSvc] = useState<Svc>(ALL_ON);
  const [typesText, setTypesText] = useState("");
  const [typesEdited, setTypesEdited] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // The sweep the user confirmed; any change to the form takes it back.
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const typeRef = useRef<HTMLInputElement>(null);
  const launchRef = useRef<HTMLButtonElement>(null);

  const stOnly = svc.servicetitan;
  const selectedServices = SERVICE_ORDER.filter((s) => svc[s]);
  const sweepServices = stOnly ? ["servicetitan"] : selectedServices;

  // Prefill sweep types from the presets until the user edits them.
  useEffect(() => {
    if (typesEdited) return;
    const list: string[] = [];
    sweepServices.forEach((s) =>
      (SWEEP_PRESETS[s as keyof typeof SWEEP_PRESETS] || []).forEach((t) => {
        if (!list.includes(t)) list.push(t);
      })
    );
    setTypesText(list.join("\n"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svc, typesEdited]);

  const plan = useMemo(
    () => sweepPlan({ radius, services: sweepServices, types: typesText }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [radius, typesText, svc]
  );

  const sweepKey = (f: { state: string; city: string; zip: string; radius: number; typesText: string; svc: Svc }) =>
    JSON.stringify([f.state, f.city, f.zip, f.radius, f.typesText, f.svc]);
  const confirmSweep = mode === "sweep" && confirmKey === sweepKey({ state, city, zip, radius, typesText, svc });
  const setConfirmSweep = (on: boolean) => setConfirmKey(on ? sweepKey({ state, city, zip, radius, typesText, svc }) : null);

  function toggleSvc(k: keyof Svc) {
    setSvc((prev) => ({ ...prev, [k]: !prev[k] }));
  }

  function starter(kind: "st" | "ai" | "web" | "ecom") {
    const only = (keys: (keyof Svc)[]) => {
      setSvc({ website: false, social: false, ecom: false, ai: false, servicetitan: false, ...Object.fromEntries(keys.map((k) => [k, true])) });
      setTypesEdited(false);
    };
    setState("Illinois");
    setZip("");
    if (kind === "st") { setMode("sweep"); setCity("Wheaton"); setRadius(5); only(["servicetitan"]); }
    if (kind === "ai") { setMode("sweep"); setCity("Wheaton"); setRadius(5); only(["ai"]); }
    if (kind === "web") { setMode("search"); setCity("Wheaton"); setType("barbershop"); only(["website", "social"]); }
    if (kind === "ecom") { setMode("search"); setCity("Naperville"); setType("boutique"); only(["ecom", "social"]); }
    setTimeout(() => launchRef.current?.focus(), 0);
  }

  function validate(): string | null {
    if (mode === "search") {
      if (!state || !type.trim()) return "Choose a state and enter a business type to search.";
    } else {
      if (!canSweep) return "Area sweeps are for Admins and Managers.";
      if (!state || !(city.trim() || zip.trim())) return "An area sweep needs a state plus a city or zip code to center on.";
      if (!plan.types.length) return "Pick at least one service or enter business types.";
      if (plan.tooBig) return `That sweep needs ${plan.searches} Google searches. The limit is ${MAX_SWEEP_SEARCHES}.`;
    }
    if (!stOnly && !selectedServices.length) return "Pick at least one service to hunt for.";
    return null;
  }

  // ---- Run ----
  const [runs, setRuns] = useState<LeadFinderRun[]>(recentRuns);
  const [run, setRun] = useState<LeadFinderRun | null>(null);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [results, setResults] = useState<RunResult[] | null>(null);
  const [driving, setDriving] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const setRunUrl = useCallback(
    (id: string | null) => router.replace(id ? `${pathname}?run=${id}` : pathname, { scroll: false }),
    [router, pathname]
  );
  // History URLs change in place (no server round trip per click).
  const setHistoryUrl = useCallback(
    (leadId: string | null) =>
      window.history.replaceState(null, "", `${pathname}?view=history${leadId ? `&lead=${leadId}` : ""}`),
    [pathname]
  );

  // Set when a request fails because the sign-in is really gone (refresh
  // failed too). State is kept; it clears itself once the session is back.
  const [sessionLost, setSessionLost] = useState(false);
  const sessionLostRef = useRef(false);
  sessionLostRef.current = sessionLost;

  const loadRun = useCallback(async (id: string, withResults: boolean, quiet = false) => {
    let json;
    try {
      const res = await apiFetch(`/api/lead-finder/runs/${id}${withResults ? "" : "?results=0"}`);
      json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not load that run.");
    } catch (e) {
      if (e instanceof SessionExpiredError) setSessionLost(true);
      else if (!quiet) setRunError((e as Error).message || "Could not load that run.");
      return null;
    }
    setRun(json.run);
    setProgress(json.progress);
    if (withResults) setResults(json.results);
    setRuns((prev) => prev.map((r) => (r.id === json.run.id ? json.run : r)));
    setNow(Date.now());
    return json.run as LeadFinderRun;
  }, []);

  // ---- Launch sequence: countdown, video, orbit (still scanning), touchdown ----
  const [phase, setPhase] = useState<Phase>("idle");
  const [count, setCount] = useState(3);
  const [aborted, setAborted] = useState(false);
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;
  const startFailed = useRef<string | null>(null);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showView(v: View) {
    setView(v);
    window.scrollTo(0, 0);
  }

  function resetStage() {
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoTimer.current = null;
    startFailed.current = null;
    setPhase("idle");
    setAborted(false);
  }

  function abort(msg: string) {
    resetStage();
    setAborted(true);
    setFormError(msg);
  }

  function openMission() {
    resetStage();
    showView("mission");
  }

  function newSearch() {
    resetStage();
    showView("launch");
    setTimeout(() => typeRef.current?.focus(), 0);
  }

  async function openRun(id: string, quiet = false): Promise<boolean> {
    resetStage();
    setRunError(null);
    setResults(null);
    setDriving(false);
    const r = await loadRun(id, false, quiet);
    if (!r) return false;
    setRunUrl(id);
    writeLastRun(member?.id, id);
    if (FINISHED.includes(r.status)) {
      await loadRun(id, true);
      showView("mission");
    } else {
      // Still running (another tab, a teammate, or a stalled run): watch it in orbit.
      showView("launch");
      setPhase("orbit");
    }
    return true;
  }

  // Find without ?run= (e.g. the Sales nav tab): reopen this user's last
  // opened run, else their most recent run, else the launch pad. Starting in
  // History, this waits until Find is opened.
  const restored = useRef(false);
  async function restoreFind() {
    if (restored.current) return;
    restored.current = true;
    if (initialRunId) return void openRun(initialRunId);
    const last = readLastRun(member?.id);
    if (last && (await openRun(last, true))) return;
    if (fallbackRunId && fallbackRunId !== last) await openRun(fallbackRunId, true);
  }
  useEffect(() => {
    if (initialTab === "find") void restoreFind();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function showTab(t: Tab) {
    setTab(t);
    window.scrollTo(0, 0);
    if (t === "history") return setHistoryUrl(null);
    if (run) setRunUrl(run.id);
    else router.replace(pathname, { scroll: false });
    void restoreFind();
  }

  // A lost sign-in clears itself: when the tab regains focus (e.g. after
  // signing in again in another tab, which shares the cookies), check again.
  useEffect(() => {
    if (!sessionLost) return;
    const check = async () => {
      const { data } = await createClient().auth.getUser();
      if (!data.user) return;
      setSessionLost(false);
      setRunError(null);
      if (run) await loadRun(run.id, FINISHED.includes(run.status));
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [sessionLost, run, loadRun]);

  function onLaunch() {
    if (phase !== "idle" && phase !== "touchdown") return;
    const problem = validate();
    setFormError(problem);
    if (problem) return;
    if (mode === "sweep" && !confirmSweep) {
      setConfirmSweep(true);
      return;
    }
    setConfirmSweep(false);
    launchWith(
      mode === "search"
        ? { kind: "search", state, city: city.trim(), zip: zip.trim(), type: type.trim(), depth, services: stOnly ? ["servicetitan"] : selectedServices }
        : { kind: "sweep", state, city: city.trim(), zip: zip.trim(), radius, services: sweepServices, types: typesText }
    );
  }

  function launchWith(body: Record<string, unknown>) {
    resetStage();
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) setPhase("orbit");
    else {
      setCount(3);
      setPhase("countdown");
    }
    void start(body); // the real search starts right away; the launch plays while it runs
  }

  // "Re-run for fresh data" (results older than 7 days): the same search
  // again, form filled in. A quick search launches right away; a sweep
  // (Admin/Manager) opens its cost confirm on the launch pad first.
  function rerun(r: LeadFinderRun) {
    const p = r.params as SearchParams & SweepParams;
    const services = p.services ?? [];
    const st = services.includes("servicetitan");
    const nextSvc: Svc = {
      website: !st && services.includes("website"),
      social: !st && services.includes("social"),
      ecom: !st && services.includes("ecom"),
      ai: !st && services.includes("ai"),
      servicetitan: st,
    };
    setState(p.state);
    setCity(p.city ?? "");
    setZip(p.zip ?? "");
    setSvc(nextSvc);
    setFormError(null);
    showView("launch");
    if (r.kind === "search") {
      setMode("search");
      setType(p.type);
      setDepth(p.depth);
      launchWith({ kind: "search", state: p.state, city: p.city, zip: p.zip, type: p.type, depth: p.depth, services });
    } else {
      const text = (p.types ?? []).join("\n");
      setMode("sweep");
      setRadius(p.radius);
      setTypesEdited(true);
      setTypesText(text);
      resetStage();
      setConfirmKey(sweepKey({ state: p.state, city: p.city ?? "", zip: p.zip ?? "", radius: p.radius, typesText: text, svc: nextSvc }));
    }
  }

  async function start(body: Record<string, unknown>) {
    setRunError(null);
    setResults(null);
    setDriving(false);
    let json: { run?: LeadFinderRun; progress?: RunProgress; error?: string };
    try {
      const res = await apiFetch("/api/lead-finder/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "The search could not start.");
    } catch (e) {
      if (e instanceof SessionExpiredError) setSessionLost(true);
      startFailed.current = (e as Error).message || "The search could not start.";
      // During the countdown the abort happens when it reaches zero (his order).
      if (phaseRef.current !== "countdown") abort(startFailed.current);
      return;
    }
    setRun(json.run!);
    setProgress(json.progress!);
    setRuns((prev) => [json.run!, ...prev.filter((r) => r.id !== json.run!.id)].slice(0, 15));
    setRunUrl(json.run!.id);
    writeLastRun(member?.id, json.run!.id);
    setDriving(true);
  }

  // 3-2-1 countdown, 700ms a tick.
  useEffect(() => {
    if (phase !== "countdown") return;
    const t = setTimeout(() => {
      if (count > 1) return setCount(count - 1);
      if (startFailed.current) return abort(startFailed.current);
      setPhase("flying");
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, count]);

  // Touchdown once the flight is over and the run has finished with results.
  const finished = !!run && !!progress && FINISHED.includes(progress.status);
  useEffect(() => {
    if (phase !== "orbit" || !run || !progress || !finished) return;
    if (progress.status === "failed") {
      abort(progress.error || run.error || "Something went wrong.");
      return;
    }
    if (!results) return;
    setPhase("touchdown");
    autoTimer.current = setTimeout(() => openMission(), 2200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, finished, results, run?.id]);

  // This tab drives the run: step until it's finished.
  useEffect(() => {
    if (!driving || !run) return;
    let cancelled = false;
    const id = run.id;
    (async () => {
      while (!cancelled) {
        let json: { progress?: RunProgress; busy?: boolean; error?: string };
        try {
          const res = await apiFetch(`/api/lead-finder/runs/${id}/step`, { method: "POST" });
          json = await res.json();
          if (!res.ok) throw new Error(json.error ?? "The run stopped.");
        } catch (e) {
          if (cancelled) return;
          if (e instanceof SessionExpiredError) {
            // The run is saved server-side; nothing to reload until sign-in is back.
            setSessionLost(true);
            setRunError("Paused: your sign-in expired. Sign in again, then press Resume.");
            setDriving(false);
            return;
          }
          setRunError((e as Error).message + " Use Resume to continue.");
          setDriving(false);
          await loadRun(id, false);
          return;
        }
        if (cancelled) return;
        setProgress(json.progress!);
        setNow(Date.now());
        if (FINISHED.includes(json.progress!.status)) {
          setDriving(false);
          await loadRun(id, true);
          return;
        }
        if (json.busy) await sleep(3000);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [driving, run?.id, loadRun]); // eslint-disable-line react-hooks/exhaustive-deps

  // Someone else is driving (another tab or team member): poll progress.
  const running = !!run && !FINISHED.includes(run.status) && !FINISHED.includes(progress?.status ?? "");
  useEffect(() => {
    if (!run || driving || !running) return;
    const id = run.id;
    const t = setInterval(async () => {
      if (sessionLostRef.current) return;
      const r = await loadRun(id, false);
      if (r && FINISHED.includes(r.status)) await loadRun(id, true);
    }, 4000);
    return () => clearInterval(t);
  }, [run?.id, driving, running, loadRun]); // eslint-disable-line react-hooks/exhaustive-deps

  const canDrive = !!run && !!member && (canSweep || run.run_by === member.id);
  const stalled = running && !driving && now - new Date(run!.updated_at).getTime() > STALL_MS;

  async function cancel() {
    if (!run) return;
    setDriving(false);
    try {
      const res = await apiFetch(`/api/lead-finder/runs/${run.id}/cancel`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) setRunError(json.error ?? "Could not cancel.");
    } catch (e) {
      if (e instanceof SessionExpiredError) setSessionLost(true);
      else setRunError("Could not cancel.");
      return;
    }
    await loadRun(run.id, true);
  }

  function resume() {
    setRunError(null);
    setDriving(true);
  }

  // ---- Progress text (Matteo's: searches first, then website checks) ----
  let stageText = "";
  let pct: number | null = null;
  if (progress && run && running) {
    if (progress.done_searches < progress.planned_searches) {
      stageText =
        run.kind === "search"
          ? `Scanning Google for “${(run.params as { type?: string }).type ?? ""}” · ${locationLabel(run.params.state, run.params.city, run.params.zip)}`
          : `Searching Google: ${progress.done_searches} of ${progress.planned_searches} searches`;
      pct = run.kind === "search" ? null : 40 * (progress.done_searches / Math.max(1, progress.planned_searches));
    } else {
      stageText = `Checking websites: ${progress.scanned} of ${progress.found} businesses checked`;
      pct = progress.found ? 40 + 60 * (progress.scanned / progress.found) : 40;
    }
  }

  const statusText = aborted
    ? "Mission aborted"
    : phase === "countdown"
      ? `Ignition sequence · T-minus ${count}`
      : phase === "flying"
        ? `Liftoff · ${stageText || "scanning"}`
        : phase === "orbit"
          ? "In orbit · scanning"
          : phase === "touchdown"
            ? "Touchdown · results in"
            : "Systems ready";
  const busyPill = phase === "countdown" || phase === "flying" || phase === "orbit";

  // His touchdown count: businesses matching the chosen services.
  const matched = (results ?? []).filter((r) =>
    svc.servicetitan ? r.place.usesServiceTitan : r.place.services.some((s) => selectedServices.includes(s))
  ).length;

  const memberName = (id: string | null) => members.find((m) => m.id === id)?.name ?? "Unknown";

  let card: React.ReactNode = null;
  if (phase === "orbit" && run) {
    card = (
      <div className="stage-card">
        <span className="kicker">In orbit · scanning</span>
        <span className="card-title">Checking every business</span>
        <span className="card-text">
          {stalled ? "Paused: no one is running this right now." : stageText || "Checking websites, socials and stores…"}
        </span>
        <div className={`orbit-bar${pct == null ? " indet" : ""}`}>
          <div style={{ width: `${pct == null ? 35 : Math.max(2, pct)}%` }} />
        </div>
        {!driving && !stalled && !runError && running && (
          <span className="hint">Running in another tab or by another team member. Progress updates here.</span>
        )}
        {runError && <span className="error" role="alert">{runError}</span>}
        <div className="card-btns">
          {running && canDrive && (stalled || runError) && (
            <button type="button" className="btn btn-gold" onClick={resume}>Resume</button>
          )}
          {running && canDrive && (
            <button type="button" className="btn" onClick={() => void cancel()}>Cancel</button>
          )}
          {!driving && (
            <button type="button" className="btn" onClick={resetStage}>Close</button>
          )}
        </div>
      </div>
    );
  } else if (phase === "orbit") {
    card = (
      <div className="stage-card">
        <span className="kicker">In orbit · scanning</span>
        <span className="card-title">Checking every business</span>
        <span className="card-text">Starting the search…</span>
        <div className="orbit-bar indet"><div style={{ width: "35%" }} /></div>
      </div>
    );
  } else if (phase === "touchdown" && run) {
    card = (
      <div className="stage-card">
        <span className="kicker">{run.status === "cancelled" ? "Mission cancelled" : "Touchdown"}</span>
        <span className="big">
          {matched} match{matched === 1 ? "" : "es"}
        </span>
        <span className="card-text">
          {run.params.label} · {results?.length ?? 0} businesses checked
        </span>
        <button type="button" className="btn-launch" style={{ justifyContent: "center" }} onClick={openMission}>
          Open mission control
        </button>
      </div>
    );
  }

  const launching = phase === "countdown" || phase === "flying" || phase === "orbit";
  const pages = searchPages(depth);
  const onEnter = (e: React.KeyboardEvent) => e.key === "Enter" && onLaunch();

  const serviceChips = (
    <div className={`chips${stOnly ? " st-mode" : ""}`}>
      {[...SERVICE_ORDER, "servicetitan" as const].map((k) => (
        <button key={k} type="button" className="chip" data-s={k} aria-pressed={svc[k]} onClick={() => toggleSvc(k)}>
          <i />
          {SERVICE_LABELS[k]}
        </button>
      ))}
    </div>
  );

  return (
    <div className={`lf-root ${LF_FONT_VARS}`}>
      <header className="top">
        <div className="top-in">
          <div className="brand">
            <div className="mark">FL</div>
            <div>
              <b>Sales</b>
              <small>FullyLaunched</small>
            </div>
          </div>
          <nav className="views" aria-label="Sales">
            <button type="button" aria-current={tab === "find" ? "page" : undefined} onClick={() => showTab("find")}>
              Find
            </button>
            <button type="button" aria-current={tab === "history" ? "page" : undefined} onClick={() => showTab("history")}>
              History
            </button>
          </nav>
        </div>
      </header>

      {sessionLost && (
        <div className="session-banner" role="alert">
          <span>Your sign-in expired. Your search and results are saved.</span>
          <a className="btn btn-gold" href={`/login?next=${encodeURIComponent(run ? `/sales?run=${run.id}` : "/sales")}`} target="_blank" rel="noopener">
            Sign in again
          </a>
          <span className="hint">Opens in a new tab. Come back here afterwards and this page picks up where it was.</span>
        </div>
      )}

      {tab === "find" && view === "launch" && (
        <div className="launch-view">
          <div className="nebula" aria-hidden="true" />

          <main className="launch-main">
            {/* Rocket left, console right; stacked (console first) on phones via CSS order. */}
            <RocketStage phase={phase} count={count} onFlightDone={() => setPhase((p) => (p === "flying" ? "orbit" : p))} card={card} />
            <section className="lead-col">
              <span className={`pill${busyPill ? " busy" : ""}`}>
                <i />
                <span>{statusText}</span>
              </span>
              <h1 className="hero">Find your next client before anyone else does.</h1>
              <p className="sub">
                Pick a market and the services you’re selling. We scan Google, check every business’s website, score what it’s missing and rank the best prospects first.
              </p>

              <div className="console">
                <div className="modes-row">
                  <div className="modes" role="tablist" aria-label="Search mode">
                    <button type="button" role="tab" aria-selected={mode === "search"} onClick={() => setMode("search")}>
                      Quick search
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === "sweep"}
                      disabled={!canSweep}
                      title={canSweep ? undefined : "Area sweeps are for Admins and Managers."}
                      onClick={() => setMode("sweep")}
                    >
                      Area sweep
                    </button>
                  </div>
                  {!canSweep && <span className="note">Area sweeps are for Admins and Managers.</span>}
                </div>

                <div className="grid loc">
                  <div className="f">
                    <span className="lt">State</span>
                    <Dropdown label="State" value={state} onChange={setState} placeholder="Choose a state" filter options={STATES.map((s) => ({ value: s, label: s }))} />
                  </div>
                  <label className="f">
                    <span className="lt">City <em>optional</em></span>
                    <input className="field" type="text" placeholder="Wheaton" value={city} onChange={(e) => setCity(e.target.value)} onKeyDown={onEnter} />
                  </label>
                  <label className="f">
                    <span className="lt">Zip <em>optional</em></span>
                    <input className="field" type="text" placeholder="60187" inputMode="numeric" maxLength={10} value={zip} onChange={(e) => setZip(e.target.value)} onKeyDown={onEnter} />
                  </label>
                </div>

                {mode === "search" ? (
                  <div className="grid qs">
                    <label className="f">
                      <span className="lt">Business type</span>
                      <input ref={typeRef} className="field" type="text" placeholder="HVAC, barbershop…" value={type} onChange={(e) => setType(e.target.value)} onKeyDown={onEnter} />
                    </label>
                    <div className="f">
                      <span className="lt">How many</span>
                      <Dropdown
                        label="How many"
                        value={String(depth)}
                        onChange={(v) => setDepth(Number(v))}
                        options={SEARCH_DEPTHS.map((d) => ({ value: String(d), label: `${d} businesses` }))}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid">
                    <div className="f">
                      <span className="lt">Radius around that city or zip</span>
                      <Dropdown
                        label="Radius around that city or zip"
                        value={String(radius)}
                        onChange={(v) => setRadius(Number(v))}
                        options={SWEEP_RADII.map((r) => ({ value: String(r), label: `${r} miles` }))}
                      />
                    </div>
                  </div>
                )}

                <div>
                  <div className="note" style={{ marginBottom: 8, fontWeight: 700, color: "var(--faint)" }}>Hunt for</div>
                  {serviceChips}
                </div>

                {mode === "sweep" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <label className="f">
                      <span className="lt">Business types to sweep <em>one per line</em></span>
                      <textarea
                        className="field"
                        value={typesText}
                        onChange={(e) => {
                          setTypesEdited(true);
                          setTypesText(e.target.value);
                        }}
                      />
                    </label>
                    {confirmSweep && !plan.tooBig ? (
                      <div className="estimate confirm" role="alertdialog" aria-label="Confirm sweep">
                        <span>
                          <b>Launch this sweep?</b> {plan.searches} searches + 1 location lookup = <b>{plan.totalRequests} Google requests</b>, about{" "}
                          <b>{money(plan.estCost)}</b> at Google’s list price, before your monthly free allowance.
                        </span>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button type="button" className="btn btn-gold" onClick={onLaunch}>Confirm launch</button>
                          <button type="button" className="btn" onClick={() => setConfirmSweep(false)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className={`estimate${plan.tooBig ? " over" : ""}`}>
                        {plan.tooBig ? (
                          <>
                            <b>Too big to run:</b> {plan.searches} Google searches (the limit is {MAX_SWEEP_SEARCHES}). Shrink the radius or remove some business types.
                          </>
                        ) : (
                          <>
                            <b>{plan.searches} Google searches</b> + 1 location lookup: {plan.types.length} types across {plan.tiles}{" "}
                            {plan.tiles === 1 ? "map area" : "map areas"}. About <b>{money(plan.estCost)}</b> at Google’s list price, before your monthly free allowance.
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {formError && <div className="error" role="alert">{formError}</div>}

                <div className="row">
                  <p className="note">
                    {mode === "search"
                      ? `Searches one business type and checks every website it finds. ${pages} Google ${pages === 1 ? "request" : "requests"}, about ${money(
                          pages * COST_PER_SEARCH
                        )} at list price. 60 businesses can take about a minute.`
                      : "Searches every type below across the whole area, removes duplicates and ranks everything together. Keep this tab open while it runs."}
                  </p>
                  <button ref={launchRef} type="button" className="btn-launch" disabled={launching} onClick={onLaunch}>
                    {ROCKET_ICON}
                    <span>{launching ? "Launching…" : "Launch search"}</span>
                  </button>
                </div>
              </div>

              <div className="missions">
                <span>Saved missions</span>
                {canSweep && (
                  <>
                    <button type="button" className="chip" onClick={() => starter("st")}>ServiceTitan users · Wheaton</button>
                    <button type="button" className="chip" onClick={() => starter("ai")}>AI prospects · 5 mi of Wheaton</button>
                  </>
                )}
                <button type="button" className="chip" onClick={() => starter("web")}>Barbershops · Wheaton</button>
                <button type="button" className="chip" onClick={() => starter("ecom")}>Boutiques · Naperville</button>
              </div>

              {runs.length > 0 && (
                <div className="panel recent">
                  <h2>Recent searches</h2>
                  {runs.map((r) => (
                    <button key={r.id} type="button" className="r" aria-current={r.id === run?.id} onClick={() => void openRun(r.id)}>
                      <div style={{ minWidth: 0 }}>
                        <div className="r-name">{r.params.label}</div>
                        <div className="r-meta">
                          {r.kind === "sweep" ? "Area sweep" : "Quick search"} · {memberName(r.run_by)} · <LocalDateTime iso={r.created_at} />
                        </div>
                      </div>
                      <div className="r-right">
                        {r.status === "done" ? `${r.result_count} found` : r.status === "running" || r.status === "queued" ? "In flight" : r.status === "cancelled" ? "Cancelled" : "Failed"}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </main>
        </div>
      )}

      {tab === "find" && view === "mission" && run && results && (
        <div className="mission-view">
          <MissionControl
            key={run.id}
            run={run}
            results={results}
            members={members}
            me={member}
            svc={svc}
            onToggleSvc={toggleSvc}
            onNewSearch={newSearch}
            onRerun={run.kind === "search" || canSweep ? () => rerun(run) : null}
          />
        </div>
      )}

      {tab === "history" && (
        <div className="mission-view">
          <SalesHistory me={member} members={members} initialLeadId={initialLeadId} onSelect={setHistoryUrl} />
        </div>
      )}
    </div>
  );
}
