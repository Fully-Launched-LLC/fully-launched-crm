import { isBranchSlug, branchLabel, type BranchSlug } from "@/lib/branches";
import type { Project } from "@/lib/types";
import { payDateOf } from "@/lib/timeclock";

// ── duplicate ────────────────────────────────────────────────────────────
// Fields never carried over to a copy: identity/timestamps (DB assigns new
// ones), Stripe links (a copy must not point at the original's Stripe
// customer/subscription/invoices), and scheduled_call (a booked call belongs to one
// engagement). Transactions and project_tasks live in their own tables and
// are never touched. The copy DOES get its own contacts row — the
// sync_contact_from_project trigger creates one on insert, same as any
// other project (one contact row per project engagement, by design).
// lead_id IS carried over: the copy is for the same company, so it points at
// the same business record in the Leads tab.
type DuplicateOmit =
  | "id"
  | "created_at"
  | "updated_at"
  | "stripe_customer_id"
  | "stripe_subscription_id"
  | "subscription_status"
  | "stripe_deposit_invoice_id"
  | "stripe_build_invoice_id"
  | "scheduled_call";

export function duplicateProjectPayload(
  project: Project
): Omit<Project, DuplicateOmit> {
  /* eslint-disable @typescript-eslint/no-unused-vars */
  const {
    id,
    created_at,
    updated_at,
    stripe_customer_id,
    stripe_subscription_id,
    subscription_status,
    stripe_deposit_invoice_id,
    stripe_build_invoice_id,
    scheduled_call,
    ...rest
  } = project;
  /* eslint-enable @typescript-eslint/no-unused-vars */
  return { ...rest, client_name: `${project.client_name} (Copy)` };
}

// ── detail page origin (back link) ──────────────────────────────────────
// The Manage Project page is a separate top-level route, so it can't know
// which view/tab it was opened from. Callers pass it explicitly via
// ?from=table|kanban&tab=<branch slug> rather than relying on router.back(),
// which breaks after client-side view-state changes.
export type ProjectView = "table" | "kanban";

export function projectDetailHref(
  id: string,
  from: ProjectView,
  tab: BranchSlug
): string {
  return `/project/${id}?from=${from}&tab=${tab}`;
}

export function projectOrigin(
  from: string | undefined,
  tab: string | undefined
): { href: string; label: string } {
  const slug: BranchSlug = tab && isBranchSlug(tab) ? tab : "all";
  // Kanban is the default view, so anything other than an explicit
  // from=table (including no param, e.g. arriving from Leads) goes to Kanban.
  const table = from === "table";
  return {
    href: `/projects/${slug}${table ? "?view=table" : ""}`,
    label: `Back to ${branchLabel(slug)} (${table ? "Table" : "Kanban"})`,
  };
}

// ── remove from pipeline ────────────────────────────────────────────────
// Reasons accepted by the remove_from_pipeline() RPC, exactly as the
// database checks them. "Other" needs a note. The revisit reasons send the
// business back to the Leads tab as Not now with a revisit date; the rest
// as Not interested.
export const REMOVE_REASONS = [
  "Not interested",
  "Just networking",
  "Timing / not now",
  "Budget",
  "Went with someone else",
  "Other",
] as const;
export type RemoveReason = (typeof REMOVE_REASONS)[number];

export const REVISIT_REASONS: readonly RemoveReason[] = [
  "Timing / not now",
  "Just networking",
];

export const DEFAULT_REVISIT_MONTHS = 6;

// Calendar date (YYYY-MM-DD) `months` from today in America/Chicago, same
// default the RPC uses. The day is clamped to the target month's length
// (Aug 31 + 6 months = Feb 28/29).
export function revisitDateFromToday(
  months = DEFAULT_REVISIT_MONTHS,
  today: string = payDateOf()
): string {
  const [y, m, d] = today.split("-").map(Number);
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const month = total % 12; // 0-based
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
