import type { ScannedPlace, ServiceKey } from "@/lib/lead-finder/types";
import { SERVICE_ORDER } from "@/lib/lead-finder/sweep";
import { plugSoftware } from "@/lib/lead-finder/software";

// Draft email (Sales side preview). One template per branch, filled from
// the scan: business owner, the gatekeeper we spoke with (latest Not
// available), rating and reviews, "Runs on" software, the top 2 gaps, and
// the sender's name and booking link (team_members). Plain language, no
// em-dashes. AI is back-office automation only (never call answering), with
// the Comfort x Design invoice-to-PO tool as the example.

export type EmailKind = ServiceKey | "general"; // "ai" | "website" | "social" | "ecom" | "general"

export const EMAIL_KINDS: [EmailKind, string][] = [
  ["ai", "AI / back office"],
  ["website", "Website"],
  ["social", "Social media"],
  ["ecom", "E-commerce"],
  ["general", "General intro"],
];

export type EmailContext = {
  place: ScannedPlace;
  ownerName: string | null;
  gatekeeper: string | null; // name of who we spoke with on a Not available call
  senderName: string;
  bookingLink: string | null;
};

// The business's top gap: the service with the most findings (ties in the
// usual order), else Website.
export function defaultEmailKind(p: ScannedPlace): EmailKind {
  let best: EmailKind = "website";
  let n = 0;
  SERVICE_ORDER.forEach((s) => {
    const c = p.services.includes(s) ? (p.tags[s] ?? []).length : 0;
    if (c > n) {
      best = s;
      n = c;
    }
  });
  return best;
}

const first = (name: string | null) => (name ? name.trim().split(/\s+/)[0] : null);

function gaps(p: ScannedPlace, kind: EmailKind): string[] {
  const own = kind === "general" ? [] : p.tags[kind] ?? [];
  const rest = SERVICE_ORDER.filter((s) => s !== kind).flatMap((s) => (p.services.includes(s) ? p.tags[s] ?? [] : []));
  return [...own, ...rest].slice(0, 2).map((g) => g.replace(/\s*\u2014\s*/g, ", "));
}

function orList(items: string[]): string {
  return items.length <= 1 ? items.join("") : items.slice(0, -1).join(", ") + " or " + items[items.length - 1];
}

export function buildEmail(kind: EmailKind, ctx: EmailContext): { subject: string; body: string } {
  const p = ctx.place;
  const biz = p.name;
  const hi = first(ctx.ownerName) ? `Hi ${first(ctx.ownerName)},` : "Hi there,";
  const lines: string[] = [hi, ""];
  if (ctx.gatekeeper) lines.push(`I called earlier and spoke with ${first(ctx.gatekeeper)}, so I wanted to follow up by email.`, "");
  const rated = typeof p.rating === "number" && p.reviews > 0;
  const software = plugSoftware(p.tech);
  const found = gaps(p, kind);
  const gapBlock = found.length ? ["A couple of things I noticed while looking you up:", ...found.map((g) => "- " + g), ""] : [];
  const ask = ctx.bookingLink
    ? `Would you be open to a 15-minute call? You can pick a time that works for you here: ${ctx.bookingLink}`
    : "Would you be open to a 15-minute call this week?";
  const sign = ["", "Thanks,", ctx.senderName, "FullyLaunched"];

  if (kind === "ai") {
    lines.push(
      `I'm ${ctx.senderName} with FullyLaunched.` +
        (rated ? ` With ${p.reviews} Google reviews, ${biz} is clearly busy, and busy shops usually have an office buried in paperwork.` : "")
    );
    lines.push(
      "",
      "We build AI tools that plug into the software you already use" +
        (software.length ? ` (like ${orList(software)})` : "") +
        " and take over the office paperwork: turning vendor invoices into purchase orders, following up on quotes and unpaid invoices, entering job and parts details, and pulling reports. Your team just reviews and approves.",
      "",
      "For example, we built a tool for Comfort x Design, an HVAC company, that reads their vendor invoices and creates the purchase orders automatically. Their office was spending about 16 hours a month typing those in by hand.",
      ""
    );
    lines.push(...gapBlock, ask, ...sign);
    return { subject: `Less office paperwork at ${biz}`, body: lines.join("\n") };
  }

  if (kind === "website") {
    lines.push(
      `I'm ${ctx.senderName} with FullyLaunched, a local agency that builds fast, simple websites for businesses like yours.` +
        (rated ? ` Your ${p.rating}-star rating from ${p.reviews} Google reviews is better than most, and your website should be working as hard as you do.` : ""),
      ""
    );
    lines.push(...gapBlock);
    lines.push(
      "I put together a short review of your online presence and can show you a sample of what a new site could look like. " + ask,
      ...sign
    );
    return { subject: `A few ideas for the ${biz} website`, body: lines.join("\n") };
  }

  if (kind === "social") {
    lines.push(
      `I'm ${ctx.senderName} with FullyLaunched.` +
        (rated ? ` ${biz} has ${p.reviews} Google reviews, so people clearly like your work. Social media is one of the cheapest ways to keep that in front of local customers.` : ""),
      ""
    );
    lines.push(...gapBlock);
    lines.push(
      "We handle social media for local businesses: the content, the posting and the follow-up, so you stay visible without spending your evenings on it. " + ask,
      ...sign
    );
    return { subject: `Getting ${biz} in front of more local customers`, body: lines.join("\n") };
  }

  if (kind === "general") {
    lines.push(
      `I'm ${ctx.senderName} with FullyLaunched, a local agency.` +
        (rated ? ` ${biz} has a ${p.rating}-star rating from ${p.reviews} Google reviews, so customers clearly like your work.` : ""),
      ""
    );
    lines.push(...gapBlock);
    lines.push(
      "We help businesses like yours get more customers and spend less time on office work: fast websites, social media, online sales, and AI tools that plug into the software you already use and take over paperwork like turning vendor invoices into purchase orders. " +
        ask,
      ...sign
    );
    return { subject: `A few ideas for ${biz}`, body: lines.join("\n") };
  }

  // ecom
  const on = p.marketplaces ?? [];
  lines.push(
    `I'm ${ctx.senderName} with FullyLaunched.` + (on.length ? ` I saw that you already sell on ${orList(on).replace(" or ", " and ")}.` : " I saw that you already sell online."),
    ""
  );
  lines.push(...gapBlock);
  lines.push(
    "We set up and improve online stores and marketplace listings (photos, descriptions and new marketplaces) so your products sell while the shop is closed. " + ask,
    ...sign
  );
  return { subject: `Selling more of ${biz}'s products online`, body: lines.join("\n") };
}

export function gmailComposeUrl(to: string, subject: string, body: string): string {
  return "https://mail.google.com/mail/?" + new URLSearchParams({ view: "cm", fs: "1", to, su: subject, body }).toString();
}
