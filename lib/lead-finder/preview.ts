import "server-only";

/**
 * Instant mockup generator: a one-page site preview for a business, built
 * from its Lead Finder data. Ported from Matteo's server.js /preview.
 * Served at /api/lead-finder/preview (login-only for now; public share links
 * are a later task). Copy unchanged except em-dashes (CRM copy rule). The
 * preview's own palettes are the mockup's design, not CRM UI.
 */

export type PreviewInput = {
  name: string;
  type?: string;
  phone?: string;
  address?: string;
  rating?: string;
  reviews?: string;
  mapsUrl?: string;
  hours?: string; // weekday lines joined with "||"
};

const PALETTES: Record<string, { bg1: string; bg2: string; accent: string; accentText: string }> = {
  navy: { bg1: "#1B2B4B", bg2: "#2E4380", accent: "#C4A882", accentText: "#1B2B4B" },
  warm: { bg1: "#7A3B1E", bg2: "#B5602E", accent: "#F2C879", accentText: "#4A2A12" },
  clay: { bg1: "#5C3A2E", bg2: "#8C5A3C", accent: "#E3A857", accentText: "#3F2A18" },
  forest: { bg1: "#1F3A2E", bg2: "#345C45", accent: "#C9D98A", accentText: "#1F3A2E" },
  charcoal: { bg1: "#221F1F", bg2: "#3A2F2F", accent: "#D9743C", accentText: "#221F1F" },
  teal: { bg1: "#0F3D3E", bg2: "#1C6B67", accent: "#9FE0D4", accentText: "#0F3D3E" },
  slate: { bg1: "#22314A", bg2: "#3C5578", accent: "#9CC4E4", accentText: "#22314A" },
  plum: { bg1: "#3A1F35", bg2: "#5C3355", accent: "#E8B7DA", accentText: "#3A1F35" },
};

const WHY_US = ["Locally Owned & Operated", "Trusted by the Community", "Fast, Reliable Service", "Satisfaction Guaranteed"];

type Copy = { keywords?: string[]; palette: string; tagline: string; blurb: string; services: [string, string][] };

const CATEGORY_COPY: Copy[] = [
  { keywords: ["barber", "hair", "salon"], palette: "plum", tagline: "Sharp Cuts, Every Time", blurb: "{name} brings skill and precision to every chair, from classic cuts to modern styles.",
    services: [["Haircuts & Fades", "Precision cuts for every style"], ["Beard Trims", "Sharp lines, clean fades"], ["Hot Towel Shaves", "A classic, relaxing finish"], ["Kids Cuts", "Patient, friendly service"]] },
  { keywords: ["spa", "massage", "beauty", "nail"], palette: "plum", tagline: "Relax, Refresh, Renew", blurb: "{name} offers a calm, welcoming space to unwind and feel your best.",
    services: [["Massage Therapy", "Tension relief, tailored to you"], ["Facials", "Refresh and rejuvenate"], ["Nail Care", "Manicures & pedicures"], ["Packages", "Bundled treatments, better value"]] },
  { keywords: ["restaurant", "cafe", "diner", "eatery", "bistro", "pizza"], palette: "warm", tagline: "Fresh Food, Made With Care", blurb: "{name} serves up made-to-order meals in a welcoming atmosphere, every single day.",
    services: [["Dine-In", "A comfortable place to eat"], ["Takeout", "Ready when you are"], ["Catering", "For your next event"], ["Daily Specials", "Something new, worth trying"]] },
  { keywords: ["bakery", "bake"], palette: "warm", tagline: "Fresh Baked, Every Morning", blurb: "{name} bakes from scratch daily, because good food takes care.",
    services: [["Custom Cakes", "Made for your occasion"], ["Daily Pastries", "Fresh out of the oven"], ["Catering", "Sweets for any event"], ["Special Orders", "Just ask"]] },
  { keywords: ["roof"], palette: "clay", tagline: "Built to Last, Overhead", blurb: "{name} protects what matters most with expert roofing installation and repair.",
    services: [["Roof Repair", "Fast fixes, done right"], ["Full Replacements", "Built to last decades"], ["Storm Damage", "Insurance-ready assessments"], ["Free Inspections", "Know before you need it"]] },
  { keywords: ["construction", "contractor", "remodel", "renovation", "builder"], palette: "clay", tagline: "Quality Built, From the Ground Up", blurb: "{name} turns plans into reality with skilled craftsmanship and clear communication.",
    services: [["Remodels", "Kitchens, baths & more"], ["New Construction", "Built to your spec"], ["Additions", "More space, done right"], ["Free Estimates", "No surprises, ever"]] },
  { keywords: ["paint"], palette: "clay", tagline: "A Fresh Coat, Done Right", blurb: "{name} delivers clean, professional painting for homes and businesses.",
    services: [["Interior Painting", "Precise, tidy work"], ["Exterior Painting", "Weather-ready finishes"], ["Cabinet Refinishing", "Like-new results"], ["Free Estimates", "Fast, no-pressure quotes"]] },
  { keywords: ["landscap", "lawn", "garden"], palette: "forest", tagline: "Outdoor Spaces You'll Love", blurb: "{name} keeps your property looking its best, season after season.",
    services: [["Lawn Care", "Consistent, reliable upkeep"], ["Landscape Design", "Spaces built around you"], ["Seasonal Cleanup", "Ready for what is next"], ["Irrigation", "Healthy, efficient watering"]] },
  { keywords: ["pest"], palette: "forest", tagline: "Pest-Free, Guaranteed", blurb: "{name} keeps homes and businesses protected with safe, effective treatments.",
    services: [["Inspections", "Know what you are dealing with"], ["Treatment Plans", "Targeted, effective solutions"], ["Prevention", "Stop problems before they start"], ["Emergency Service", "Fast response when it counts"]] },
  { keywords: ["auto", "mechanic", "car repair", "tire"], palette: "charcoal", tagline: "Honest Work, Every Visit", blurb: "{name} keeps your vehicle running right with reliable, upfront service.",
    services: [["Oil Changes", "Quick, no-wait service"], ["Brakes & Tires", "Safety first"], ["Diagnostics", "Find the real issue, fast"], ["General Repair", "Done right the first time"]] },
  { keywords: ["gym", "fitness", "training"], palette: "charcoal", tagline: "Stronger, Every Session", blurb: "{name} helps members of every level reach their fitness goals.",
    services: [["Memberships", "Flexible plans for every goal"], ["Personal Training", "One-on-one coaching"], ["Group Classes", "Motivation built in"], ["Open Gym", "Train on your schedule"]] },
  { keywords: ["dental", "dentist"], palette: "teal", tagline: "Healthy Smiles Start Here", blurb: "{name} provides gentle, modern dental care for the whole family.",
    services: [["Cleanings & Exams", "Preventive care, done gently"], ["Fillings", "Comfortable, modern care"], ["Whitening", "Brighten your smile"], ["Emergency Care", "When you need it most"]] },
  { keywords: ["veterinar", "pet", "animal hospital"], palette: "teal", tagline: "Caring For Your Best Friend", blurb: "{name} provides compassionate, expert care for pets of all kinds.",
    services: [["Wellness Exams", "Routine checkups, done right"], ["Vaccinations", "Keeping pets protected"], ["Surgery", "Skilled, compassionate care"], ["Emergency Care", "Here when it matters"]] },
  { keywords: ["clean"], palette: "teal", tagline: "A Spotless Space, Guaranteed", blurb: "{name} brings a thorough, reliable clean to every home and office.",
    services: [["Home Cleaning", "Consistent, detailed service"], ["Office Cleaning", "A clean workplace, maintained"], ["Move-Out Cleans", "Leave it spotless"], ["Recurring Service", "Set it and forget it"]] },
  { keywords: ["plumb"], palette: "slate", tagline: "Fast, Reliable Plumbing", blurb: "{name} is ready to solve your plumbing problems, big or small.",
    services: [["Leak Repair", "Stop damage before it spreads"], ["Drain Cleaning", "Clear, fast, thorough"], ["Water Heaters", "Installed & repaired"], ["Emergency Service", "Available when you need it"]] },
  { keywords: ["electric"], palette: "slate", tagline: "Powering Your Home & Business", blurb: "{name} delivers safe, code-compliant electrical work you can trust.",
    services: [["Wiring & Repairs", "Safe, up-to-code work"], ["Panel Upgrades", "Power for modern homes"], ["Lighting", "Function and style"], ["Inspections", "Peace of mind, verified"]] },
  { keywords: ["hvac", "heating", "cooling", "air condition"], palette: "slate", tagline: "Comfort, All Year Round", blurb: "{name} keeps your home or business comfortable no matter the season.",
    services: [["AC Repair", "Fast relief when it counts"], ["Heating Service", "Stay warm, reliably"], ["Installations", "Modern, efficient systems"], ["Maintenance Plans", "Fewer surprises, lower bills"]] },
  { keywords: ["moving", "movers"], palette: "slate", tagline: "Moving Made Simple", blurb: "{name} handles your move with care, so you do not have to worry.",
    services: [["Local Moves", "Careful, efficient service"], ["Packing", "Done right, start to finish"], ["Long Distance", "Reliable, wherever you are headed"], ["Free Quotes", "No surprises on moving day"]] },
  { keywords: ["real estate", "realtor", "realty"], palette: "navy", tagline: "Your Next Move Starts Here", blurb: "{name} guides buyers and sellers through every step with local expertise.",
    services: [["Buying", "Find the right fit"], ["Selling", "Get the best value"], ["Market Analysis", "Know what it is worth"], ["Consultations", "No-pressure guidance"]] },
  { keywords: ["law", "attorney", "legal"], palette: "navy", tagline: "Trusted Legal Guidance", blurb: "{name} advocates for clients with clear advice and dedicated representation.",
    services: [["Consultations", "Understand your options"], ["Case Review", "Thorough, honest assessment"], ["Representation", "On your side, every step"], ["Document Prep", "Handled with care"]] },
  { keywords: ["account", "tax", "bookkeep"], palette: "navy", tagline: "Numbers You Can Count On", blurb: "{name} keeps your finances organized and your taxes stress-free.",
    services: [["Tax Prep", "Accurate, on time"], ["Bookkeeping", "Clean books, year-round"], ["Payroll", "Simple, reliable payroll"], ["Consulting", "Guidance when you need it"]] },
];

const DEFAULT_COPY: Copy = {
  palette: "navy",
  tagline: "Quality Service You Can Trust",
  blurb: "{name} is proud to serve the local community with dependable, professional service.",
  services: [["Consultations", "Let us talk about your needs"], ["Custom Solutions", "Tailored to the job"], ["Reliable Service", "On time, every time"], ["Local Expertise", "Rooted in the community"]],
};

function getCopyForType(type: string | undefined): Copy {
  const lower = (type || "").toLowerCase();
  const match = CATEGORY_COPY.find((c) => (c.keywords || []).some((k) => lower.includes(k)));
  return match || DEFAULT_COPY;
}

function escapeHtml(str: string | undefined | null): string {
  return String(str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Only http(s) Maps links are allowed into hrefs.
function safeHttpUrl(url: string | undefined): string {
  if (!url) return "#";
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? escapeHtml(u.href) : "#";
  } catch {
    return "#";
  }
}

export function previewHtml(q: PreviewInput): string {
  const { name, type, phone, address, rating, reviews, mapsUrl, hours } = q;
  const copy = getCopyForType(type);
  const pal = PALETTES[copy.palette] || PALETTES.navy;
  const safeName = escapeHtml(name);
  const tagline = escapeHtml(copy.tagline);
  const blurb = escapeHtml(copy.blurb.replace("{name}", name));
  const servicesHtml = copy.services.map(([n, d]) => `<div class="svc-card"><h3>${escapeHtml(n)}</h3><p>${escapeHtml(d)}</p></div>`).join("");
  const whyUsHtml = WHY_US.map((w) => `<div class="why-item">${escapeHtml(w)}</div>`).join("");
  const safePhone = escapeHtml(phone || "");
  const telHref = safePhone.replace(/[^0-9+]/g, "");
  const safeAddress = escapeHtml(address || "");
  const safeMapsUrl = safeHttpUrl(mapsUrl);
  const hasRating = rating && rating !== "N/A";
  const ratingHtml = hasRating ? `<div class="rating-badge">★ ${escapeHtml(rating)} <span>(${escapeHtml(reviews || "0")} Google reviews)</span></div>` : "";
  const hoursLines = hours ? hours.split("||").filter(Boolean) : [];
  const hoursHtml = hoursLines.length
    ? `<div class="hours-section"><h2>Hours</h2><ul class="hours-list">${hoursLines.map((h) => `<li>${escapeHtml(h)}</li>`).join("")}</ul></div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>${safeName}</title>
<style>
  :root{ --bg1:${pal.bg1}; --bg2:${pal.bg2}; --accent:${pal.accent}; --accentText:${pal.accentText}; --page-bg:#F8F7F4; --white:#fff; }
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1B2B4B;line-height:1.6;background:var(--page-bg);}
  .preview-badge{background:#1B2B4B;color:#fff;text-align:center;padding:9px 16px;font-size:12.5px;letter-spacing:0.02em;}
  .preview-badge b{color:var(--accent);}
  nav{background:var(--bg1);padding:16px 24px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;}
  nav .brand{color:#fff;font-weight:700;font-size:17px;}
  nav .links{display:flex;gap:22px;flex-wrap:wrap;}
  nav .links a{color:rgba(255,255,255,0.75);text-decoration:none;font-size:14px;font-weight:600;}
  nav .links a:hover{color:#fff;}
  .hero{background:linear-gradient(135deg, var(--bg1), var(--bg2));color:#fff;padding:70px 24px 80px;text-align:center;}
  .hero h1{font-size:clamp(28px,5vw,46px);font-weight:700;margin-bottom:14px;}
  .hero p.tagline{font-size:18px;color:var(--accent);margin-bottom:22px;}
  .rating-badge{display:inline-block;background:rgba(255,255,255,0.14);padding:8px 18px;border-radius:100px;font-size:14px;margin-bottom:26px;}
  .rating-badge span{color:rgba(255,255,255,0.7);}
  .cta-row{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;}
  .btn{padding:14px 28px;border-radius:8px;font-weight:600;text-decoration:none;font-size:15px;display:inline-block;border:none;cursor:pointer;}
  .btn-primary{background:var(--accent);color:var(--accentText);}
  .btn-secondary{background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.4);}
  .why-strip{background:var(--white);border-bottom:1px solid #E4DFD3;display:flex;justify-content:center;flex-wrap:wrap;gap:0;}
  .why-item{padding:18px 26px;font-size:13.5px;font-weight:600;color:#4A5A78;border-right:1px solid #EDE9DE;}
  .why-item:last-child{border-right:none;}
  .section{max-width:840px;margin:0 auto;padding:64px 24px;text-align:center;}
  .section h2{font-size:28px;margin-bottom:16px;color:#1B2B4B;}
  .section > p{font-size:16px;color:#4A5A78;max-width:600px;margin:0 auto;}
  .services-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:18px;margin-top:36px;text-align:left;}
  .svc-card{background:var(--white);border:1px solid #E4DFD3;border-radius:12px;padding:22px 20px;}
  .svc-card h3{font-size:15.5px;margin-bottom:8px;color:var(--bg1);}
  .svc-card p{font-size:13.5px;color:#6A7690;}
  .hours-section{background:var(--white);border-top:1px solid #E4DFD3;border-bottom:1px solid #E4DFD3;padding:50px 24px;text-align:center;}
  .hours-list{list-style:none;max-width:320px;margin:20px auto 0;font-size:14.5px;color:#4A5A78;}
  .hours-list li{padding:6px 0;border-bottom:1px solid #EDE9DE;}
  .contact{background:var(--page-bg);padding:56px 24px;text-align:center;}
  .contact-info{font-size:16px;margin:20px 0;color:#4A5A78;}
  footer{background:var(--bg1);color:rgba(255,255,255,0.8);text-align:center;padding:48px 24px;}
  footer h3{color:#fff;font-size:22px;margin-bottom:10px;}
  footer p{max-width:480px;margin:0 auto 22px;font-size:15px;}
</style>
</head>
<body>
  <div class="preview-badge">This is a <b>free preview</b> built by FullyLaunched, not ${safeName}'s official website</div>

  <nav>
    <div class="brand">${safeName}</div>
    <div class="links"><a href="#about">About</a><a href="#services">Services</a><a href="#contact">Contact</a></div>
  </nav>

  <section class="hero">
    <h1>${safeName}</h1>
    <p class="tagline">${tagline}</p>
    ${ratingHtml}
    <div class="cta-row">
      ${safePhone ? `<a class="btn btn-primary" href="tel:${telHref}">Call Now</a>` : ""}
      <a class="btn btn-secondary" href="${safeMapsUrl}" target="_blank" rel="noopener">Get Directions</a>
    </div>
  </section>

  <div class="why-strip">${whyUsHtml}</div>

  <section class="section" id="about">
    <h2>About</h2>
    <p>${blurb}</p>
  </section>

  <section class="section" id="services" style="padding-top:0;">
    <h2>Services</h2>
    <div class="services-grid">${servicesHtml}</div>
  </section>

  ${hoursHtml}

  <div class="contact" id="contact">
    <h2>Visit Us</h2>
    <div class="contact-info">${safeAddress}${safePhone ? " &middot; " + safePhone : ""}</div>
    <a class="btn btn-primary" href="${safeMapsUrl}" target="_blank" rel="noopener">Get Directions</a>
  </div>

  <footer>
    <h3>Want a real website like this for ${safeName}?</h3>
    <p>FullyLaunched builds fast, affordable websites for local businesses. This preview took seconds; a real one takes days, not months.</p>
  </footer>
</body>
</html>`;
}
