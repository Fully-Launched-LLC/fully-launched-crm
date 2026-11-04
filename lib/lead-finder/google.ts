import "server-only";
import type { LatLng, PageSpeed } from "@/lib/lead-finder/types";

// Google calls for the Lead Finder, ported from Matteo's server.js. Two
// server-only keys (never NEXT_PUBLIC_):
//   GOOGLE_PLACES_API_KEY    Places API (New): Text Search + Place Details
//   GOOGLE_PAGESPEED_API_KEY PageSpeed Insights (audit only)
//
// Cost per call (list price, before Google's monthly free allowance):
//   Text Search with this field mask (includes reviews): Enterprise +
//   Atmosphere, about $0.04. Place Details (same fields): about $0.025.
//   The sweep's center lookup only asks for places.location (Pro SKU).

// Only ask Google for exactly the fields we use: keeps each search fast and cheap.
export const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.rating",
  "places.userRatingCount",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.regularOpeningHours",
  "places.types",
  "places.primaryTypeDisplayName",
  "places.businessStatus",
  "places.reviews",
  "nextPageToken",
].join(",");

// The subset of a Places API (New) place that the scanner reads.
export type GooglePlace = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  websiteUri?: string;
  googleMapsUri?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  types?: string[];
  primaryTypeDisplayName?: { text?: string };
  businessStatus?: string;
  reviews?: { text?: { text?: string }; originalText?: { text?: string } }[];
  location?: LatLng;
};

export class LeadFinderConfigError extends Error {}

function placesKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new LeadFinderConfigError("GOOGLE_PLACES_API_KEY is not set on the server.");
  return key;
}

/** One Google Text Search request. Returns { places, nextPageToken } or throws a friendly error. */
export async function googleTextSearch(
  body: Record<string, unknown>,
  fieldMask: string = FIELD_MASK
): Promise<{ places: GooglePlace[]; nextPageToken?: string }> {
  const resp = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": placesKey(), "X-Goog-FieldMask": fieldMask },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await resp.text();
  let data: { places?: GooglePlace[]; nextPageToken?: string; error?: { message?: string } };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Could not reach Google. Double-check the internet connection and that the Places API key is valid.");
  }
  if (!resp.ok) {
    const message = (data.error && data.error.message) || "Unknown error from Google.";
    throw new Error(`Google returned an error: ${message} This usually means the Places API key is missing, invalid, or "Places API (New)" is not enabled in Google Cloud.`);
  }
  return { places: data.places || [], nextPageToken: data.nextPageToken };
}

/** Full details for one business (used by the audit). */
export async function googlePlaceDetails(placeId: string): Promise<GooglePlace> {
  const mask = FIELD_MASK.split(",")
    .filter((f) => f !== "nextPageToken")
    .map((f) => f.replace(/^places\./, ""))
    .join(",");
  const resp = await fetch("https://places.googleapis.com/v1/places/" + encodeURIComponent(placeId), {
    headers: { "X-Goog-Api-Key": placesKey(), "X-Goog-FieldMask": mask },
    cache: "no-store",
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error((data.error && data.error.message) || "Could not load that business from Google.");
  return data as GooglePlace;
}

/** Center of a city/zip, for sweep tiles. One Text Search (Pro SKU). */
export async function googleLocate(phrase: string): Promise<LatLng | null> {
  const center = await googleTextSearch({ textQuery: phrase, pageSize: 1 }, "places.location");
  const loc = center.places[0]?.location;
  return loc ? { latitude: loc.latitude, longitude: loc.longitude } : null;
}

/** PageSpeed Insights, mobile. timeoutMs defaults to Matteo's 60s. */
export async function pageSpeed(url: string, timeoutMs = 60000): Promise<PageSpeed> {
  const key = process.env.GOOGLE_PAGESPEED_API_KEY;
  if (!key) return { error: "GOOGLE_PAGESPEED_API_KEY is not set on the server." };
  const params = new URLSearchParams({ url, strategy: "mobile", key });
  ["performance", "seo", "accessibility", "best-practices"].forEach((c) => params.append("category", c));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch("https://www.googleapis.com/pagespeedonline/v5/runPagespeed?" + params, {
      signal: controller.signal,
      cache: "no-store",
    });
    const data = await resp.json();
    if (!resp.ok) return { error: (data.error && data.error.message) || "PageSpeed check failed." };
    const lh = data.lighthouseResult || {};
    const cats = lh.categories || {};
    const audits = lh.audits || {};
    const pct = (c: string) => (cats[c] && cats[c].score != null ? Math.round(cats[c].score * 100) : null);
    return {
      performance: pct("performance"),
      seo: pct("seo"),
      accessibility: pct("accessibility"),
      bestPractices: pct("best-practices"),
      loadTime: audits["largest-contentful-paint"] && audits["largest-contentful-paint"].displayValue,
      screenshot: audits["final-screenshot"] && audits["final-screenshot"].details && audits["final-screenshot"].details.data,
    };
  } catch (e) {
    return { error: (e as Error).name === "AbortError" ? "PageSpeed took too long." : "PageSpeed check failed." };
  } finally {
    clearTimeout(timer);
  }
}
