import type { RunResult, ScannedPlace } from "@/lib/lead-finder/types";
import { websiteScore } from "@/lib/lead-finder/websiteScore";
import { plugSoftware } from "@/lib/lead-finder/software";
import { defaultEmailKind, type EmailKind } from "@/lib/sales/emailTemplates";

// Branch-focused search modes (launch pad "Focus"). Every business keeps all
// its scores and badges; the mode only changes which results are included
// and how they're ranked in Mission Control, and which branch the email
// drafts and call script open on. Saved in lead_finder_runs.params.mode and
// saved_searches.params.mode (no mode = "all"). Change CLAUDE.md
// (Sales > Search modes) with this file.

export type SearchMode = "all" | "website" | "social" | "ai" | "ecom";

export const SEARCH_MODES: [SearchMode, string][] = [
  ["all", "All"],
  ["website", "Website"],
  ["social", "Social media"],
  ["ai", "AI"],
  ["ecom", "E-commerce"],
];

export const modeLabel = (m: SearchMode) => SEARCH_MODES.find(([k]) => k === m)?.[1] ?? "All";

export function asMode(v: unknown): SearchMode {
  return SEARCH_MODES.some(([k]) => k === v) ? (v as SearchMode) : "all";
}

// Sweep presets / service chips -> mode (servicetitan -> AI).
export function modeForServices(services: string[]): SearchMode {
  if (services.length === 1) {
    const s = services[0];
    if (s === "website" || s === "social" || s === "ecom" || s === "ai") return s;
    if (s === "servicetitan") return "ai";
  }
  return "all";
}

// Social strength: how many social channels their website links to. A
// social score from an Apify profile check can replace this later
// (ScannedPlace would carry it; rank by it here).
export function socialStrength(p: ScannedPlace): number {
  return p.socials?.length ?? 0;
}
const hasStrongSocial = (p: ScannedPlace) => (p.socials ?? []).some((s) => s === "Instagram" || s === "TikTok");

const deadSite = (p: ScannedPlace) =>
  !p.website || p.websiteStatus === "No website" || p.websiteStatus === "Broken" || p.websiteStatus === "Social page only";

// Which results a mode includes.
export function modeIncludes(r: RunResult, mode: SearchMode): boolean {
  const p = r.place;
  switch (mode) {
    case "website":
      return (deadSite(p) || websiteScore(p).score < 60) && defaultEmailKind(p) !== "ecom";
    case "social":
      return socialStrength(p) === 0 || !hasStrongSocial(p);
    case "ecom":
      return (p.marketplaces ?? []).length > 0;
    default:
      return true;
  }
}

// AI integration opportunity: field-service / CRM software first, then
// service businesses by review count, then everyone else.
function aiTier(p: ScannedPlace): number {
  if (plugSoftware(p.tech).length) return 0;
  if (p.serviceBusiness ?? p.tags.ai.length > 0) return 1;
  return 2;
}

// Ranking within a mode (before priority, which breaks ties).
export function modeCompare(a: RunResult, b: RunResult, mode: SearchMode): number {
  const pa = a.place;
  const pb = b.place;
  switch (mode) {
    case "website":
      return websiteScore(pa).score - websiteScore(pb).score;
    case "social":
      return socialStrength(pa) - socialStrength(pb);
    case "ai":
      return aiTier(pa) - aiTier(pb) || (aiTier(pa) === 1 ? pb.reviews - pa.reviews : 0);
    case "ecom":
      // More listing-quality gaps first, then fewer marketplaces (room to add more).
      return pb.tags.ecom.length - pa.tags.ecom.length || (pa.marketplaces ?? []).length - (pb.marketplaces ?? []).length;
    default:
      return 0;
  }
}

// Default branch for the email drafts and call script.
export function modeEmailKind(mode: SearchMode, p: ScannedPlace): EmailKind {
  return mode === "all" ? defaultEmailKind(p) : mode;
}

export const ECOM_MODE_NOTE = "Marketplace sources (Etsy, Shopify, Amazon, Faire, eBay) coming next";
