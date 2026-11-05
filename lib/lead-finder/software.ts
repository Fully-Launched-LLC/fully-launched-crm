// Software spotted on a business's website (scanner TECH_PATTERNS; only
// what the website itself shows), grouped for the "Runs on:" badges in
// results, the side preview, the dossier and exports. Field-service and
// CRM tools feed the AI / back-office pitch (callScript.ts, emailTemplates.ts).
// Site builders (WordPress, Wix, ...), Shopify and QuickBooks aren't "Runs on".

export type SoftwareGroup = "field" | "crm" | "reviews" | "chat" | "industry" | "payments";

export const SOFTWARE_GROUPS: [SoftwareGroup, string, string[]][] = [
  ["field", "Field service", [
    "ServiceTitan", "Housecall Pro", "Jobber", "FieldRoutes", "ScheduleEngine", "Service Fusion", "FieldEdge", "Workiz",
    "Successware", "BuildOps", "ServiceTrade", "Kickserv", "GorillaDesk", "Service Autopilot", "JobNimbus", "AccuLynx",
  ]],
  ["crm", "CRM / marketing", [
    "HubSpot", "Salesforce", "Zoho", "Keap", "GoHighLevel", "ActiveCampaign", "Pipedrive", "Mailchimp", "Klaviyo", "Constant Contact",
  ]],
  ["reviews", "Reviews / messaging", ["Podium", "Birdeye", "NiceJob", "Broadly", "Weave", "Signpost"]],
  ["chat", "Chat", ["Intercom", "Drift", "Tidio", "LiveChat", "tawk.to", "Facebook chat"]],
  ["industry", "Industry", [
    "Clio", "Mindbody", "Vagaro", "Boulevard", "Booksy", "NexHealth", "Zocdoc", "Lighthouse 360", "RevenueWell", "Toast", "ChowNow", "Square Online",
  ]],
  ["payments", "Payments / booking", ["Square", "Stripe", "Calendly", "Acuity"]],
];

// Scanner names carrying a parent ("FieldRoutes (ServiceTitan)") read as the tool.
const display = (t: string) => t.replace(/\s*\(ServiceTitan\)$/, "");

export type SoftwareFound = { group: SoftwareGroup; label: string; tools: string[] };

export function softwareGroups(tech: string[] | null | undefined): SoftwareFound[] {
  const names = new Set((tech ?? []).map(display));
  return SOFTWARE_GROUPS.map(([group, label, list]) => ({ group, label, tools: list.filter((n) => names.has(n)) })).filter(
    (g) => g.tools.length > 0
  );
}

// Every "Runs on" tool, in group order.
export function runsOn(tech: string[] | null | undefined): string[] {
  return softwareGroups(tech).flatMap((g) => g.tools);
}

// "Field service: Housecall Pro; Reviews / messaging: Podium" (exports).
export function runsOnText(tech: string[] | null | undefined): string {
  return softwareGroups(tech)
    .map((g) => `${g.label}: ${g.tools.join(", ")}`)
    .join("; ");
}

export function fieldSoftware(tech: string[] | null | undefined): string[] {
  return softwareGroups(tech).find((g) => g.group === "field")?.tools ?? [];
}

// Software we build AI / back-office tools on top of: field service, then CRM.
export function plugSoftware(tech: string[] | null | undefined): string[] {
  const g = softwareGroups(tech);
  return [...(g.find((x) => x.group === "field")?.tools ?? []), ...(g.find((x) => x.group === "crm")?.tools ?? [])];
}
