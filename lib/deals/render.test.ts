// Run: npm test (node:test through tsx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { investmentLines, sowPlan } from "@/lib/deals/render";
import type { SowContent } from "@/lib/deals/ai";
import type { Deal, DealLineItem, DealSettings } from "@/lib/deals/types";

const deal = {
  id: "d1",
  project_id: "p1",
  status: "draft",
  date_issued: "2026-11-09",
  valid_through: "2026-12-09",
  target_start: "2026-11-16",
  target_launch: "2027-01-15",
  reporting_cadence: "monthly",
  reporting_metrics: "Followers, reach",
  support_response: "Same-day",
  production_notice_days: 7,
  production_setups: "3",
  production_cancel_hours: 48,
} as Deal;

const item = (p: Partial<DealLineItem>): DealLineItem =>
  ({
    id: p.id ?? "i",
    deal_id: "d1",
    branch: "social",
    label: "Item",
    description: null,
    tier_name: null,
    kind: "monthly",
    amount: 1000,
    hours_included: null,
    overage_rate: null,
    selected_by_default: true,
    optional: false,
    is_productized_tool: false,
    sort_order: 0,
    ...p,
  }) as DealLineItem;

const content: SowContent = {
  brand_sentence: "Brand.",
  sections: [],
  timeline_rows: [],
  dependencies: [],
  change_request_services: [],
  assumptions: "Assumptions.",
} as unknown as SowContent;

const settings = {} as DealSettings;

test("monthly-only deal: no one-time terms, no deposit lines", () => {
  const items = [item({ id: "s1", label: "Social management", amount: 1500 })];
  const plan = sowPlan({ deal, clientName: "TEST Co", items, content, settings });
  assert.equal(plan.sections.one_time_terms, false);
  assert.equal(plan.scalars.first_payment, "first monthly payment");
  assert.equal(plan.lists.fees_items[0], "First month due at signature");
  assert.ok(!plan.lists.fees_items.some((l) => /deposit|50%/i.test(l)));

  const inv = investmentLines(items, "Content and posting");
  assert.ok(inv.includes("First month due at signature"));
  assert.ok(!inv.some((l) => /deposit|Initial Build|handoff/i.test(l)));
  assert.ok(inv.some((l) => l.startsWith("Ongoing Retainer: $1,500/month")));
});

test("deal with a one-time item keeps the one-time terms and deposit", () => {
  const items = [
    item({ id: "w1", branch: "website", label: "Website", kind: "one_time", amount: 5000 }),
    item({ id: "s1", label: "Social management", amount: 1500 }),
  ];
  const plan = sowPlan({ deal, clientName: "TEST Co", items, content, settings });
  assert.equal(plan.sections.one_time_terms, true);
  assert.equal(plan.scalars.first_payment, "deposit");
  const inv = investmentLines(items, "");
  assert.ok(inv.includes("Initial Build: $5,000"));
  assert.ok(inv.some((l) => l.startsWith("50% deposit ($2,500)")));
});

test("an optional one-time item still keeps the one-time terms", () => {
  const items = [
    item({ id: "s1", label: "Social management", amount: 1500 }),
    item({ id: "a1", branch: "ai_tool", label: "AI tool", kind: "one_time", amount: 3000, optional: true, selected_by_default: false }),
  ];
  const plan = sowPlan({ deal, clientName: "TEST Co", items, content, settings });
  assert.equal(plan.sections.one_time_terms, true);
});
