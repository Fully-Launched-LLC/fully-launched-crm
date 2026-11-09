import { test } from "node:test";
import assert from "node:assert/strict";
import { computeInternal } from "@/lib/deals/internal";
import type { Deal, DealLineItem, DealSettings } from "@/lib/deals/types";

const settings = {
  project_hourly_rate: 60,
  management_hourly_rate: 50,
  commission_pct: 10,
  earn_up_pct: 10,
  earn_up_ends: "2027-12-31",
  default_overage_rate: 100,
} as DealSettings;

const deal = {
  id: "d1",
  date_issued: "2026-11-09",
  target_start: "2026-11-16",
  target_launch: "2027-01-15",
  est_project_hours: 40,
  owner_id: "m1",
} as unknown as Deal;

const items = [
  { id: "w", branch: "website", label: "Site", kind: "one_time", amount: 6000, optional: false, selected_by_default: true, tier_name: null },
  { id: "s", branch: "social", label: "Social", kind: "monthly", amount: 1000, optional: false, selected_by_default: true, tier_name: null },
] as unknown as DealLineItem[];

test("internal doc: commission and earn-up 10% of cash, labor = project hours x rate", () => {
  const d = computeInternal(deal, items, settings);
  // 12 months from Nov 2026: 6,000 one-time + 1,000 x 10 months (Jan to Oct 2027).
  assert.equal(d.totals.cash, 16000);
  assert.equal(d.totals.commission, 1600);
  assert.equal(d.totals.earnUp, 1600);
  assert.equal(d.totals.labor, 2400);
  assert.equal(d.totals.margin, 16000 - 1600 - 1600 - 2400);
  assert.ok(/10% of deal value/.test(d.basis));
});

test("internal doc: margin incomplete without a project rate", () => {
  const d = computeInternal(deal, items, { ...settings, project_hourly_rate: null });
  assert.equal(d.totals.labor, null);
  assert.equal(d.totals.margin, null);
  assert.equal(d.marginIncomplete, true);
});
