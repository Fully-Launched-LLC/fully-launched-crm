import type { Lead } from "@/lib/types";
import type { ExistingLead, RunResult, ScannedPlace, ServiceKey } from "@/lib/lead-finder/types";
import type { LatestTouch } from "@/lib/sales/outcomes";

// History view: a saved business (leads row) back into the shape the search
// results use, so the same detail panel shows both. Scan details come from
// leads.scan_tags, written by leadFromScan (lib/lead-finder/toLead.ts).

export type SalesLeadRow = Omit<Lead, "audit" | "contact_info" | "phone_digits">;

type ScanTagsJson = {
  tags?: ScannedPlace["tags"];
  services?: ServiceKey[];
  signals?: string[];
  tech?: string[];
  ads?: string[];
  socials?: string[];
  store?: string | null;
  hasBooking?: boolean | null;
  emails?: string[];
  contactPage?: string | null;
  shopify?: ScannedPlace["shopify"];
  marketplaces?: string[];
  complaints?: string[];
  hours?: string[] | null;
  site?: ScannedPlace["site"];
  photos?: number;
  webScore?: ScannedPlace["webScore"];
  socialLinks?: ScannedPlace["socialLinks"];
  gbp?: ScannedPlace["gbp"] | null;
  contacts?: ScannedPlace["contacts"] | null;
};

export function placeFromLead(l: SalesLeadRow): ScannedPlace {
  const s = (l.scan_tags ?? {}) as ScanTagsJson;
  return {
    id: l.google_place_id ?? l.id,
    name: l.company ?? l.name,
    address: l.address ?? "",
    phone: l.phone ?? "No phone listed",
    rating: typeof l.rating === "number" ? l.rating : "N/A",
    reviews: l.review_count ?? 0,
    category: l.category ?? "",
    website: l.website ?? "",
    websiteStatus: l.website_status ?? (l.website ? "Has website" : "No website"),
    socials: s.socials ?? [],
    store: s.store ?? null,
    hasBooking: s.hasBooking ?? null,
    tech: s.tech ?? [],
    ads: s.ads ?? [],
    emails: s.emails ?? (l.email ? [l.email] : []),
    ownerName: l.contact_name,
    contactPage: s.contactPage ?? null,
    shopify: s.shopify ?? null,
    marketplaces: s.marketplaces ?? [],
    signals: s.signals ?? [],
    complaints: s.complaints ?? [],
    tags: s.tags ?? { website: [], social: [], ecom: [], ai: [] },
    usesServiceTitan: l.uses_servicetitan,
    services: s.services ?? [],
    score: l.lead_score ?? 0,
    mapsUrl: l.maps_url ?? "",
    hours: s.hours ?? null,
    cid: l.external_ids?.cid ?? null,
    priority: l.priority_score ?? 0,
    site: s.site,
    photos: s.photos,
    webScore: s.webScore ?? null,
    socialLinks: s.socialLinks ?? {},
    gbp: s.gbp ?? undefined,
    contacts: s.contacts ?? undefined,
  };
}

export function existingFromLead(l: SalesLeadRow, latest: LatestTouch | null): ExistingLead {
  return {
    id: l.id,
    company: l.company,
    contact_name: l.contact_name,
    title: l.title,
    email: l.email,
    phone: l.phone,
    contact_linkedin: l.contact_linkedin,
    company_linkedin: l.company_linkedin,
    status: l.status,
    owner: l.owner,
    project_id: l.project_id,
    next_action: l.next_action,
    next_action_at: l.next_action_at,
    last_touch: latest,
    matched_on: "google_place_id",
  };
}

export function resultFromLead(l: SalesLeadRow, latest: LatestTouch | null): RunResult {
  return {
    google_place_id: l.google_place_id ?? l.id,
    search_type: l.industry,
    place: placeFromLead(l),
    existing: existingFromLead(l, latest),
  };
}
