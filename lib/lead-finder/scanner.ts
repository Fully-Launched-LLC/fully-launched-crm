import "server-only";
import type { GooglePlace } from "@/lib/lead-finder/google";
import type { ScanTags, ScannedPlace, ServiceKey, ShopifyInfo } from "@/lib/lead-finder/types";
import { extractCid } from "@/lib/lead-finder/cid";
import { priorityScore } from "@/lib/lead-finder/priority";

/**
 * FullyLaunched Lead Finder: Opportunity Scanner
 * Ported from Matteo's scanner.js. Structure changed (TypeScript, native
 * fetch, a per-step deadline); detection, tags and scoring are unchanged.
 * The only copy edits swap em-dashes for commas/colons (CRM copy rule).
 *
 * For every business Google returns, this decides which of our services
 * they look like they need:
 *
 *   WEBSITE: no site, a broken site, a Facebook/Linktree page instead of a
 *            real site, not secure, not mobile-friendly, or clearly outdated
 *   SOCIAL:  their website has no links to Instagram / Facebook / TikTok
 *   ECOM:    they sell products but have no online store
 *   AI:      paperwork-heavy industry + busy + no online booking/chat, or
 *            reviews complaining about slow responses / scheduling
 *
 * It visits each business's homepage (free, no API cost) and looks for
 * tell-tale signs in the page code.
 */

const PAGE_TIMEOUT_MS = 12000; // give up on a slow site after 12 seconds (we retry once)
const MAX_PAGE_BYTES = 1500000; // only read the first ~1.5 MB of a page
export const SCAN_CONCURRENCY = 8; // how many sites we check at the same time
const THIS_YEAR = new Date().getFullYear();

// "Websites" that aren't really websites: a social page or link-in-bio.
// Mirrored in migration 017's leads_normalize() (domain is nulled for these).
export const NOT_A_REAL_SITE = [
  "facebook.com", "fb.com", "instagram.com", "linktr.ee", "linkin.bio", "tiktok.com",
  "yelp.com", "business.site", "g.page", "google.com", "nextdoor.com", "x.com", "twitter.com",
];

const SOCIAL_PATTERNS: Record<string, RegExp> = {
  Instagram: /instagram\.com\/[a-z0-9_.]/i,
  Facebook: /facebook\.com\/(?!sharer|dialog|plugins|tr\b|tr\?)[a-z0-9_.-]/i,
  TikTok: /tiktok\.com\/@/i,
  YouTube: /youtube\.com\/(channel|c\/|@|user)/i,
  LinkedIn: /linkedin\.com\/(company|in)\//i,
};

const STORE_PATTERNS: [string, RegExp][] = [
  ["Shopify", /cdn\.shopify\.com|Shopify\.theme|myshopify\.com/i],
  ["WooCommerce", /woocommerce/i],
  ["BigCommerce", /bigcommerce\.com/i],
  ["Square Online", /square\.site|squareup\.com\/store|weebly\.com\/.*commerce|editmysite\.com/i],
  ["Wix Stores", /wixstores|wix-ecommerce/i],
  ["Squarespace Commerce", /squarespace-commerce|static1\.squarespace\.com.*commerce|"isCommerce":\s*true/i],
  ["Ecwid", /ecwid\.com|app\.ecwid/i],
  ["Etsy shop link", /etsy\.com\/shop\//i],
  ["Online ordering", /toasttab\.com|order\.online|chownow\.com|clover\.com\/online-ordering|olo\.com|doordash\.com\/store|ubereats\.com\/store|grubhub\.com/i],
  ["Cart / checkout", /add[\s-]to[\s-]cart|\/cart["'\/?]|\/checkout["'\/?]|shopping[\s-]cart/i],
];

const BOOKING_PATTERNS = [
  /calendly\.com/i, /acuityscheduling\.com/i, /squareup\.com\/appointments|square\.site\/book|book\.squareup/i,
  /booksy\.com/i, /vagaro\.com/i, /fresha\.com/i, /mindbodyonline\.com|mindbody\.io/i, /schedulicity\.com/i,
  /setmore\.com/i, /housecallpro\.com/i, /servicetitan\.com/i, /getjobber\.com|jobber\.com/i,
  /zocdoc\.com/i, /localmed\.com/i, /nexhealth\.com/i, /opentable\.com/i, /resy\.com/i, /tockify|exploretock\.com/i,
  /simplybook\.me/i, /youcanbook\.me/i, /appointy\.com/i, /glossgenius\.com/i, /styleseat\.com/i,
  /\bbook (an )?(appointment|online|now)\b/i, /\bschedule (an )?(appointment|online|service)\b/i, /\brequest an appointment\b/i,
];

const CHAT_PATTERNS = [
  /intercom\.io|widget\.intercom/i, /drift\.com|js\.driftt/i, /tawk\.to/i, /livechatinc\.com/i,
  /zopim|zendesk\.com\/embeddable|static\.zdassets/i, /js\.hs-scripts\.com|hubspot.*conversations/i,
  /podium\.com/i, /birdeye\.com/i, /tidio/i, /crisp\.chat/i, /olark/i, /smith\.ai/i, /ruby\.com.*chat/i,
  /chatbot/i, /webchat/i,
];

// Industries where we've seen (e.g. Comfort x Design) lots of manual office work:
// invoices, scheduling, quotes, intake forms, phones.
const AI_FIT_TYPES = [
  "hvac", "plumber", "electrician", "roofing_contractor", "general_contractor", "contractor",
  "dentist", "dental_clinic", "doctor", "medical_clinic", "medical_lab", "physiotherapist", "chiropractor",
  "lawyer", "law_firm", "accounting", "tax_preparation", "insurance_agency", "real_estate_agency",
  "property_management", "moving_company", "storage", "car_repair", "car_dealer", "veterinary_care",
  "landscaper", "pest_control", "locksmith", "painter", "cleaning", "house_cleaning_service",
  "construction_company", "home_improvement", "logistics", "trucking", "wholesaler", "manufacturer",
  "auto_body_shop", "towing", "event_venue", "catering_service", "travel_agency", "funeral_home",
];
const AI_FIT_WORDS = /hvac|heating|cooling|plumb|electric|roof|contractor|construct|remodel|dental|dentist|clinic|medical|chiropract|physical therap|law|attorney|legal|account|tax|bookkeep|insurance|real estate|realty|property manage|moving|movers|storage|auto repair|mechanic|collision|body shop|veterinar|animal hospital|landscap|lawn|pest|locksmith|painting|cleaning|janitor|towing|logistic|freight|trucking|wholesale|distribut|manufactur|supply|catering|venue|funeral/i;

const COMPLAINT_PATTERNS = /never (called|got a call|heard) back|no (one|body) (answered|picked up|called)|didn'?t (call|get) back|never returned|unresponsive|no response|couldn'?t get (through|a hold)|went to voicemail|left (a |several |multiple )?(voicemail|messages)|hard to (schedule|reach|get a hold)|took (forever|weeks) to (schedule|respond|get)|wait(ed)? (for )?(weeks|hours) for (a )?(call|quote|response)|billing (issue|error|mistake)|wrong invoice|lost my (paperwork|order|file)|disorganized|miscommunication/i;

// Google place types that mean "sells physical products".
const PRODUCT_TYPES = [
  "bakery", "florist", "winery", "brewery", "liquor_store", "candy_store", "chocolate_shop",
  "confectionery", "butcher_shop", "farm", "garden_center", "market", "gift_shop", "book_store",
  "clothing_store", "shoe_store", "jewelry_store", "furniture_store", "home_goods_store", "pet_store",
  "sporting_goods_store", "bicycle_store", "electronics_store", "hardware_store", "cosmetics_store",
  "beauty_supply_store", "toy_store", "art_supply", "craft_store", "thrift_store", "antique_store",
  "coffee_shop", "tea_house", "boutique", "department_store", "discount_store", "store",
];
const PRODUCT_WORDS = /boutique|bakery|bake shop|florist|flower|candle|soap|jewel|clothing|apparel|gift|chocolate|candy|coffee roast|tea shop|winery|brewery|distillery|meadery|farm|honey|wood ?work|furniture|pottery|ceramic|art studio|print shop|t-?shirt|apparel|vintage|antique|thrift|pet supply|tack shop|outfitter|surf shop|skate shop|bike shop|book ?store|record store|vinyl|toy|craft|yarn|fabric|quilt|sewing/i;

// Software a business uses: tells us what we could integrate with / automate.
const TECH_PATTERNS: [string, RegExp][] = [
  ["ServiceTitan", /servicetitan\.com|servicetitan\.io|st-scheduler|stwidget|servicetitan/i],
  ["ScheduleEngine (ServiceTitan)", /scheduleengine\.(net|com)|se-widget|schedule-engine/i],
  ["FieldRoutes (ServiceTitan)", /fieldroutes\.com|pestroutes\.com/i],
  ["Housecall Pro", /housecallpro\.com/i],
  ["Jobber", /getjobber\.com|clienthub\.getjobber/i],
  ["QuickBooks", /quickbooks\.intuit\.com|connect\.intuit\.com|intuit\.me/i],
  ["Square", /squareup\.com|square\.site|squarecdn\.com/i],
  ["Mindbody", /mindbodyonline\.com|mindbody\.io/i],
  ["Vagaro", /vagaro\.com/i],
  ["Booksy", /booksy\.com/i],
  ["Calendly", /calendly\.com/i],
  ["Acuity", /acuityscheduling\.com/i],
  ["Clio", /clio\.com|app\.clio/i],
  ["Podium", /podium\.com/i],
  ["Birdeye", /birdeye\.com/i],
  ["HubSpot", /js\.hs-scripts\.com|hsforms\.net|hubspot\.com/i],
  ["Mailchimp", /mailchimp\.com|list-manage\.com|chimpstatic\.com/i],
  ["Klaviyo", /klaviyo\.com/i],
  ["Shopify", /cdn\.shopify\.com|myshopify\.com/i],
  ["WordPress", /wp-content\/|wp-includes\//i],
  ["Wix", /wixstatic\.com|wix\.com\/|_wixCIDX|wix-code/i],
  ["Squarespace", /squarespace\.com|static1\.squarespace/i],
  ["GoDaddy Builder", /img1\.wsimg\.com|godaddy\.com\/websites|websites\.godaddy/i],
  ["Weebly", /weebly\.com|editmysite\.com/i],
];
// Tools we can plug AI into via their API (ServiceTitan = our Comfort x Design case study).
const isServiceTitan = (t: string) => /ServiceTitan/.test(t);
const AI_INTEGRATABLE = ["ScheduleEngine (ServiceTitan)", "FieldRoutes (ServiceTitan)", "ServiceTitan", "Housecall Pro", "Jobber", "QuickBooks", "Clio", "Mindbody", "Square", "HubSpot"];

// Ad tracking code: if it's on their site, they're (very likely) paying for ads.
const AD_PATTERNS: [string, RegExp][] = [
  ["Meta ads", /connect\.facebook\.net\/[^"']*fbevents\.js|fbq\(\s*['"]init/i],
  ["Google Ads", /googleadservices\.com|googleads\.g\.doubleclick\.net|['"]AW-\d{6,}/i],
  ["TikTok ads", /analytics\.tiktok\.com|ttq\.load/i],
  ["Microsoft ads", /bat\.bing\.com/i],
];

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const BAD_EMAIL = /\.(png|jpe?g|gif|webp|svg|css|js)$|@(example|domain|email|yourdomain|sentry|wixpress|sentry-next|godaddy)\.|^(name|your|you|user|email)@/i;

// ---------------------------------------------------------------------------

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function isNotARealSite(url: string): boolean {
  const host = hostOf(url);
  return NOT_A_REAL_SITE.some((d) => host === d || host.endsWith("." + d));
}

type PageResult = {
  ok: boolean;
  status?: number;
  finalUrl?: string;
  html?: string;
  timedOut?: boolean;
  error?: string;
};

// A scan step has a wall-clock deadline (the route's maxDuration is 60s).
// Each fetch's timeout is capped to the time left; a fetch cut by the
// deadline is reported exactly like Matteo's own timeout.
export type ScanContext = { deadline: number };

function timeLeft(ctx: ScanContext | undefined, wanted: number): number {
  if (!ctx) return wanted;
  return Math.min(wanted, ctx.deadline - Date.now());
}

/** Download a homepage (safely: time limit, size limit, http/https only). */
async function fetchHomepageOnce(url: string, timeoutMs: number, ctx?: ScanContext): Promise<PageResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "Bad link" };
  }
  if (!/^https?:$/.test(parsed.protocol)) return { ok: false, error: "Bad link" };

  const budget = timeLeft(ctx, timeoutMs);
  if (budget <= 0) return { ok: false, timedOut: true, error: "Site took too long to load" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
  try {
    const resp = await fetch(parsed.href, {
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    // Read the body, but stop after MAX_PAGE_BYTES. (Native fetch yields
    // Uint8Array chunks, so decode them; node-fetch handed Matteo Buffers.)
    let html = "";
    let bytes = 0;
    if (resp.body) {
      const reader = resp.body.getReader();
      const decoder = new TextDecoder("utf-8");
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        html += decoder.decode(value, { stream: true });
        if (bytes > MAX_PAGE_BYTES) {
          reader.cancel().catch(() => {});
          break;
        }
      }
      html += decoder.decode();
    }
    return { ok: resp.ok, status: resp.status, finalUrl: resp.url || parsed.href, html };
  } catch (e) {
    const timedOut = !!e && (e as Error).name === "AbortError";
    return { ok: false, timedOut, error: timedOut ? "Site took too long to load" : "Site would not load" };
  } finally {
    clearTimeout(timer);
  }
}

/** Try a homepage, and if it was slow or failed to connect, try once more with longer patience. */
async function fetchHomepage(url: string, ctx?: ScanContext): Promise<PageResult> {
  const first = await fetchHomepageOnce(url, PAGE_TIMEOUT_MS, ctx);
  if (first.ok || first.status) return first; // got a real answer from the server
  return fetchHomepageOnce(url, PAGE_TIMEOUT_MS + 8000, ctx);
}

/** Run an async function over a list, a few at a time. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function looksLikeProductBusiness(place: GooglePlace, searchType: string): boolean {
  const types = place.types || [];
  if (types.some((t) => PRODUCT_TYPES.includes(t) || t.endsWith("_store") || t.endsWith("_shop"))) {
    // Barbers / repair "shops" aren't product sellers.
    if (!types.some((t) => /barber|hair|beauty_salon|car_repair|auto_repair|nail_salon|repair/.test(t))) return true;
  }
  const label = [searchType, place.primaryTypeDisplayName && place.primaryTypeDisplayName.text, place.displayName && place.displayName.text].join(" ");
  return PRODUCT_WORDS.test(label);
}

function looksLikeAiFitIndustry(place: GooglePlace, searchType: string): boolean {
  const types = place.types || [];
  if (types.some((t) => AI_FIT_TYPES.includes(t))) return true;
  const label = [searchType, place.primaryTypeDisplayName && place.primaryTypeDisplayName.text, place.displayName && place.displayName.text].join(" ");
  return AI_FIT_WORDS.test(label);
}

type SiteInfo = {
  secure: boolean;
  mobileFriendly: boolean;
  copyrightYear: number | null;
  socials: string[];
  store: string | null;
  hasBooking: boolean;
  hasChat: boolean;
  tech: string[];
  ads: string[];
};

/** Look through the page code for clues. */
export function analyzeHtml(html: string, finalUrl: string | undefined): SiteInfo {
  const result: SiteInfo = {
    secure: /^https:/i.test(finalUrl || ""),
    mobileFriendly: /<meta[^>]+name=["']?viewport/i.test(html),
    copyrightYear: null,
    socials: [],
    store: null,
    hasBooking: false,
    hasChat: false,
    tech: [],
    ads: [],
  };

  // Newest year that appears next to a © / "copyright".
  const yearRe = /(?:©|&copy;|&#169;|copyright)[^<]{0,40}?((?:19|20)\d{2})(?:\s*[-–]\s*((?:19|20)\d{2}))?/gi;
  let m: RegExpExecArray | null;
  while ((m = yearRe.exec(html)) !== null) {
    const y = parseInt(m[2] || m[1], 10);
    if (y <= THIS_YEAR && (!result.copyrightYear || y > result.copyrightYear)) result.copyrightYear = y;
  }

  for (const [name, re] of Object.entries(SOCIAL_PATTERNS)) {
    if (re.test(html)) result.socials.push(name);
  }
  for (const [name, re] of STORE_PATTERNS) {
    if (re.test(html)) {
      result.store = name;
      break;
    }
  }
  for (const [name, re] of TECH_PATTERNS) if (re.test(html)) result.tech.push(name);
  for (const [name, re] of AD_PATTERNS) if (re.test(html)) result.ads.push(name);
  result.hasBooking = BOOKING_PATTERNS.some((re) => re.test(html));
  result.hasChat = CHAT_PATTERNS.some((re) => re.test(html));
  return result;
}

/** Strip page code down to readable text. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, " ");
}

/** Pull email addresses out of a page. */
export function findEmails(html: string): string[] {
  const found = new Set<string>();
  const decoded = html.replace(/&#64;|\[at\]|\(at\)/gi, "@");
  for (const e of decoded.match(EMAIL_RE) || []) {
    const email = e.toLowerCase().replace(/^mailto:/, "").replace(/[.,;]+$/, "");
    if (!BAD_EMAIL.test(email) && email.length < 60) found.add(email);
  }
  return Array.from(found);
}

/** Look for "Owner: Jane Smith" / "John Doe, founder" style text. Best guess only. */
export function findOwnerName(html: string): string | null {
  const text = htmlToText(html);
  const NAME = "([A-Z][a-z]+(?:\\s[A-Z]\\.)?\\s[A-Z][a-zA-Z'’-]+)";
  const ROLE = "(?:owner|co-owner|founder|co-founder|president|proprietor|ceo|principal)";
  const patterns = [
    new RegExp(ROLE + "\\s*(?:&|and)?\\s*(?:[a-z-]+\\s)?[,:–—-]?\\s*(?:is\\s)?" + NAME, "i"),
    new RegExp(NAME + "\\s*[,–—-]\\s*(?:the\\s)?" + ROLE, "i"),
    new RegExp("(?:founded|started|owned|run)\\sby\\s" + NAME, "i"),
    new RegExp("meet\\s(?:the\\sowner,?\\s)?" + NAME, "i"),
  ];
  const NOT_NAMES = /^(Our|The|We|About|Contact|Home|Call|Free|Read|Learn|More|Your|This|Book|Get|View|All|Click|Service|Services)\b/;
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1] && !NOT_NAMES.test(m[1])) return m[1].trim();
  }
  return null;
}

const LINK_RE = /<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]{0,80}?)<\/a>/gi;

/** Find a same-site link whose address or label matches a pattern. */
function findLinkTo(html: string, baseUrl: string, re: RegExp): string | null {
  for (const [, href, label] of Array.from(html.matchAll(LINK_RE))) {
    if (re.test(href) || re.test(label)) {
      try {
        const u = new URL(href, baseUrl);
        if (u.hostname.replace(/^www\./, "") === hostOf(baseUrl)) return u.href;
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

/** Find a link to a Contact (preferred) or About page on the same site. */
function findContactPage(html: string, baseUrl: string): string | null {
  const links = Array.from(html.matchAll(LINK_RE));
  const pick = (re: RegExp) => {
    for (const [, href, label] of links) {
      if (re.test(href) || re.test(label)) {
        try {
          const u = new URL(href, baseUrl);
          if (u.hostname.replace(/^www\./, "") === hostOf(baseUrl)) return u.href;
        } catch {
          /* ignore bad links */
        }
      }
    }
    return null;
  };
  return pick(/contact/i) || pick(/about|our-story|team|meet/i);
}

/** Shopify stores publish their product list publicly: check listing quality. */
async function inspectShopify(siteUrl: string, ctx?: ScanContext): Promise<ShopifyInfo | null> {
  let origin: string;
  try {
    origin = new URL(siteUrl).origin;
  } catch {
    return null;
  }
  const page = await fetchHomepageOnce(origin + "/products.json?limit=250", PAGE_TIMEOUT_MS, ctx);
  if (!page.ok || !page.html) return null;
  let data: { products?: { images?: unknown[]; body_html?: string }[] };
  try {
    data = JSON.parse(page.html);
  } catch {
    return null;
  }
  const products = data.products || [];
  if (!products.length) return { products: 0, noPhoto: 0, thinDescription: 0, fewPhotos: 0 };
  let noPhoto = 0,
    fewPhotos = 0,
    thin = 0;
  for (const p of products) {
    const imgs = (p.images || []).length;
    if (imgs === 0) noPhoto++;
    else if (imgs < 3) fewPhotos++;
    if (htmlToText(p.body_html || "").trim().length < 150) thin++;
  }
  return { products: products.length, capped: products.length >= 250, noPhoto, fewPhotos, thinDescription: thin };
}

/** Turn one Google place (+ its homepage, if any) into a scored lead. */
export async function scanPlace(place: GooglePlace, searchType: string, ctx?: ScanContext): Promise<ScannedPlace> {
  const name = (place.displayName && place.displayName.text) || "Unknown";
  const website = place.websiteUri || "";
  const reviewCount = place.userRatingCount || 0;
  const reviewTexts = (place.reviews || []).map((r) => (r.text && r.text.text) || (r.originalText && r.originalText.text) || "");
  const complaints = reviewTexts.filter((t) => COMPLAINT_PATTERNS.test(t));

  const tags: ScanTags = { website: [], social: [], ecom: [], ai: [] };
  const signals: string[] = []; // extra facts worth knowing on a sales call
  let siteInfo: SiteInfo | null = null;
  let siteStatus: string;
  let emails: string[] = [];
  let ownerName: string | null = null;
  let contactPage: string | null = null;
  let shopify: ShopifyInfo | null = null;

  // ---- WEBSITE ----
  if (!website) {
    siteStatus = "No website";
    tags.website.push("No website on Google");
  } else if (isNotARealSite(website)) {
    siteStatus = "Social page only";
    tags.website.push("Uses a " + hostOf(website) + " page instead of a real website");
  } else {
    const page = await fetchHomepage(website, ctx);
    if (page.status === 401 || page.status === 403 || page.status === 429 || page.status === 503) {
      // Site is up but blocks automated visitors (e.g. Cloudflare): not a lead signal.
      siteStatus = "Couldn't check";
    } else if (page.timedOut) {
      // Very slow, but probably not dead. Flag softly so someone can check by hand.
      siteStatus = "Very slow";
      tags.website.push("Site very slow to load (check by hand)");
    } else if (!page.ok || !page.html) {
      siteStatus = "Broken";
      tags.website.push(page.error || "Site returned an error (" + page.status + ")");
    } else {
      const info = analyzeHtml(page.html, page.finalUrl);
      siteInfo = info;
      siteStatus = "Has website";
      if (!info.secure) tags.website.push("Not secure (no https padlock)");
      if (!info.mobileFriendly) tags.website.push("Not set up for phones");
      if (info.copyrightYear && info.copyrightYear <= THIS_YEAR - 3) {
        tags.website.push("Looks outdated (© " + info.copyrightYear + ")");
      }

      // ---- CONTACTS: homepage + one Contact/About page ----
      const finalUrl = page.finalUrl || website;
      emails = findEmails(page.html);
      ownerName = findOwnerName(page.html);
      contactPage = findContactPage(page.html, finalUrl);
      if (contactPage && (emails.length === 0 || !ownerName)) {
        const cp = await fetchHomepageOnce(contactPage, PAGE_TIMEOUT_MS, ctx);
        if (cp.ok && cp.html) {
          emails = Array.from(new Set([...emails, ...findEmails(cp.html)]));
          ownerName = ownerName || findOwnerName(cp.html);
          const extra = analyzeHtml(cp.html, cp.finalUrl);
          extra.socials.forEach((s) => {
            if (!info.socials.includes(s)) info.socials.push(s);
          });
          extra.tech.forEach((t) => {
            if (!info.tech.includes(t)) info.tech.push(t);
          });
          info.hasBooking = info.hasBooking || extra.hasBooking;
        }
      }
      // ServiceTitan's booking widget often lives on a separate "Schedule"/"Book" page.
      if (!info.tech.some(isServiceTitan)) {
        const bookPage = findLinkTo(page.html, finalUrl, /schedul|book|appointment|service-request|request-service/i);
        if (bookPage && bookPage !== contactPage) {
          const bp = await fetchHomepageOnce(bookPage, PAGE_TIMEOUT_MS, ctx);
          if (bp.ok && bp.html) {
            const extra = analyzeHtml(bp.html, bp.finalUrl);
            extra.tech.forEach((t) => {
              if (!info.tech.includes(t)) info.tech.push(t);
            });
            info.hasBooking = info.hasBooking || extra.hasBooking;
          }
        }
      }

      // Prefer emails on their own domain (info@theirbusiness.com) over gmail etc.
      const domain = hostOf(finalUrl);
      emails.sort((a, b) => (b.endsWith("@" + domain) ? 1 : 0) - (a.endsWith("@" + domain) ? 1 : 0));
      emails = emails.slice(0, 3);

      if (info.ads.length && tags.website.length) {
        tags.website.unshift("Pays for ads (" + info.ads.join(", ") + ") but site has problems");
      }
      if (info.ads.length) signals.push("Runs " + info.ads.join(" + "));
      if (info.tech.length) signals.push("Uses " + info.tech.join(", "));
    }
  }

  // ---- SOCIAL ---- (only judged when we could actually read their site)
  if (siteInfo && siteInfo.socials.length === 0) {
    tags.social.push("No social media links on their website");
  } else if (siteInfo && !siteInfo.socials.includes("Instagram") && !siteInfo.socials.includes("TikTok")) {
    tags.social.push("No Instagram or TikTok (only " + siteInfo.socials.join(", ") + ")");
  }

  // ---- E-COMMERCE ----
  const sellsProducts = looksLikeProductBusiness(place, searchType);
  if (sellsProducts) {
    if (!website || siteStatus === "Social page only" || siteStatus === "Broken") {
      tags.ecom.push("Sells products but has no online store");
    } else if (siteInfo && !siteInfo.store) {
      tags.ecom.push("Has a website but no online store / ordering");
    }
  }
  if (siteInfo && (siteInfo.store === "Shopify" || siteInfo.tech.includes("Shopify"))) {
    shopify = await inspectShopify(website, ctx);
    if (shopify && shopify.products > 0) {
      const n = shopify.products + (shopify.capped ? "+" : "");
      const weak = shopify.noPhoto + shopify.thinDescription;
      const issues: string[] = [];
      if (shopify.noPhoto) issues.push(shopify.noPhoto + " with no photo");
      if (shopify.fewPhotos) issues.push(shopify.fewPhotos + " with only 1–2 photos");
      if (shopify.thinDescription) issues.push(shopify.thinDescription + " with thin descriptions");
      signals.push("Shopify store: " + n + " products");
      if (weak >= Math.max(3, shopify.products * 0.25) || shopify.fewPhotos >= shopify.products * 0.5) {
        tags.ecom.push("Shopify store, " + n + " products: " + issues.join(", "));
      }
      if (shopify.products >= 25) tags.ecom.push("Large catalog (" + n + "), could expand to Amazon / Etsy / Faire");
    }
  }

  // ---- AI / AUTOMATION ----
  const aiIndustry = looksLikeAiFitIndustry(place, searchType);
  let aiPoints = 0;
  const aiReasons: string[] = [];
  if (aiIndustry) {
    aiPoints += 2;
    aiReasons.push("Paperwork/phone-heavy industry");
  }
  if (reviewCount >= 150) {
    aiPoints += 2;
    aiReasons.push(reviewCount + " reviews, high volume");
  } else if (reviewCount >= 50) {
    aiPoints += 1;
    aiReasons.push(reviewCount + " reviews, steady volume");
  }
  if (siteInfo && !siteInfo.hasBooking && !siteInfo.hasChat) {
    aiPoints += 1;
    aiReasons.push("No online booking or chat on site");
  }
  if (complaints.length > 0) {
    aiPoints += 2;
    aiReasons.push(complaints.length + " review(s) mention slow response / scheduling / billing");
  }
  const integratable = siteInfo ? siteInfo.tech.filter((t) => AI_INTEGRATABLE.includes(t)) : [];
  if (integratable.some(isServiceTitan)) {
    aiPoints += 3;
    aiReasons.unshift("Uses ServiceTitan, same setup as our Comfort x Design build");
  } else if (integratable.length) {
    aiPoints += 2;
    aiReasons.unshift("Uses " + integratable.join(", ") + ", software we can connect AI to");
  }
  // Needs a real signal (industry, software or complaints) plus some volume to count as an AI lead.
  if (aiPoints >= 3 && (aiIndustry || complaints.length > 0 || integratable.length)) tags.ai = aiReasons;

  // ---- NEW BUSINESS ----
  const looksNew = reviewCount > 0 && reviewCount <= 15 && (place.rating || 0) >= 4.5;
  if (looksNew) signals.push("Possibly a new business (few reviews, high rating)");

  // ---- SCORE (0 to 100): rough "how good is this lead" number ----
  let score = 0;
  if (tags.website.length) {
    if (!website || siteStatus === "Social page only" || siteStatus === "Broken") score += 30;
    else if (siteStatus === "Very slow") score += 10;
    else score += 10 + 5 * tags.website.length;
  }
  if (tags.social.length) score += 15;
  if (tags.ecom.length) score += 20;
  if (tags.ai.length) score += Math.min(35, aiPoints * 6);
  if (siteInfo && siteInfo.ads.length && (tags.website.length || tags.social.length)) score += 10; // already spends on marketing
  if (looksNew) score += 5;
  if (emails.length || ownerName) score += 5; // we can reach a person
  if (reviewCount >= 20) score += 5; // real, active business
  if ((place.rating || 0) >= 4.3) score += 5; // happy customers = can afford to grow
  score = Math.min(100, score);

  const services = (Object.keys(tags) as ServiceKey[]).filter((k) => tags[k].length > 0);
  const mapsUrl = place.googleMapsUri || `https://www.google.com/maps/place/?q=place_id:${place.id}`;
  const rating = place.rating || "N/A";

  return {
    id: place.id,
    name,
    address: place.formattedAddress || "",
    phone: place.nationalPhoneNumber || "No phone listed",
    rating,
    reviews: reviewCount,
    category: (place.primaryTypeDisplayName && place.primaryTypeDisplayName.text) || "",
    website,
    websiteStatus: siteStatus,
    socials: siteInfo ? siteInfo.socials : [],
    store: siteInfo ? siteInfo.store : null,
    hasBooking: siteInfo ? siteInfo.hasBooking : null,
    tech: siteInfo ? siteInfo.tech : [],
    ads: siteInfo ? siteInfo.ads : [],
    emails,
    ownerName,
    contactPage,
    shopify,
    signals,
    complaints: complaints.slice(0, 2).map((t) => t.slice(0, 220)),
    tags,
    usesServiceTitan: siteInfo ? siteInfo.tech.some(isServiceTitan) : false,
    services,
    score,
    mapsUrl,
    hours: (place.regularOpeningHours && place.regularOpeningHours.weekdayDescriptions) || null,
    cid: extractCid(place.googleMapsUri),
    priority: priorityScore({ services, rating, reviews: reviewCount, score }),
  };
}
