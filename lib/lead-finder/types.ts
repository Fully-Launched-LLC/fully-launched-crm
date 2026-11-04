// Shapes shared by the Lead Finder server code (lib/lead-finder/*, the
// app/api/lead-finder routes) and the client page.

export type ServiceKey = "website" | "social" | "ecom" | "ai";

export type ScanTags = Record<ServiceKey, string[]>;

export type ShopifyInfo = {
  products: number;
  capped?: boolean;
  noPhoto: number;
  fewPhotos: number;
  thinDescription: number;
};

// One scanned business. Same fields as Matteo's scanner.js scanPlace()
// output, plus cid (from mapsUrl) and priority (lib/lead-finder/priority.ts).
export type ScannedPlace = {
  id: string;
  name: string;
  address: string;
  phone: string; // "No phone listed" when Google has none (Matteo's value)
  rating: number | "N/A";
  reviews: number;
  category: string;
  website: string;
  websiteStatus: string;
  socials: string[];
  store: string | null;
  hasBooking: boolean | null;
  tech: string[];
  ads: string[];
  emails: string[];
  ownerName: string | null;
  contactPage: string | null;
  shopify: ShopifyInfo | null;
  signals: string[];
  complaints: string[];
  tags: ScanTags;
  usesServiceTitan: boolean;
  services: ServiceKey[];
  score: number;
  mapsUrl: string;
  hours: string[] | null;
  cid: string | null;
  priority: number;
};

// PageSpeed Insights result; when `error` is set the scores are absent.
export type PageSpeed = {
  performance?: number | null;
  seo?: number | null;
  accessibility?: number | null;
  bestPractices?: number | null;
  loadTime?: string;
  screenshot?: string;
  error?: string;
};

export type Recommendation = { title: string; why: string };

export type RunKind = "search" | "sweep";
export type RunStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export type LatLng = { latitude: number; longitude: number };
export type Tile = { low: LatLng; high: LatLng };

export type SearchParams = {
  state: string;
  city: string;
  zip: string;
  type: string;
  depth: number;
  services: string[];
  label: string;
  next_page_token?: string | null;
  lease_until?: string | null;
};

export type SweepParams = {
  state: string;
  city: string;
  zip: string;
  radius: number;
  services: string[];
  types: string[];
  tiles: Tile[];
  label: string;
  lease_until?: string | null;
};

export type LeadFinderRun = {
  id: string;
  kind: RunKind;
  params: SearchParams | SweepParams;
  planned_searches: number;
  done_searches: number;
  est_cost: number | null;
  status: RunStatus;
  result_count: number;
  error: string | null;
  run_by: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

// What the results table shows next to a result that's already a lead.
export type ExistingLead = {
  id: string;
  company: string | null;
  status: string;
  owner: string | null;
  last_touch_at: string | null;
  last_touch_channel: string | null;
  matched_on: "google_place_id" | "cid" | "email" | "domain" | "phone";
};

export type RunResult = {
  google_place_id: string;
  search_type: string | null;
  place: ScannedPlace;
  existing: ExistingLead | null;
};

export type RunProgress = {
  status: RunStatus;
  done_searches: number;
  planned_searches: number;
  found: number;
  scanned: number;
  error: string | null;
};

// leads.audit (migration 017 column), written by the audit page
// (components/lead-finder/AuditReport.tsx). PageSpeed's screenshot is left
// out to keep the row small; recommendations are stored as shown.
export type SavedAudit = {
  version: 1;
  place: ScannedPlace;
  type: string;
  speed: PageSpeed | null; // null: no real website to test
  recommendations: Recommendation[];
  previewUrl: string;
  ran_at: string;
  ran_by: string | null; // team_members.id
};
