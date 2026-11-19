import type { ServiceKey } from "@/lib/lead-finder/types";

// Shared Lead Finder constants and helpers, ported from Matteo's Lead Finder
// server.js. Pure, so the page can show the estimate without a request; the
// server recomputes it. Area sweeps (and their presets, tiles and plan) were
// removed Nov 2026: quick search only.

// Google's list price for a Text Search that includes reviews ("Enterprise +
// Atmosphere") is roughly $40 per 1,000 requests, before Google's monthly free
// allowance. Check the Google Cloud billing page for real numbers.
export const COST_PER_SEARCH = 0.04;

export const SEARCH_DEPTHS = [20, 40, 60] as const;

export const SERVICE_ORDER: ServiceKey[] = ["website", "social", "ecom", "ai"];

export const SERVICE_LABELS: Record<ServiceKey | "servicetitan", string> = {
  website: "Website",
  social: "Social media",
  ecom: "E-commerce",
  ai: "AI integration",
  servicetitan: "ServiceTitan users only",
};

export const STATES = ["Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "District of Columbia", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming"];

// Quick search: one Google request per 20 results.
export function searchPages(depth: number): number {
  return Math.ceil(Math.min(60, Math.max(20, depth || 20)) / 20);
}

export function locationPhrase(state: string, city: string, zip: string): string {
  let location = city ? `${city}, ${state}` : state;
  if (zip) location += ` ${zip}`;
  return location;
}
