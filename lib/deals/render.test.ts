// Run: npm test (node:test through tsx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { clientApprovalBlockers, dealBlockers, investmentLines, sowPlan } from "@/lib/deals/render";
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
  production_notice_days: 7,
  production_setups: "3",
  production_cancel_hours: 48,
} as unknown as Deal;

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
    includes_production_days: false,
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

test("social without production days drops the production and travel sections", () => {
  const items = [item({ id: "s1", label: "Social management", amount: 1500 })];
  const plan = sowPlan({ deal, clientName: "TEST Co", items, content, settings });
  assert.equal(plan.sections.social, true);
  assert.equal(plan.sections.social_production, false);
  assert.equal(plan.sections.social_travel, false);
  assert.deepEqual(dealBlockers({ ...deal, production_notice_days: null } as Deal, items), []);
});

test("production days checked keeps both sections and requires the fields", () => {
  const items = [item({ id: "s1", label: "Social management", amount: 1500, includes_production_days: true })];
  const plan = sowPlan({ deal, clientName: "TEST Co", items, content, settings });
  assert.equal(plan.sections.social_production, true);
  assert.equal(plan.sections.social_travel, true);
  assert.equal(dealBlockers({ ...deal, production_notice_days: null } as Deal, items).length, 1);
});

test("approval needs a current Proposal and SOW", () => {
  const items = [item({ id: "s1" })];
  assert.deepEqual(clientApprovalBlockers(deal, items, []), ["Generate the Proposal first.", "Generate the SOW first."]);
  const docs = [
    { kind: "proposal", version: 1, google_doc_id: "a" },
    { kind: "sow", version: 2, google_doc_id: "b" },
  ];
  assert.deepEqual(clientApprovalBlockers(deal, items, docs), []);
});

test("reporting and support tokens are gone from the SOW plan", () => {
  const plan = sowPlan({ deal, clientName: "TEST Co", items: [item({})], content, settings });
  for (const k of ["reporting_cadence", "reporting_metrics", "support_response"]) assert.ok(!(k in plan.scalars));
});
