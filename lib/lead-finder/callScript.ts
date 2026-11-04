import type { PageSpeed, Recommendation, ScannedPlace } from "@/lib/lead-finder/types";

/**
 * Call script built from what the scan found. Ported from Matteo's
 * audit.html buildScripts()/pitchesFor(); wording unchanged except em-dashes
 * (CRM copy rule). Matteo built HTML strings; this returns plain text with
 * two markers the renderer (Step 3, lead drawer) styles:
 *   {{your name}}  a blank for the caller to fill in
 *   ((...))        a stage direction (italic)
 * Screen only. Never part of anything sent to the business.
 */

export type PitchKey = "servicetitan" | "ai" | "website" | "ecom" | "social";

export type Pitch = {
  label: string;
  opener: string;
  hook: string;
  questions: string[];
  pitch: string;
  objections: [string, string][];
  close: string;
};

export type CallScript = {
  scripts: Record<PitchKey, Pitch>;
  order: PitchKey[]; // flagged pitches, best first
  voicemail: string;
  emailBody: string; // plain text, ready to copy
  askFor: string;
};

export function pitchesFor(L: ScannedPlace): PitchKey[] {
  const list: PitchKey[] = [];
  if (L.usesServiceTitan) list.push("servicetitan");
  if (L.tags.ai.length && !L.usesServiceTitan) list.push("ai");
  if (L.tags.website.length) list.push("website");
  if (L.tags.ecom.length) list.push("ecom");
  if (L.tags.social.length) list.push("social");
  if (!list.length) list.push("website");
  return list;
}

// E-commerce leads already sell online (CRM rule, Nov 4), so the hook names
// where they sell and where they don't yet.
const MARKETS = ["Shopify", "Etsy", "Faire", "Amazon", "eBay"];
function orList(items: string[]): string {
  return items.length <= 1 ? items.join("") : items.slice(0, -1).join(", ") + " or " + items[items.length - 1];
}
function andList(items: string[]): string {
  return items.length <= 1 ? items.join("") : items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}
function ecomHook(L: ScannedPlace): string {
  const on = L.marketplaces ?? [];
  if (!on.length) return "I noticed you’re already selling online. A lot of shops like yours grow fastest by adding more marketplaces.";
  const missing = MARKETS.filter((m) => !on.includes(m));
  return "I noticed you’re selling on " + andList(on) + "." +
    (missing.length ? " A lot of shops like yours grow fast by adding " + orList(missing.slice(0, 3)) + "." : "");
}

function firstName(full: string | null): string | null {
  return full ? full.split(" ")[0] : null;
}
const f = (text: string) => "{{" + text + "}}";

export function buildCallScript(L: ScannedPlace, speed: PageSpeed | null, recommendations: Recommendation[]): CallScript {
  const S = speed && !speed.error ? speed : null;
  const owner = firstName(L.ownerName);
  const biz = L.name;
  const me = f("your name");
  const intro =
    (owner ? "Hi, is this " + owner + "?" : "Hi, could I speak with the owner?") +
    " This is " + me + " with FullyLaunched. We’re a local agency that helps businesses like yours";

  // The single most specific thing we found, per pitch.
  const webFinding = (() => {
    if (L.websiteStatus === "No website") return "when I searched for " + biz + " on Google, there wasn’t a website listed, just your Google profile";
    if (L.websiteStatus === "Social page only") return "your Google listing sends people to a Facebook page rather than your own website";
    if (L.websiteStatus === "Broken") return "the website on your Google listing isn’t loading right now. I tried it a couple of times";
    if (L.ads.length && L.tags.website.length) return "you’re running " + L.ads.join(" and ") + ", but the site those ads send people to has some issues that are probably costing you calls";
    if (S && S.performance != null && S.performance < 50) return "Google scores your website " + S.performance + " out of 100 for speed on a phone" + (S.loadTime ? ", it takes about " + S.loadTime + " to show up" : "");
    return (L.tags.website[0] || "your website could be working harder for you").toLowerCase();
  })();

  const common = {
    objections: [
      ["“We’re not interested.”", "Totally fair. Can I ask: is that because things are busy enough already, or because you’ve got someone handling this? ((If busy: “That’s exactly when this pays off. Mind if I email you the one-page audit so it’s there when you have a minute?”))"],
      ["“How much does it cost?”", "It depends on what you actually need, which is why I’d rather spend 15 minutes walking through what we found first. No cost for that call, and you’ll keep the audit either way."],
      ["“We already have someone.”", "Great, then this audit will be useful for them too. Would it help if I sent it over so you can pass it along?"],
      ["“Just send me something.”", "Happy to. What’s the best email? I’ll send the audit we put together on " + biz + ". It’s one page."],
    ] as [string, string][],
    close: "Would you have 15 minutes " + f("Thursday or Friday") + " for me to walk you through the full audit? I can come by in person or do it over the phone, whichever’s easier.",
  };

  const scripts: Record<PitchKey, Pitch> = {
    servicetitan: {
      label: "ServiceTitan / AI",
      opener: intro + " save time on office work. I noticed " + biz + " uses ServiceTitan. Is that right?",
      hook: "The reason I ask: we’re building an AI tool for another HVAC company on ServiceTitan that reads their vendor invoices and turns them into purchase orders automatically. Their office was spending about 16 hours a month typing those in by hand.",
      questions: ["How are vendor invoices getting into ServiceTitan today? Is someone typing them in?", "Roughly how many invoices or POs do you handle a month?", "What’s the most repetitive thing your office does every week?", "Who handles that, and what would they do with an extra two days a month?"],
      pitch: "If any of that sounds familiar, we can probably connect AI directly to your ServiceTitan account so that work happens on its own. Your team just reviews and approves.",
      ...common,
    },
    ai: {
      label: "AI automation",
      opener: intro + " cut down on phone and paperwork time using AI.",
      hook: biz + " has " + L.reviews + " Google reviews, so you’re clearly busy" + (L.complaints && L.complaints.length ? ", and a couple of reviews mention trouble getting a callback or getting scheduled, which usually means the office is stretched" : "") + (L.hasBooking === false ? ". I also noticed there’s no way to book or request service online" : "") + ".",
      questions: ["What eats the most time in your office each week: phones, scheduling, quotes, invoices?", "What software do you run the business on?" + (L.tech.length ? " ((Site suggests: " + L.tech.join(", ") + "))" : ""), "Do calls ever go to voicemail during busy times?", "If you could hand one task to an assistant tomorrow, what would it be?"],
      pitch: "We build AI tools that answer common questions, book appointments and handle data entry, plugged into the software you already use, so nobody has to learn a new system.",
      ...common,
    },
    website: {
      label: "Website",
      opener: intro + " get more customers from Google.",
      hook: "I was looking you up and noticed " + webFinding + "." + (L.rating !== "N/A" ? " Which is a shame, because your " + L.rating + "-star rating is better than most of your competitors’." : ""),
      questions: ["Where do most of your new customers find you right now?", "When someone Googles you, what do you want them to do: call, book, get a quote?", "Has anyone ever told you they couldn’t find your info online?"],
      pitch: "We build fast, simple sites made for phones: your services, your reviews and a big call button. I can even show you a sample of what yours could look like.",
      ...common,
    },
    ecom: {
      label: "E-commerce",
      opener: intro + " sell their products online.",
      hook:
        L.shopify && L.shopify.products
          ? "I was looking at your Shopify store. You’ve got " + L.shopify.products + (L.shopify.capped ? "+" : "") + " products, but " + (L.shopify.noPhoto ? L.shopify.noPhoto + " have no photo and " : "") + L.shopify.thinDescription + " have very short descriptions. That makes it hard for people to buy, and hard for Google to show them."
          : ecomHook(L),
      questions: ["How much of your business comes from online orders right now?", "Have you thought about selling on Etsy, Amazon or Faire?", "Who handles product photos and listings today?"],
      pitch: "We set up and optimize online stores and marketplace listings (photos, descriptions, the works) so your products sell while the shop is closed.",
      ...common,
    },
    social: {
      label: "Social media",
      opener: intro + " get more customers from social media.",
      hook: "I was on your website and noticed " + (L.tags.social[0] || "there aren’t links to any social accounts").toLowerCase() + ". For a business like yours, Instagram and TikTok are some of the cheapest ways to stay in front of local customers.",
      questions: ["Are you posting anywhere right now?", "What usually stops it from happening: time, ideas, photos?", "Which of your services would you most like more people to know about?"],
      pitch: "We handle social media for local businesses (the content, the posting and the follow-up) so you stay visible without spending your evenings on it.",
      ...common,
    },
  };

  const voicemail =
    (owner ? "Hi " + owner : "Hi") + ", this is " + me + " with FullyLaunched. I put together a quick one-page review of how " + biz + " shows up online and found a couple of things worth a look. I’ll send it over, or call me back at " + f("your number") + ". Thanks!";

  const emailBody =
    (owner ? "Hi " + owner : "Hi there") + ",\n\n" +
    "I’m [your name] with FullyLaunched, a local agency. I put together a short review of how " + biz + " shows up online and wanted to share it, no strings attached.\n\n" +
    "A few things stood out:\n" +
    recommendations.slice(0, 3).map((r) => "• " + r.title).join("\n") + "\n\n" +
    "I’ve attached the full one-page audit. If it’s useful, I’d be glad to walk you through it in 15 minutes. Just reply with a time that works.\n\n" +
    "Thanks,\n[your name]\nFullyLaunched\n[your phone]";

  return {
    scripts,
    order: pitchesFor(L),
    voicemail,
    emailBody,
    askFor: L.ownerName ? L.ownerName + " (possible owner)" : "The owner",
  };
}
