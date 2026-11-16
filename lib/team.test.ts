import { test } from "node:test";
import assert from "node:assert/strict";
import { activeMembers, memberColors, pickableMembers } from "@/lib/team";
import { defaultOwnerFor } from "@/lib/leads/convert";
import { MEMBER_COLORS, UNKNOWN_MEMBER_COLOR } from "@/lib/theme";
import type { TeamMember } from "@/lib/types";

function member(p: Partial<TeamMember> & { id: string }): TeamMember {
  return {
    name: p.id,
    email: `${p.id}@example.com`,
    role: "Manager",
    booking_link: null,
    lead_branches: [],
    color: null,
    archived_at: null,
    created_at: "2026-09-01T00:00:00Z",
    ...p,
  };
}

const luke = member({ id: "luke", role: "Admin", color: "violet", lead_branches: ["AI", "Websites"] });
const elias = member({ id: "elias", color: "slate", lead_branches: ["Websites"], archived_at: "2026-11-16T00:00:00Z" });
const matteo = member({ id: "matteo", color: "teal", lead_branches: ["Ecommerce"] });
const fresh = member({ id: "fresh" });
const roster = [elias, luke, matteo, fresh];

test("pill colors come from the stored color name; none stored is gray", () => {
  const c = memberColors(roster);
  assert.equal(c.get("luke"), MEMBER_COLORS.violet);
  assert.equal(c.get("matteo"), MEMBER_COLORS.teal);
  assert.equal(c.get("elias"), MEMBER_COLORS.slate);
  assert.equal(c.get("fresh"), UNKNOWN_MEMBER_COLOR);
});

test("archived members are left out of active lists", () => {
  assert.deepEqual(activeMembers(roster).map((m) => m.id), ["luke", "matteo", "fresh"]);
});

test("pickers keep an archived member only while selected", () => {
  assert.deepEqual(pickableMembers(roster).map((m) => m.id), ["luke", "matteo", "fresh"]);
  assert.deepEqual(pickableMembers(roster, ["elias"]).map((m) => m.id), ["elias", "luke", "matteo", "fresh"]);
  assert.deepEqual(pickableMembers(roster, [null]).map((m) => m.id), ["luke", "matteo", "fresh"]);
});

test("default Websites owner skips archived members", () => {
  // Elias is first in the roster and still lists Websites, but he's archived.
  assert.equal(defaultOwnerFor("Websites", roster), "luke");
  assert.equal(defaultOwnerFor("Ecommerce", roster), "matteo");
  assert.equal(defaultOwnerFor("Media", roster), null);
});
