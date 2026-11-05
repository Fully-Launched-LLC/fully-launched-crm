import type { PageSpeed, Recommendation, ScannedPlace } from "@/lib/lead-finder/types";

/**
 * Turn findings into plain-English recommendations, most important first.
 * Ported from Matteo's server.js buildRecommendations(); only em-dashes in
 * the copy were swapped for commas/colons (CRM copy rule). Pure, so the
 * client can compute it once PageSpeed comes back.
 */
export function buildRecommendations(lead: ScannedPlace, speed: PageSpeed | null): Recommendation[] {
  const recs: Recommendation[] = [];
  const status = lead.websiteStatus;
  const perf = speed && !speed.error ? speed.performance : null;
  const loadTime = speed && !speed.error ? speed.loadTime : undefined;
  if (status === "No website" || status === "Social page only") {
    recs.push({ title: "Launch a real website", why: "Customers who search for you on Google find " + (status === "No website" ? "no website at all" : "only a social media page") + ". A simple, fast site with your services, reviews and a call button turns those searches into calls." });
  } else if (status === "Broken") {
    recs.push({ title: "Fix your website: it isn’t loading", why: "When we visited, your site returned an error. Every customer who clicks it from Google right now hits a dead end." });
  }
  if (perf != null && perf < 50) {
    recs.push({ title: "Make the site fast on phones", why: `Google scores your site ${perf}/100 for phone speed${loadTime ? " (main content takes " + loadTime + " to appear)" : ""}. Slow sites lose visitors before they ever see your phone number.` });
  }
  if (lead.tags.website.some((t) => /phones/.test(t))) recs.push({ title: "Make the site work on phones", why: "Your site isn’t set up for mobile screens, and most local searches happen on a phone." });
  if (lead.tags.website.some((t) => /secure/.test(t))) recs.push({ title: "Add a security certificate (https)", why: "Browsers show “Not secure” on your site, which scares off customers and hurts your Google ranking." });
  if (lead.tags.website.some((t) => /outdated/.test(t))) recs.push({ title: "Refresh an outdated site", why: "Your site hasn’t been updated in years. A modern design builds trust before the first call." });
  if (lead.ads && lead.ads.length && lead.tags.website.length) recs.push({ title: "Stop wasting ad spend", why: `You’re paying for ${lead.ads.join(" and ")}, but the site those ads send people to has problems, so you’re paying for clicks that don’t turn into customers.` });
  if (lead.tags.social.length) recs.push({ title: "Build a social media presence", why: lead.tags.social[0] + ". Consistent posting on Instagram/TikTok keeps you in front of local customers for free." });
  // E-commerce leads already sell online (CRM rule, Nov 4): the pitch is
  // better listings and more marketplaces, never "start selling online".
  const ecomTitles = new Set<string>();
  lead.tags.ecom.forEach((t) => {
    const title = /^Shopify store/.test(t) ? "Improve your Shopify listings" : "Sell on more marketplaces";
    if (ecomTitles.has(title)) return;
    ecomTitles.add(title);
    recs.push({ title, why: t + "." });
  });
  if (lead.tags.ai.length) {
    const st = lead.usesServiceTitan;
    recs.push({
      title: "Automate the office work with AI",
      why: st
        ? "You use ServiceTitan. We build AI tools that plug into ServiceTitan and take over the office paperwork: vendor invoices turned into purchase orders automatically, follow-ups on quotes and unpaid invoices, job and parts data entry, and reports. For Comfort x Design, an HVAC company on ServiceTitan, our purchase order reader does this on its own. Their office was spending about 16 hours a month typing invoices in by hand."
        : "Businesses like yours lose hours every week to office paperwork. We build AI tools that plug into the software you already use and do that work for you: vendor invoices turned into purchase orders automatically, follow-ups on quotes and unpaid invoices, job and parts data entry, and reports. For Comfort x Design, an HVAC company, our purchase order reader saves their office about 16 hours a month.",
    });
  }
  // AI work is our highest-value service, so if it applies, put it near the top.
  const aiIdx = recs.findIndex((r) => r.title.startsWith("Automate"));
  if (aiIdx > 1) recs.splice(1, 0, recs.splice(aiIdx, 1)[0]);
  return recs.slice(0, 5);
}
