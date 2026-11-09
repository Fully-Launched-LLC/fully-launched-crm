// The one renderer: line items + AI text -> the token plan that fills the
// CRM Master Proposal / CRM Master SOW Google Docs. The filled Doc is frozen
// to PDF at approval, and that PDF is what the client sees and signs, so
// what's approved is exactly what's signed. Every dollar figure comes from
// lib/deals/money.ts here, never from the model.
import type { DocPlan } from "@/lib/deals/google";
import {
  choiceGroups,
  defaultItems,
  firstPayment,
  fmtHours,
  hasChoices,
  isTier,
  itemName,
  itemsByBranch,
  joinNatural,
  money,
  overageText,
  priceText,
  sortItems,
  totals,
} from "@/lib/deals/money";
import type { ProposalContent, SowContent } from "@/lib/deals/ai";
import {
  DEAL_BRANCH_NAMES,
  type Deal,
  type DealBranch,
  type DealLineItem,
  type DealSettings,
} from "@/lib/deals/types";

export function fmtDate(d: string | null | undefined): string {
  if (!d) return "TBD";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

// Shown where data is missing ([[EDIT: ...]] is the general pattern: any
// token the CRM can't fill renders this way, see fillDocument). Approval is
// blocked until it's removed in Google Docs.
export const edit = (what: string) => `[[EDIT: ${what}]]`;

export const DATE_RANGES = { issued: "deal_date_issued", valid: "deal_valid_through" } as const;

function dateTokens(deal: Deal) {
  return [
    { token: "date_issued", rangeName: DATE_RANGES.issued, text: fmtDate(deal.date_issued) },
    { token: "valid_through", rangeName: DATE_RANGES.valid, text: fmtDate(deal.valid_through) },
  ];
}

export function workstreams(items: DealLineItem[]): string {
  const names: string[] = [];
  for (const [branch, list] of Array.from(itemsByBranch(items))) {
    if (branch === "other") names.push(...list.map((i) => i.label));
    else names.push(DEAL_BRANCH_NAMES[branch]);
  }
  return joinNatural(names);
}

const OWNED: Record<DealBranch, string | null> = {
  website: "website",
  social: "content",
  marketplace: "listings",
  ai_tool: "tools and code",
  other: null,
};

export function ownedAssets(items: DealLineItem[]): string {
  return joinNatural(
    Array.from(itemsByBranch(items).keys())
      .map((b) => OWNED[b])
      .filter((x): x is string => !!x)
  ) || "work";
}

// "Tier 1 (Starter): $2,500 one-time" / "Maintenance: $150 per month".
function itemLine(i: DealLineItem, tierNo: number | null): string {
  const extra = [overageText(i), i.optional ? "optional" : null].filter(Boolean).join(", ");
  const head = `${itemName(i, tierNo)}: ${priceText(i)}`;
  return extra ? `${head} (${extra})` : head;
}

function branchItemLines(list: DealLineItem[]): string[] {
  let n = 0;
  return list.map((i) => itemLine(i, isTier(i) ? ++n : null));
}

// ---- Proposal ---------------------------------------------------------------

export function proposalPlan(args: {
  deal: Deal;
  clientName: string;
  items: DealLineItem[];
  content: ProposalContent;
}): DocPlan {
  const { deal, clientName, items, content } = args;
  const scalars: Record<string, string> = {
    client_name: clientName,
    project_goal: content.project_goal,
    overview: content.overview,
    timeline_estimate: content.timeline.estimate,
    meeting_cadence: content.timeline.meeting_cadence,
    retainer_covers: content.retainer_covers,
  };
  const lists: Record<string, string[]> = {
    expected_outcomes: content.expected_outcomes,
    investment: investmentLines(items, content.retainer_covers),
  };
  for (let n = 1; n <= 4; n++) {
    const ph = content.phases[n - 1];
    scalars[`phase_${n}_name`] = ph?.name ?? "";
    // The master's phase lines are plain paragraphs written "- item".
    lists[`phase_${n}`] = (ph?.bullets ?? []).map((b) => `- ${b}`);
  }
  return {
    sections: {},
    scalars,
    lists,
    tables: [],
    namedTokens: dateTokens(deal),
    sectionNumberTokens: {},
  };
}

// Investment, by code, from the default package. With no one-time item:
// no build / deposit / handoff lines, "First month due at signature".
export function investmentLines(items: DealLineItem[], retainerCovers: string): string[] {
  const def = defaultItems(items);
  const t = totals(def);
  const lines: string[] = [];
  if (t.oneTime > 0) {
    lines.push(`Initial Build: ${money(t.oneTime)}`);
    lines.push(`50% deposit (${money(t.deposit)}) due before Phase 1`);
    lines.push(`50% (${money(t.dueAtLaunch)}) due before handoff`);
  } else if (t.monthly > 0) {
    lines.push("First month due at signature");
  }
  for (const i of sortItems(def)) {
    const o = overageText(i);
    if (o) lines.push(`Safety Net: ${o}`);
  }
  if (t.monthly > 0) {
    const covers = retainerCovers?.trim();
    lines.push(`Ongoing Retainer: ${money(t.monthly)}/month${covers ? ` (${lowerFirst(covers.replace(/\.$/, ""))})` : ""}`);
  }
  for (const i of sortItems(def).filter((x) => x.kind === "hourly")) lines.push(`${i.label}: ${priceText(i)}`);
  if (items.some((i) => i.optional || isTier(i)))
    lines.push("Optional items and tiers are chosen when signing the Statement of Work.");
  lines.push("Future builds and scope changes are quoted separately.");
  return lines;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// ---- SOW --------------------------------------------------------------------

export function sowPlan(args: {
  deal: Deal;
  clientName: string;
  items: DealLineItem[];
  content: SowContent;
  settings: DealSettings;
}): DocPlan {
  const { deal, clientName, items, content } = args;
  const byBranch = itemsByBranch(items);
  const present = new Set(byBranch.keys());
  const section = (b: DealBranch) => content.sections.find((s) => s.branch === b);

  const website = byBranch.get("website") ?? [];
  const websiteMonthly = website.filter((i) => i.kind === "monthly");
  const market = byBranch.get("marketplace") ?? [];
  const marketMonthly = market.filter((i) => i.kind === "monthly");
  const retainer = marketMonthly[0];

  const scalars: Record<string, string> = {
    client_name: clientName,
    target_launch: deal.target_launch ? fmtDate(deal.target_launch) : edit("target launch date"),
    week1_dates: week1(deal.target_start),
    workstreams: workstreams(items),
    brand_sentence: content.brand_sentence,
    first_payment: firstPayment(items),
    owned_assets: ownedAssets(items),
    reporting_cadence: deal.reporting_cadence || "monthly",
    reporting_metrics: deal.reporting_metrics?.trim() || edit("reporting metrics"),
    support_response: deal.support_response || "Same-day",
    assumptions: content.assumptions,
    maintenance_amount: websiteMonthly.length
      ? `${money(websiteMonthly.reduce((s, i) => s + Number(i.amount), 0))} per month`
      : "",
    maintenance_covers: section("website")?.covers || edit("what maintenance covers"),
    optimization_period: edit("optimization period"),
    retainer_amount: retainer ? money(Number(retainer.amount)) : "",
    retainer_hours: retainer?.hours_included != null ? fmtHours(retainer.hours_included) : edit("retainer hours"),
    retainer_covers: section("marketplace")?.covers || edit("what the retainer covers"),
    overage_rate:
      retainer?.overage_rate != null ? money(Number(retainer.overage_rate)) : edit("overage rate"),
    production_notice_days:
      deal.production_notice_days != null ? String(deal.production_notice_days) : edit("notice days"),
    production_setups: deal.production_setups?.trim() || edit("setups per day"),
    production_cancel_hours: String(deal.production_cancel_hours ?? 48),
  };

  const lists: Record<string, string[]> = {};
  for (const b of ["website", "marketplace", "social", "ai_tool", "other"] as DealBranch[]) {
    const list = byBranch.get(b) ?? [];
    const s = section(b);
    scalars[`${b}_intro`] = s?.intro ?? "";
    lists[`${b}_items`] = branchItemLines(list.filter((i) => !(b === "website" && i.kind === "monthly")));
    lists[`${b}_deliverables`] = deliverableLines(list, s?.deliverables ?? []);
  }
  // Spec name for the website list.
  lists.website_tiers = lists.website_items;
  lists.ai_tool_phases = (section("ai_tool")?.phases ?? []).map(
    (p) => `${p.name}: ${p.bullets.join("; ")}`
  );
  lists.fees_items = feesLines(items);
  // Plain bullets; the master's fixed line after them says selections are
  // recorded at electronic signature.
  lists.package_selection_items = choiceGroups(items).flatMap((g) => {
    const out: string[] = [];
    const name = g.branch === "other" ? "Other" : DEAL_BRANCH_NAMES[g.branch];
    if (g.tiers.length) {
      out.push(
        `${name}: ${joinNatural(g.tiers.map((t, n) => `${itemName(t, n + 1)} at ${priceText(t)}`).concat("Declined")).replace(/, and Declined$| and Declined$/, ", or Declined")}`
      );
    }
    for (const o of g.optional) out.push(`${name}: ${o.label} at ${priceText(o)}, optional (or Declined)`);
    return out;
  });

  // Change requests: rate from the branch's overage rate, else "Quoted".
  const rateFor = (b: DealBranch) => {
    const it = (byBranch.get(b) ?? []).find((i) => i.overage_rate != null);
    return it ? `${money(Number(it.overage_rate))}/hour` : "Quoted";
  };

  return {
    sections: {
      overview_multi: present.size > 1,
      overview_single: present.size <= 1,
      website: present.has("website"),
      website_maintenance: websiteMonthly.length > 0,
      marketplace: present.has("marketplace"),
      social: present.has("social"),
      social_travel: present.has("social"),
      social_production: present.has("social"),
      ai_tool: present.has("ai_tool"),
      other: present.has("other"),
      package_selection: hasChoices(items),
      // "One-time build fees are billed 50% at execution..." (Fees). Kept when
      // the deal has any one-time item, optional ones included: the client
      // can pick one at signature and the signed SOW must carry its terms.
      one_time_terms: items.some((i) => i.kind === "one_time"),
    },
    scalars,
    lists,
    tables: [
      { key: "timeline", rows: content.timeline_rows.map((r) => [r.period, r.dates, r.milestone]) },
      { key: "dependencies", rows: content.dependencies.map((d) => [d.dependency, d.detail]) },
      {
        key: "change_requests",
        rows: content.change_request_services
          .filter((c) => present.has(c.branch))
          .map((c) => [c.service, rateFor(c.branch), c.approval]),
      },
    ],
    namedTokens: dateTokens(deal),
    sectionNumberTokens: {
      selection_section_number: /package selection/i,
      dependencies_section_number: /dependencies/i,
    },
  };
}

// Fees: each item, tiers numbered per branch; with no one-time item in the
// default package, "First month due at signature" leads.
function feesLines(items: DealLineItem[]): string[] {
  const lines: string[] = [];
  const t = totals(defaultItems(items));
  if (t.oneTime === 0 && t.monthly > 0) lines.push("First month due at signature");
  for (const [, list] of Array.from(itemsByBranch(items))) {
    let n = 0;
    for (const i of list) {
      const name = isTier(i) ? itemName(i, ++n) : i.label;
      lines.push(`${name} is billed at ${priceText(i)}${i.optional || isTier(i) ? " (if selected)" : ""}`);
    }
  }
  return lines;
}

// "November 9 to November 15, 2026" from target_start (Week 1 = its first 7 days).
function week1(start: string | null): string {
  if (!start) return edit("week 1 dates");
  const [y, m, d] = start.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1, d + 6));
  const endIso = end.toISOString().slice(0, 10);
  const short = (iso: string) => fmtDate(iso).replace(/, \d{4}$/, "");
  return `${short(start)} to ${short(endIso)}, ${end.getUTCFullYear()}`;
}

function deliverableLines(list: DealLineItem[], del: { item_id: string; bullets: string[] }[]): string[] {
  const many = list.length > 1;
  const out: string[] = [];
  for (const i of list) {
    const d = del.find((x) => x.item_id === i.id);
    if (!d) continue;
    const label = isTier(i) ? `${i.tier_name}` : i.label;
    for (const b of d.bullets) out.push(many ? `${label}: ${b}` : b);
  }
  return out;
}

// Approval blockers that don't need the Doc (the Doc's own text is checked
// for leftovers separately).
export function dealBlockers(deal: Deal, items: DealLineItem[]): string[] {
  const out: string[] = [];
  if (!items.length) out.push("Add at least one line item.");
  if (items.some((i) => i.branch === "social")) {
    if (deal.production_notice_days == null || !deal.production_setups?.trim() || deal.production_cancel_hours == null)
      out.push("Social is included: fill in the production-day fields (notice days, setups, cancellation hours).");
  }
  return out;
}
