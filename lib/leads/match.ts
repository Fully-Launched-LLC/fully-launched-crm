// Dedupe matching for leads. Shared by the Lead Finder (is this result
// already a lead?) and the one shared upsert (lib/leads/upsert.ts) used by
// Lead Finder adds, CSV import and manual adds.
//
// Match order: google_place_id, then cid, then email, then domain, then
// phone_digits. Place id and cid identify one physical location (unique in
// the database). Email, domain and phone are shared by chain/franchise
// locations, so a match on them only counts when the two records do NOT
// both carry a google_place_id that differs, or both carry a cid that
// differs. Two locations with different place ids are separate leads even
// with the same website.

export type MatchKey =
  | "google_place_id"
  | "cid"
  | "email"
  | "domain"
  | "phone";

export type LeadKeys = {
  google_place_id: string | null;
  cid: string | null;
  email: string | null;
  domain: string | null;
  phone_digits: string | null;
};

// Same rules as the leads_normalize trigger (migration 017), so keys
// computed here line up with what the database stores.
const SOCIAL_HOSTS = [
  "facebook.com", "fb.com", "instagram.com", "linktr.ee", "linkin.bio", "tiktok.com",
  "yelp.com", "business.site", "g.page", "google.com", "nextdoor.com", "x.com", "twitter.com",
];

export function normalizeEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return e || null;
}

export function normalizeDomain(domainOrUrl: string | null | undefined): string | null {
  let h = (domainOrUrl ?? "").trim().toLowerCase();
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  h = h.replace(/^[^@/]*@/, "");
  h = h.replace(/[/?#:].*$/, "");
  h = h.replace(/^www\./, "");
  if (!h) return null;
  if (SOCIAL_HOSTS.some((s) => h === s || h.endsWith("." + s))) return null;
  return h;
}

export function phoneDigits(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

// Both carry a place id (or a cid) and they differ: different locations.
export function conflictingLocations(a: LeadKeys, b: LeadKeys): boolean {
  if (a.google_place_id && b.google_place_id && a.google_place_id !== b.google_place_id) return true;
  if (a.cid && b.cid && a.cid !== b.cid) return true;
  return false;
}

// In-memory index over existing leads. Built once per request (the lead
// list is small: ~1,300 rows after the legacy import).
export class LeadIndex<T extends LeadKeys & { id: string }> {
  private byPlace = new Map<string, T>();
  private byCid = new Map<string, T>();
  private byEmail = new Map<string, T[]>();
  private byDomain = new Map<string, T[]>();
  private byPhone = new Map<string, T[]>();

  constructor(rows: T[] = []) {
    rows.forEach((r) => this.add(r));
  }

  add(r: T) {
    if (r.google_place_id) this.byPlace.set(r.google_place_id, r);
    if (r.cid) this.byCid.set(r.cid, r);
    push(this.byEmail, r.email, r);
    push(this.byDomain, r.domain, r);
    push(this.byPhone, r.phone_digits, r);
  }

  find(k: LeadKeys): { row: T; on: MatchKey } | null {
    if (k.google_place_id) {
      const r = this.byPlace.get(k.google_place_id);
      if (r) return { row: r, on: "google_place_id" };
    }
    if (k.cid) {
      const r = this.byCid.get(k.cid);
      if (r) return { row: r, on: "cid" };
    }
    const soft: [MatchKey, Map<string, T[]>, string | null][] = [
      ["email", this.byEmail, k.email],
      ["domain", this.byDomain, k.domain],
      ["phone", this.byPhone, k.phone_digits],
    ];
    for (const [on, map, value] of soft) {
      if (!value) continue;
      const r = (map.get(value) ?? []).find((row) => !conflictingLocations(row, k));
      if (r) return { row: r, on };
    }
    return null;
  }
}

function push<T>(map: Map<string, T[]>, key: string | null, row: T) {
  if (!key) return;
  const list = map.get(key);
  if (list) list.push(row);
  else map.set(key, [row]);
}
