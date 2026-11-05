import type { PageSpeed, ScannedPlace, WebScoreCache } from "@/lib/lead-finder/types";

// Website score (replaces Matteo's score in the Sales UI; his stays in
// exports as "Need score"). Shared by server and browser. Formulas are in
// CLAUDE.md (Sales > Website score): change both together.
//
// Quick (0 to 100), from what the scan already has:
//   no website / social page only / broken = 0, else
//   site loads 20 (very slow or blocked from checking: 10)
//   + https 10 + mobile viewport 10 + page title 8 + meta description 8
//   + H1 6 + LocalBusiness/Organization schema 10 + FAQ schema 8
//   + Google profile: hours 7, photos 7 (5+) or 4 (1 to 4), reviews 6 (25+) or 3 (10+).
// Full: round(quick / 2 + average(PageSpeed performance, SEO,
//   accessibility, best practices) / 2), once PageSpeed has run.

export const WEB_SCORE_TTL_MS = 30 * 24 * 3600 * 1000;

export function quickWebsiteScore(p: ScannedPlace): number {
  const status = p.websiteStatus;
  if (!p.website || status === "No website" || status === "Social page only" || status === "Broken") return 0;
  let s = status === "Has website" ? 20 : 10;
  const site = p.site;
  if (site) {
    if (site.https) s += 10;
    if (site.mobile) s += 10;
    if (site.title) s += 8;
    if (site.metaDescription) s += 8;
    if (site.h1) s += 6;
    if (site.localSchema) s += 10;
    if (site.faqSchema) s += 8;
  } else if (status === "Has website" && p.site === undefined) {
    // Scanned before these checks existed: https and mobile from the tags.
    const t = p.tags?.website ?? [];
    if (!t.some((x) => /not secure/i.test(x))) s += 10;
    if (!t.some((x) => /phones/i.test(x))) s += 10;
  }
  if (p.hours && p.hours.length) s += 7;
  const photos = p.photos ?? 0;
  s += photos >= 5 ? 7 : photos >= 1 ? 4 : 0;
  s += p.reviews >= 25 ? 6 : p.reviews >= 10 ? 3 : 0;
  return Math.min(100, s);
}

export function speedAverage(speed: WebScoreCache["speed"] | PageSpeed | null | undefined): number | null {
  if (!speed) return null;
  const vals = [speed.performance, speed.seo, speed.accessibility, speed.bestPractices].filter(
    (v): v is number => typeof v === "number"
  );
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export function freshWebScore(p: ScannedPlace, now = Date.now()): WebScoreCache | null {
  const w = p.webScore;
  return w && now - new Date(w.at).getTime() < WEB_SCORE_TTL_MS ? w : null;
}

export function websiteScore(p: ScannedPlace): { score: number; kind: "quick" | "full" } {
  const quick = quickWebsiteScore(p);
  const avg = quick > 0 ? speedAverage(p.webScore?.speed) : null;
  return avg == null ? { score: quick, kind: "quick" } : { score: Math.round(quick / 2 + avg / 2), kind: "full" };
}

// A real site worth a PageSpeed run.
export const hasRealSite = (p: ScannedPlace) =>
  !!p.website && p.websiteStatus !== "No website" && p.websiteStatus !== "Social page only" && p.websiteStatus !== "Broken";

export const PRIORITY_TIP = "Who to call first: established businesses with 1-2 clear gaps rank highest";
export const WEBSITE_SCORE_TIP = "Speed, SEO and AI-search readiness";

// Field-service software ("Runs on:" badge). Scanner tech names -> label.
const FIELD_SOFTWARE: [RegExp, string][] = [
  [/ServiceTitan/, "ServiceTitan"],
  [/^Housecall Pro$/, "Housecall Pro"],
  [/^Jobber$/, "Jobber"],
  [/^Service Fusion$/, "Service Fusion"],
  [/^FieldEdge$/, "FieldEdge"],
  [/^Workiz$/, "Workiz"],
  [/^Successware$/, "Successware"],
  [/^BuildOps$/, "BuildOps"],
  [/^ServiceTrade$/, "ServiceTrade"],
  [/^Kickserv$/, "Kickserv"],
  [/^GorillaDesk$/, "GorillaDesk"],
  [/^Service Autopilot$/, "Service Autopilot"],
  [/^JobNimbus$/, "JobNimbus"],
  [/^AccuLynx$/, "AccuLynx"],
];

export function fieldSoftware(tech: string[] | null | undefined): string[] {
  const out: string[] = [];
  (tech ?? []).forEach((t) => {
    const hit = FIELD_SOFTWARE.find(([re]) => re.test(t));
    if (hit && !out.includes(hit[1])) out.push(hit[1]);
  });
  return out;
}
