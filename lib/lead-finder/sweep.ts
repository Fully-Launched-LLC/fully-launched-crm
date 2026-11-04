import type { LatLng, ServiceKey, Tile } from "@/lib/lead-finder/types";

// Ported from Matteo's Lead Finder server.js (sweep section). Pure, so the
// page can show the estimate without a request; the server recomputes it.

// Business types we sweep for each service. Edit these lists any time.
export const SWEEP_PRESETS: Record<ServiceKey | "servicetitan", string[]> = {
  ai: ["HVAC company", "plumber", "electrician", "roofing contractor", "dentist", "law firm", "accounting firm", "property management company", "insurance agency", "auto repair shop"],
  website: ["barbershop", "hair salon", "landscaping company", "auto repair shop", "restaurant", "cleaning service", "general contractor", "pest control"],
  social: ["restaurant", "cafe", "gym", "hair salon", "nail salon", "boutique", "bakery", "med spa"],
  ecom: ["boutique", "bakery", "florist", "gift shop", "candle shop", "jewelry store", "coffee roaster", "pet store"],
  // Trades that commonly run on ServiceTitan.
  servicetitan: ["HVAC company", "plumber", "electrician", "garage door company", "roofing contractor", "water heater service",
    "water treatment company", "pest control", "appliance repair", "septic service", "chimney service", "water damage restoration"],
};

export const MAX_SWEEP_SEARCHES = 150;

// Google's list price for a Text Search that includes reviews ("Enterprise +
// Atmosphere") is roughly $40 per 1,000 requests, before Google's monthly free
// allowance. Check the Google Cloud billing page for real numbers.
export const COST_PER_SEARCH = 0.04;

export const SEARCH_DEPTHS = [20, 40, 60] as const;
export const SWEEP_RADII = [3, 5, 10, 25] as const;

export const SERVICE_ORDER: ServiceKey[] = ["website", "social", "ecom", "ai"];

export const SERVICE_LABELS: Record<ServiceKey | "servicetitan", string> = {
  website: "Website",
  social: "Social media",
  ecom: "E-commerce",
  ai: "AI integration",
  servicetitan: "ServiceTitan users only",
};

export const STATES = ["Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "District of Columbia", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming"];

export function sweepTypes(services: string[], customTypes: string): string[] {
  const custom = (customTypes || "").split(/[\n,]/).map((t) => t.trim()).filter(Boolean);
  if (custom.length) return Array.from(new Set(custom));
  const list: string[] = [];
  (services || []).forEach((s) =>
    (SWEEP_PRESETS[s as keyof typeof SWEEP_PRESETS] || []).forEach((t) => list.push(t))
  );
  return Array.from(new Set(list));
}

export function tileCount(radiusMiles: number): number {
  return radiusMiles <= 3 ? 1 : radiusMiles <= 8 ? 4 : 9;
}

/** Split the area around a center point into a grid of map rectangles. */
export function makeTiles(center: LatLng, radiusMiles: number): Tile[] {
  const n = radiusMiles <= 3 ? 1 : radiusMiles <= 8 ? 2 : 3; // 1, 4 or 9 tiles
  const latMiles = 69;
  const lngMiles = 69 * Math.cos((center.latitude * Math.PI) / 180);
  const south = center.latitude - radiusMiles / latMiles;
  const west = center.longitude - radiusMiles / lngMiles;
  const stepLat = (2 * radiusMiles) / latMiles / n;
  const stepLng = (2 * radiusMiles) / lngMiles / n;
  const tiles: Tile[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      tiles.push({
        low: { latitude: south + i * stepLat, longitude: west + j * stepLng },
        high: { latitude: south + (i + 1) * stepLat, longitude: west + (j + 1) * stepLng },
      });
    }
  }
  return tiles;
}

export type SweepPlan = {
  radius: number;
  types: string[];
  tiles: number;
  searches: number; // types x tiles (what the 150 cap applies to)
  totalRequests: number; // searches + 1 center lookup
  estCost: number; // totalRequests x COST_PER_SEARCH, list price
  tooBig: boolean;
};

export function sweepPlan(q: { radius: number | string; services: string[]; types: string }): SweepPlan {
  const radius = Math.min(25, Math.max(1, parseFloat(String(q.radius)) || 5));
  const types = sweepTypes(q.services, q.types);
  const tiles = tileCount(radius);
  const searches = types.length * tiles;
  const totalRequests = searches + 1;
  return {
    radius,
    types,
    tiles,
    searches,
    totalRequests,
    estCost: +(totalRequests * COST_PER_SEARCH).toFixed(2),
    tooBig: searches > MAX_SWEEP_SEARCHES,
  };
}

// Quick search: one Google request per 20 results.
export function searchPages(depth: number): number {
  return Math.ceil(Math.min(60, Math.max(20, depth || 20)) / 20);
}

export function locationPhrase(state: string, city: string, zip: string): string {
  let location = city ? `${city}, ${state}` : state;
  if (zip) location += ` ${zip}`;
  return location;
}
