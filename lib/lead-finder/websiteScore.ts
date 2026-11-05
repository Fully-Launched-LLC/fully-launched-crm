import type { PageSpeed, ScannedPlace, WebScoreCache } from "@/lib/lead-finder/types";

// Website score (replaces Matteo's score in the Sales UI; his stays in
// exports as "Need score"). Shared by server and browser. Formulas are in
// CLAUDE.md (Sales > Website score): change both together.
//
// Every check has points possible, grouped (websiteChecks()):
//   Basics 30: site loads 15 (very slow, or blocked from checking: 8), https 8, mobile viewport 7
//   SEO 25:    page title 6, meta description 6, H1 5, sitemap.xml 3, business schema 5
//   AEO 25:    FAQ schema 7, business schema completeness 8 (name, address,
//              telephone, opening hours, url: 8 x found / 5), clear services list 5,
//              service-area / location text 5
//   Speed 20:  PageSpeed performance 15 (x performance / 100), load time 5
//              (largest paint 2.5 s or less 5, 4 s or less 3)
// No website / social page only / broken = 0 everywhere.
// Quick = (Basics + SEO + AEO earned) / 80 x 100, from the scan alone.
// Full = all four groups out of 100, once PageSpeed has run.

export const WEB_SCORE_TTL_MS = 30 * 24 * 3600 * 1000;

export type CheckGroup = "Basics" | "SEO" | "AEO" | "Speed";
export const CHECK_GROUPS: [CheckGroup, string][] = [
  ["Basics", "Basics"],
  ["SEO", "SEO"],
  ["AEO", "AEO / AI-search readiness"],
  ["Speed", "Speed"],
];

export type WebCheck = {
  group: CheckGroup;
  label: string;
  earned: number;
  possible: number;
  // Plain sentence for "What's missing" when earned < possible.
  missing: string;
  detail?: string;
};

function parseSeconds(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = t.replace(",", ".").match(/([\d.]+)\s*(ms|s)/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2].toLowerCase() === "ms" ? n / 1000 : n;
}

export function websiteChecks(p: ScannedPlace, speedOverride?: PageSpeed | null): WebCheck[] {
  const status = p.websiteStatus;
  const dead = !p.website || status === "No website" || status === "Social page only" || status === "Broken";
  const site = p.site;
  // Scans before these checks existed: https and mobile from the tags.
  const t = p.tags?.website ?? [];
  const legacy = status === "Has website" && p.site === undefined;
  const https = site ? site.https : legacy && !t.some((x) => /not secure/i.test(x));
  const mobile = site ? site.mobile : legacy && !t.some((x) => /phones/i.test(x));
  const fields = site?.schemaFields ?? [];
  const sp = speedOverride && !speedOverride.error ? speedOverride : p.webScore?.speed ?? null;
  const secs = parseSeconds(sp?.loadTime ?? null);
  const on = (ok: boolean | null | undefined, pts: number) => (!dead && ok ? pts : 0);

  return [
    {
      group: "Basics", label: "Site loads", possible: 15,
      earned: dead ? 0 : status === "Has website" ? 15 : 8,
      missing: dead ? (status === "Broken" ? "The website doesn't load" : "No real website") : "The site is very slow or blocks visitors",
      detail: status,
    },
    { group: "Basics", label: "Secure (https)", possible: 8, earned: on(https, 8), missing: "Not secure (no https padlock)" },
    { group: "Basics", label: "Set up for phones", possible: 7, earned: on(mobile, 7), missing: "Not set up for phones" },
    { group: "SEO", label: "Page title", possible: 6, earned: on(site?.title, 6), missing: "No page title" },
    { group: "SEO", label: "Meta description", possible: 6, earned: on(site?.metaDescription, 6), missing: "No meta description for Google to show" },
    { group: "SEO", label: "Main heading (H1)", possible: 5, earned: on(site?.h1, 5), missing: "No main heading (H1)" },
    {
      group: "SEO", label: "Sitemap", possible: 3, earned: on(site?.sitemap, 3),
      missing: site?.sitemap === null ? "Sitemap couldn't be checked" : "No sitemap.xml for Google",
    },
    { group: "SEO", label: "Business schema", possible: 5, earned: on(site?.localSchema, 5), missing: "No business schema (structured data) for Google" },
    { group: "AEO", label: "FAQ schema", possible: 7, earned: on(site?.faqSchema, 7), missing: "No FAQ schema, so AI search has no ready answers" },
    {
      group: "AEO", label: "Business schema completeness", possible: 8, earned: dead ? 0 : Math.round((8 * fields.length) / 5),
      missing: fields.length ? `Business schema is missing ${["name", "address", "telephone", "openingHours", "url"].filter((f) => !fields.includes(f)).map((f) => (f === "openingHours" ? "opening hours" : f)).join(", ")}` : "No business details (name, address, phone, hours) marked up for AI search",
      detail: fields.length ? `${fields.length} of 5 fields` : undefined,
    },
    { group: "AEO", label: "Clear services list", possible: 5, earned: on(site?.servicesList, 5), missing: "No clear list of services" },
    { group: "AEO", label: "Location / service area", possible: 5, earned: on(site?.serviceArea, 5), missing: "Doesn't say where they work (service area or city)" },
    {
      group: "Speed", label: "Google speed score (phone)", possible: 15,
      earned: dead || !sp || sp.performance == null ? 0 : Math.round((15 * sp.performance) / 100),
      missing: !sp ? "Speed not tested yet" : "Slow on phones",
      detail: sp?.performance != null ? `${sp.performance}/100` : undefined,
    },
    {
      group: "Speed", label: "Load time", possible: 5,
      earned: dead || secs == null ? 0 : secs <= 2.5 ? 5 : secs <= 4 ? 3 : 0,
      missing: secs == null ? "Load time not measured yet" : `Takes ${sp?.loadTime} to show on a phone`,
      detail: sp?.loadTime ?? undefined,
    },
  ];
}

export function quickWebsiteScore(p: ScannedPlace): number {
  const checks = websiteChecks(p).filter((c) => c.group !== "Speed");
  return Math.round((100 * checks.reduce((a, c) => a + c.earned, 0)) / 80);
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

export function websiteScore(p: ScannedPlace, speedOverride?: PageSpeed | null): { score: number; kind: "quick" | "full" } {
  const hasSpeed = speedOverride ? !speedOverride.error : !!p.webScore?.speed;
  if (!hasSpeed || quickWebsiteScore(p) === 0) return { score: quickWebsiteScore(p), kind: "quick" };
  return { score: websiteChecks(p, speedOverride).reduce((a, c) => a + c.earned, 0), kind: "full" };
}

// A real site worth a PageSpeed run.
export const hasRealSite = (p: ScannedPlace) =>
  !!p.website && p.websiteStatus !== "No website" && p.websiteStatus !== "Social page only" && p.websiteStatus !== "Broken";

export const PRIORITY_TIP = "Who to call first: established businesses with 1-2 clear gaps rank highest";
export const WEBSITE_SCORE_TIP = "Speed, SEO and AI-search readiness";

// Software groups moved to lib/lead-finder/software.ts.
export { fieldSoftware } from "@/lib/lead-finder/software";
