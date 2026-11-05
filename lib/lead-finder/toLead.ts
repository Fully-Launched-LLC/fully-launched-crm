import type { Branch } from "@/lib/theme";
import type { ScannedPlace, ServiceKey } from "@/lib/lead-finder/types";
import type { LeadInput } from "@/lib/leads/upsert";

// Scanner tag -> CRM branch. Shared by the results table's chips and the
// branch_fit written when a result is saved.
export const TAG_BRANCH: Record<ServiceKey, Branch> = {
  website: "Websites",
  social: "Media",
  ecom: "Ecommerce",
  ai: "AI",
};

export function branchFit(services: ServiceKey[]): Branch[] {
  return Array.from(new Set(services.map((s) => TAG_BRANCH[s])));
}

// "123 Main St, Wheaton, IL 60187, USA" -> city "Wheaton", state "IL".
// Best effort: Google's formattedAddress isn't structured.
export function cityState(address: string): { city: string | null; state: string | null } {
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return { city: null, state: null };
  const stateZip = parts[parts.length - 2];
  const state = stateZip.split(/\s+/)[0] || null;
  return { city: parts[parts.length - 3] || null, state };
}

// A scanned result as a new lead row. found_by/owner are set by the caller
// (the current team member).
export function leadFromScan(
  p: ScannedPlace,
  opts: { searchType: string | null; sourceDetail: string; memberId: string }
): LeadInput {
  const { city, state } = cityState(p.address);
  return {
    company: p.name,
    contact_name: p.ownerName,
    title: p.ownerName ? "Possible owner" : null,
    email: p.emails[0] ?? null,
    phone: p.phone && p.phone !== "No phone listed" ? p.phone : null,
    website: p.website || null,
    address: p.address || null,
    city,
    state,
    industry: opts.searchType,
    category: p.category || null,
    branch_fit: branchFit(p.services),
    source: "lead_finder",
    source_detail: opts.sourceDetail,
    external_ids: p.cid ? { cid: p.cid } : {},
    google_place_id: p.id,
    maps_url: p.mapsUrl,
    rating: typeof p.rating === "number" ? p.rating : null,
    review_count: p.reviews,
    website_status: p.websiteStatus,
    scan_tags: {
      tags: p.tags,
      services: p.services,
      signals: p.signals,
      tech: p.tech,
      ads: p.ads,
      socials: p.socials,
      store: p.store,
      hasBooking: p.hasBooking,
      emails: p.emails,
      contactPage: p.contactPage,
      shopify: p.shopify,
      marketplaces: p.marketplaces ?? [],
      complaints: p.complaints,
      hours: p.hours,
      site: p.site ?? null,
      photos: p.photos ?? 0,
      webScore: p.webScore ?? null,
      socialLinks: p.socialLinks ?? {},
      gbp: p.gbp ?? null,
    },
    lead_score: p.score,
    priority_score: p.priority,
    uses_servicetitan: p.usesServiceTitan,
    status: "new",
    found_by: opts.memberId,
    owner: opts.memberId,
  };
}
