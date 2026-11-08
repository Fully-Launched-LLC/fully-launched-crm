// Every dollar figure in every Deal Desk document is rendered here, by code,
// from deal_line_items. Shared by the CRM, the generator, the sign page and
// the signed PDF so the numbers always agree.
import {
  DEAL_BRANCHES,
  type DealBranch,
  type DealLineItem,
  type Selections,
} from "@/lib/deals/types";

export function money(n: number): string {
  const whole = Math.round(n * 100) % 100 === 0;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function sortItems(items: DealLineItem[]): DealLineItem[] {
  return [...items].sort(
    (a, b) =>
      DEAL_BRANCHES.indexOf(a.branch) - DEAL_BRANCHES.indexOf(b.branch) ||
      a.sort_order - b.sort_order ||
      a.label.localeCompare(b.label)
  );
}

export function itemsByBranch(items: DealLineItem[]): Map<DealBranch, DealLineItem[]> {
  const map = new Map<DealBranch, DealLineItem[]>();
  for (const item of sortItems(items)) {
    const list = map.get(item.branch) ?? [];
    list.push(item);
    map.set(item.branch, list);
  }
  return map;
}

// A tier is a line item with a tier_name. Tiers in one branch are
// alternatives: the client picks one (or declines the section).
export const isTier = (i: DealLineItem) => !!i.tier_name?.trim();

// The choices the client makes at signature, per branch.
export type ChoiceGroup = {
  branch: DealBranch;
  tiers: DealLineItem[]; // radio: one tier or Declined
  optional: DealLineItem[]; // checkboxes
  required: DealLineItem[]; // always included
};

export function choiceGroups(items: DealLineItem[]): ChoiceGroup[] {
  const groups: ChoiceGroup[] = [];
  for (const [branch, list] of Array.from(itemsByBranch(items))) {
    groups.push({
      branch,
      tiers: list.filter(isTier),
      optional: list.filter((i) => !isTier(i) && i.optional),
      required: list.filter((i) => !isTier(i) && !i.optional),
    });
  }
  return groups;
}

// True when the SOW needs a Package Selection section.
export function hasChoices(items: DealLineItem[]): boolean {
  return items.some((i) => isTier(i) || i.optional);
}

export function defaultSelections(items: DealLineItem[]): Selections {
  const ids: string[] = [];
  for (const g of choiceGroups(items)) {
    ids.push(...g.required.map((i) => i.id));
    ids.push(...g.optional.filter((i) => i.selected_by_default).map((i) => i.id));
    if (g.tiers.length) {
      const pick = g.tiers.find((t) => t.selected_by_default) ?? g.tiers[0];
      ids.push(pick.id);
    }
  }
  return { items: ids };
}

// Server-side check of what the client submitted: required items in, at
// most one tier per branch, nothing unknown.
export function validateSelections(items: DealLineItem[], sel: Selections): string | null {
  const known = new Set(items.map((i) => i.id));
  const chosen = new Set(sel.items);
  for (const id of Array.from(chosen)) if (!known.has(id)) return "Unknown item in the selection";
  for (const g of choiceGroups(items)) {
    for (const r of g.required) if (!chosen.has(r.id)) return `${r.label} is required`;
    if (g.tiers.filter((t) => chosen.has(t.id)).length > 1) return "Pick one tier per section";
  }
  if (!items.some((i) => chosen.has(i.id))) return "Select at least one item";
  return null;
}

export type Totals = {
  oneTime: number;
  monthly: number;
  deposit: number;
  dueAtLaunch: number;
  hourly: DealLineItem[];
};

export function totals(items: DealLineItem[], selected?: Selections): Totals {
  const ids = selected ? new Set(selected.items) : null;
  const picked = items.filter((i) => !ids || ids.has(i.id));
  const oneTime = round2(picked.filter((i) => i.kind === "one_time").reduce((s, i) => s + Number(i.amount), 0));
  const monthly = round2(picked.filter((i) => i.kind === "monthly").reduce((s, i) => s + Number(i.amount), 0));
  const deposit = round2(oneTime / 2);
  return {
    oneTime,
    monthly,
    deposit,
    dueAtLaunch: round2(oneTime - deposit),
    hourly: picked.filter((i) => i.kind === "hourly"),
  };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

// "$1,500 one-time" / "$800 per month" / "$100/hour as needed".
export function priceText(i: DealLineItem): string {
  const a = money(Number(i.amount));
  if (i.kind === "monthly") return `${a} per month`;
  if (i.kind === "hourly") return `${a}/hour as needed`;
  return `${a} one-time`;
}

// The default package: required items, optional ones selected by default,
// and one tier per branch (the selected_by_default one, else the first).
export function defaultItems(items: DealLineItem[]): DealLineItem[] {
  const ids = new Set(defaultSelections(items).items);
  return items.filter((i) => ids.has(i.id));
}

export function overageText(i: DealLineItem): string | null {
  if (i.overage_rate == null || i.hours_included == null) return null;
  return `+${money(Number(i.overage_rate))}/hr over ${fmtHours(i.hours_included)} hours`;
}

// "Tier 1 (Starter)" or the label.
export function itemName(i: DealLineItem, tierNo?: number | null): string {
  return tierNo != null ? `Tier ${tierNo} (${i.tier_name})` : i.label;
}

export const fmtHours = (h: number) => (Number.isInteger(Number(h)) ? String(Number(h)) : Number(h).toFixed(1));

// "deposit" if any one-time item is selected, else "first monthly payment".
export function firstPayment(items: DealLineItem[], sel?: Selections): string {
  const ids = sel ? new Set(sel.items) : null;
  return items.some((i) => i.kind === "one_time" && (!ids || ids.has(i.id)))
    ? "deposit"
    : "first monthly payment";
}

export function joinNatural(parts: string[]): string {
  const p = parts.filter(Boolean);
  if (p.length <= 1) return p[0] ?? "";
  if (p.length === 2) return `${p[0]} and ${p[1]}`;
  return `${p.slice(0, -1).join(", ")}, and ${p[p.length - 1]}`;
}
