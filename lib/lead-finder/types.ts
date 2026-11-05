import type { LatestTouch } from "@/lib/sales/outcomes";

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
// output, plus cid (from mapsUrl), priority (lib/lead-finder/priority.ts)
// and marketplaces (CRM e-commerce rule).
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
  // Marketplaces the scan found them selling on (Shopify, Etsy, Faire,
  // Amazon, eBay). Missing on results scanned before Nov 4.
  marketplaces?: string[];
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
  // Website score inputs (lib/lead-finder/websiteScore.ts). Missing on
  // results scanned before Nov 5; site is null when the homepage didn't load.
  site?: SiteChecks | null;
  photos?: number; // Google profile photos (Places returns up to 10)
  // PageSpeed for the full website score, cached 30 days per website.
  webScore?: WebScoreCache | null;
  // Profile URLs linked from their website: first per platform, tracking
  // parameters removed. LinkedIn = company page only. Missing before Nov 5.
  socialLinks?: SocialLinks;
  gbp?: GbpInfo;
  // Every email and phone found, with where (Nov 6+): homepage, contact
  // page, about page, Facebook page, Google profile. Own-domain emails first.
  // Found on the page only; never guessed or built.
  contacts?: { emails: ContactItem[]; phones: ContactItem[] };
};

export type ContactSource = "homepage" | "contact page" | "about page" | "Facebook page" | "Google profile";
export type ContactItem = { value: string; source: ContactSource };

export const SOCIAL_PLATFORMS = ["Instagram", "Facebook", "TikTok", "YouTube", "LinkedIn"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export type SocialLinks = Partial<Record<SocialPlatform, string>>;

export type SiteChecks = {
  https: boolean;
  mobile: boolean;
  title: boolean;
  metaDescription: boolean;
  h1: boolean;
  localSchema: boolean; // LocalBusiness / Organization (or a subtype) JSON-LD
  faqSchema: boolean;
  // Added Nov 6 (missing on older scans: counted as not found).
  sitemap?: boolean | null; // /sitemap.xml answers with a urlset/sitemapindex; null = couldn't check
  schemaFields?: string[]; // which of name, address, telephone, openingHours, url the business schema has
  servicesList?: boolean; // a services page/menu or several service links
  serviceArea?: boolean; // "serving ...", "service area", or their city named on the page
  imageCount?: number; // <img> tags on the homepage
};

// Google Business Profile details beyond what ScannedPlace already has.
// Missing on scans before Nov 6.
export type GbpInfo = {
  description: boolean; // Google's business description (editorialSummary)
  latestReviewAt: string | null; // newest of the (up to 5) reviews Google returns
  categories: string[]; // primary category + Google types, readable
};

export type WebScoreCache = {
  url: string;
  at: string; // ISO time PageSpeed ran
  speed: { performance: number | null; seo: number | null; accessibility: number | null; bestPractices: number | null; loadTime?: string | null };
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

// A result that already has a Sales record (leads row whose source is in
// SALES_SOURCES, lib/sales/outcomes.ts): who owns it, its latest outcome.
export type ExistingLead = {
  id: string;
  company: string | null;
  contact_name: string | null; // owner name, editable in Sales
  title: string | null; // "Possible owner" = scan guess; anything else was typed by a person
  email: string | null;
  phone: string | null;
  contact_linkedin: string | null; // the business owner's / contact's profile
  company_linkedin: string | null; // the business's company page
  status: string;
  owner: string | null;
  project_id: string | null;
  next_action: string | null;
  next_action_at: string | null;
  last_touch: LatestTouch | null;
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
