import type { Branch } from "@/lib/theme";
import type { LeadStatus } from "@/lib/types";
import type { ServiceKey } from "@/lib/lead-finder/types";
import type { LeadInput } from "@/lib/leads/upsert";
import { extractCid } from "@/lib/lead-finder/cid";
import { cityState, TAG_BRANCH } from "@/lib/lead-finder/toLead";
import { priorityScore } from "@/lib/lead-finder/priority";
import { LEAD_STATUSES, LEAD_STATUS_LABELS } from "@/lib/leads/labels";

// CSV import for the Leads page. Parsing and mapping run in the browser; the
// rows then go to upsert_leads (merge mode), so matching is the database's.

// ---------------------------------------------------------------------------
// Parser: RFC 4180 (quoted fields, "" escapes, commas/newlines inside
// quotes), CRLF or LF, optional UTF-8 BOM. Blank lines are dropped.

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const src = text.replace(/^﻿/, "");
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      records.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    records.push(row);
  }
  const nonEmpty = records.filter((r) => r.some((v) => v.trim() !== ""));
  if (!nonEmpty.length) return { headers: [], rows: [] };
  const headers = nonEmpty[0].map((h) => h.trim());
  const rows = nonEmpty.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => (o[h] = (r[i] ?? "").trim()));
    return o;
  });
  return { headers, rows };
}

const blank = (v: string | undefined | null) => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};
const list = (v: string | undefined) =>
  (v ?? "")
    .split(/;\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
const num = (v: string | undefined) => {
  const n = parseFloat((v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

// ---------------------------------------------------------------------------
// Legacy preset: Matteo's Lead Finder CSV export (his standalone tool, and
// the CRM's Mission control export, which adds Priority and Marketplaces).
// There's no Google place id in it; the "Google Maps Link" carries the cid,
// so legacy rows match new Lead Finder results on external_ids.cid.

export const LEGACY_HEADERS = ["Business Name", "Google Maps Link"];
export const isLegacyCsv = (headers: string[]) => LEGACY_HEADERS.every((h) => headers.includes(h));

const SERVICE_FROM_LABEL: Record<string, ServiceKey> = {
  website: "website",
  social: "social",
  "e-commerce": "ecom",
  ecommerce: "ecom",
  ai: "ai",
};

// Matteo's old ecom reasons that the CRM's rule (Nov 4) dropped: a business
// only counts as e-commerce when it already sells online.
const OLD_ECOM_REASONS = ["Sells products but has no online store", "Has a website but no online store / ordering"];

const PIPELINE_STATUS: Record<string, LeadStatus> = {
  new: "new",
  contacted: "contacted",
  interested: "interested",
  "not a fit": "not_interested",
  "not in leads": "new",
};

function statusFrom(label: string | undefined): LeadStatus {
  const l = (label ?? "").trim().toLowerCase();
  if (PIPELINE_STATUS[l]) return PIPELINE_STATUS[l];
  const byLabel = LEAD_STATUSES.find((s) => LEAD_STATUS_LABELS[s].toLowerCase() === l || s === l);
  return byLabel ?? "new";
}

export function legacyRowToLead(r: Record<string, string>): LeadInput | null {
  const company = blank(r["Business Name"]);
  if (!company) return null;
  const mapsUrl = blank(r["Google Maps Link"]);
  const cid = extractCid(mapsUrl);
  const address = blank(r["Address"]);
  const { city, state } = address ? cityState(address) : { city: null, state: null };
  const phone = blank(r["Phone"]);
  const emails = list(r["Emails"]);
  const owner = blank(r["Possible Owner"]);
  const marketplaces = list(r["Marketplaces"]);

  const tags: Record<ServiceKey, string[]> = {
    website: list(r["Website Reasons"]),
    social: list(r["Social Reasons"]),
    ecom: list(r["E-commerce Reasons"]).filter((t) => !OLD_ECOM_REASONS.includes(t)),
    ai: list(r["AI Reasons"]),
  };
  let services = list(r["Services Needed"])
    .map((s) => SERVICE_FROM_LABEL[s.toLowerCase()])
    .filter(Boolean) as ServiceKey[];
  // New ecom rule: keep the ecom fit only with evidence it already sells online.
  if (!tags.ecom.length && !marketplaces.length) services = services.filter((s) => s !== "ecom");
  services = Array.from(new Set(services));

  const rating = r["Google Rating"] && r["Google Rating"] !== "N/A" ? num(r["Google Rating"]) : null;
  const reviews = num(r["Reviews"]);
  const score = num(r["Lead Score"]);
  const priority =
    num(r["Priority"]) ??
    (score != null ? priorityScore({ services, rating, reviews, score }) : null);

  return {
    company,
    contact_name: owner,
    title: owner ? "Possible owner" : null,
    email: emails[0] ?? null,
    phone: phone && phone !== "No phone listed" ? phone : null,
    website: blank(r["Website"]),
    address,
    city,
    state,
    category: blank(r["Category"]),
    branch_fit: Array.from(new Set(services.map((s) => TAG_BRANCH[s]))) as Branch[],
    external_ids: cid ? { cid } : {},
    maps_url: mapsUrl,
    rating,
    review_count: reviews != null ? Math.round(reviews) : null,
    website_status: blank(r["Website Status"]),
    lead_score: score != null ? Math.round(score) : null,
    priority_score: priority != null ? Math.round(priority) : null,
    uses_servicetitan: /^y(es)?$/i.test(r["Uses ServiceTitan"] ?? ""),
    status: statusFrom(r["Pipeline Status"]),
    scan_tags: {
      tags,
      services,
      signals: list(r["Other Signals"]),
      tech: list(r["Software Used"]),
      ads: list(r["Runs Ads"]),
      socials: list(r["Social Links Found"]),
      store: blank(r["Online Store Found"]),
      emails,
      contactPage: blank(r["Contact Page"]),
      marketplaces,
    },
  };
}

// ---------------------------------------------------------------------------
// Generic preset: the user maps columns to fields (guessed from headers).

export const GENERIC_FIELDS = [
  { key: "company", label: "Company (required)" },
  { key: "contact_name", label: "Contact name" },
  { key: "title", label: "Title" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "website", label: "Website" },
  { key: "address", label: "Address" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "industry", label: "Industry" },
  { key: "category", label: "Category" },
  { key: "linkedin", label: "LinkedIn URL" },
  { key: "maps_url", label: "Google Maps link" },
  { key: "notes", label: "Notes" },
] as const;
export type GenericField = (typeof GENERIC_FIELDS)[number]["key"];
export type GenericMapping = Partial<Record<GenericField, string>>;

const GUESS: Record<GenericField, RegExp> = {
  company: /^(company|company name|business|business name|organization|organisation|account|account name|name)$/i,
  contact_name: /^(contact|contact name|full name|person|owner|owner name|first and last name)$/i,
  title: /^(title|job title|position|role)$/i,
  email: /^(email|e-mail|email address|work email|emails)$/i,
  phone: /^(phone|phone number|telephone|mobile|cell|work phone)$/i,
  website: /^(website|web site|url|site|domain|company website)$/i,
  address: /^(address|street address|full address)$/i,
  city: /^(city|town)$/i,
  state: /^(state|province|region)$/i,
  industry: /^(industry|vertical|sector)$/i,
  category: /^(category|type|business type)$/i,
  linkedin: /linkedin/i,
  maps_url: /(google maps|maps link|maps url|gmb)/i,
  notes: /^(notes|note|comments|description)$/i,
};

export function guessMapping(headers: string[]): GenericMapping {
  const m: GenericMapping = {};
  const used = new Set<string>();
  (Object.keys(GUESS) as GenericField[]).forEach((f) => {
    const h = headers.find((x) => !used.has(x) && GUESS[f].test(x.trim()));
    if (h) {
      m[f] = h;
      used.add(h);
    }
  });
  return m;
}

export function genericRowToLead(r: Record<string, string>, m: GenericMapping): LeadInput | null {
  const get = (f: GenericField) => (m[f] ? blank(r[m[f]!]) : null);
  const company = get("company");
  if (!company) return null;
  const linkedin = get("linkedin");
  const mapsUrl = get("maps_url");
  const cid = extractCid(mapsUrl);
  const ids: Record<string, string> = {};
  if (linkedin) ids.linkedin = linkedin;
  if (cid) ids.cid = cid;
  const address = get("address");
  const fromAddress = address ? cityState(address) : { city: null, state: null };
  return {
    company,
    contact_name: get("contact_name"),
    title: get("title"),
    email: list(get("email") ?? "")[0] ?? null,
    phone: get("phone"),
    website: get("website"),
    address,
    city: get("city") ?? fromAddress.city,
    state: get("state") ?? fromAddress.state,
    industry: get("industry"),
    category: get("category"),
    notes: get("notes"),
    maps_url: mapsUrl,
    external_ids: ids,
  };
}
