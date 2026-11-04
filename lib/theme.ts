// Branch badge colors are fixed regardless of brand palette (functional,
// not brand). Brand colors themselves live in app/globals.css CSS variables
// and tailwind.config.ts — never hardcode brand colors in components.

// Brand navy for the one place that can't read --color-accent
// (app/globals.css): the theme-color meta tag (app/layout.tsx). Keep in sync
// with --color-accent, and with public/manifest.json (static JSON, so it
// repeats the navy and tan hex values).
export const BRAND_NAVY_HEX = "#1B2B4B";

export type Branch = "Media" | "Websites" | "Ecommerce" | "AI";

// Order and values mirror the `projects_branch_check` constraint (migration
// 008, which renamed Marketplace -> Ecommerce).
export const BRANCHES: Branch[] = ["Media", "Websites", "Ecommerce", "AI"];

// Branch palette: solid fills, visually distinct from the pastel stage
// badges. The single source for these values — tailwind.config.ts registers
// them as `branch-*` colors (used below), and the dashboard chart reads them
// directly. Websites is the brand navy, so it points at the shared
// --color-accent (app/globals.css) rather than repeating the hex.
export const BRANCH_FILL: Record<Branch, string> = {
  Media: "#B8962E", // gold
  Websites: "var(--color-accent)", // brand navy #1B2B4B
  Ecommerce: "#1B4B3A", // dark green
  AI: "#7A1F2A", // maroon
};

// White text on each fill, except Media: white on gold is 2.82:1 (fails
// WCAG AA), brand-navy text is 4.98:1. Border matches the fill so filled and
// pastel badges are the same size.
export const BRANCH_COLORS: Record<Branch, string> = {
  Media: "bg-branch-media text-accent border border-branch-media",
  Websites: "bg-branch-websites text-white border border-branch-websites",
  Ecommerce: "bg-branch-ecommerce text-white border border-branch-ecommerce",
  AI: "bg-branch-ai text-white border border-branch-ai",
};

// Kanban card borders (1px all round + a 4px left stripe, set by the card) in
// the branch color. Border only, no fill: the solid branch colors are too dark
// for card text, and Websites' navy is a CSS variable, which Tailwind v3
// can't tint with an opacity modifier.
export const BRANCH_CARD_BORDERS: Record<Branch, string> = {
  Media: "border-branch-media",
  Websites: "border-branch-websites",
  Ecommerce: "border-branch-ecommerce",
  AI: "border-branch-ai",
};

// Chart fills (recharts can't consume Tailwind classes). The branch chart
// always pairs these with a text label, never color alone.
export const BRANCH_CHART_COLORS: Record<Branch, string> = BRANCH_FILL;

export type Stage =
  | "Leads"
  | "Interested"
  | "Signed"
  | "In Progress"
  | "Complete"
  | "Subscriber"
  | "Lost";

// Order mirrors the `projects_stage_check` constraint in
// supabase/migrations/002_projects_transactions_roles.sql, which is the
// source of truth. Kanban columns, the Table's stage sort, and the dashboard
// all follow this order — if the constraint changes, update this list too.
export const STAGES: Stage[] = [
  "Leads",
  "Interested",
  "Signed",
  "In Progress",
  "Complete",
  "Subscriber",
  "Lost",
];

// Stage badge colors: Leads gray, Interested fuchsia, Signed indigo, In
// Progress amber, Complete green, Subscriber teal, Lost red.
// Pastel: -50 tint, -700 text, -200 border. Every pair is >= 4.5:1 (WCAG AA
// for the badges' 12px text); the tightest is Complete at 4.79:1.
export const STAGE_COLORS: Record<Stage, string> = {
  Leads: "bg-neutral-50 text-neutral-700 border border-neutral-200",
  Interested: "bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200",
  Signed: "bg-indigo-50 text-indigo-700 border border-indigo-200",
  "In Progress": "bg-amber-50 text-amber-700 border border-amber-200",
  Complete: "bg-green-50 text-green-700 border border-green-200",
  Subscriber: "bg-teal-50 text-teal-700 border border-teal-200",
  Lost: "bg-red-50 text-red-700 border border-red-200",
};

// Hex equivalents of STAGE_COLORS for chart fills. Same hue family as the
// badges above; the stage chart always keeps its x-axis category labels on
// so identity never depends on color alone (Complete/Subscriber sit close
// together for full-color viewers too).
export const STAGE_CHART_COLORS: Record<Stage, string> = {
  Leads: "#737373",
  Interested: "#d946ef",
  Signed: "#6366f1",
  "In Progress": "#f59e0b",
  Complete: "#22c55e",
  Subscriber: "#0d9488",
  Lost: "#ef4444",
};

// Call status badges (lib/calls.ts callDisplayStatus), same pastel pattern as
// the stage badges.
export const CALL_STATUS_COLORS: Record<
  "Upcoming" | "Completed" | "Cancelled" | "Rescheduled",
  string
> = {
  Upcoming: "bg-indigo-50 text-indigo-700 border border-indigo-200",
  Completed: "bg-green-50 text-green-700 border border-green-200",
  Cancelled: "bg-red-50 text-red-700 border border-red-200",
  Rescheduled: "bg-amber-50 text-amber-700 border border-amber-200",
};

// Time clock status pills (Timesheets, /clock). Same pastel pattern as the
// stage badges. "Forgot to clock out?" uses the overdue red.
export const TIME_STATUS_COLORS: Record<
  "Open" | "Forgot to clock out?" | "Pending approval" | "Approved",
  string
> = {
  Open: "bg-amber-50 text-amber-700 border border-amber-200",
  "Forgot to clock out?": "bg-red-50 text-red-700 border border-red-200",
  "Pending approval": "bg-indigo-50 text-indigo-700 border border-indigo-200",
  Approved: "bg-green-50 text-green-700 border border-green-200",
};

// Stages that no longer count as "active" for overdue-date highlighting.
export const CLOSED_STAGES: Stage[] = ["Complete", "Subscriber", "Lost"];

export type Source =
  | "Cold Call"
  | "Email"
  | "LinkedIn"
  | "Instagram"
  | "Facebook"
  | "Website"
  | "Referral"
  | "Relationship"
  | "Inbound";

export const SOURCES: Source[] = [
  "Cold Call",
  "Email",
  "LinkedIn",
  "Instagram",
  "Facebook",
  "Website",
  "Referral",
  "Relationship",
  "Inbound",
];

export type PaymentStatus =
  | "Waiting for Deposit"
  | "Deposit Paid"
  | "Waiting for Payment"
  | "Paid";

export const PAYMENT_STATUSES: PaymentStatus[] = [
  "Waiting for Deposit",
  "Deposit Paid",
  "Waiting for Payment",
  "Paid",
];

// Per-person pill colors for Owner/Salesperson (assigned in memberColors(),
// lib/team.ts). Pinned members are matched by email — stable across name
// changes. Everyone else gets the next color in the rotation, in roster
// order, so a newly added member gets a color with no code change.
export const PINNED_MEMBER_COLORS: Record<string, string> = {
  "luke@fullylaunched.com": "bg-blue-100 text-blue-800 border border-blue-300",
};

export const MEMBER_COLOR_ROTATION: string[] = [
  "bg-purple-100 text-purple-800 border border-purple-300",
  "bg-orange-100 text-orange-800 border border-orange-300",
  "bg-emerald-100 text-emerald-800 border border-emerald-300",
  "bg-pink-100 text-pink-800 border border-pink-300",
  "bg-cyan-100 text-cyan-800 border border-cyan-300",
  "bg-lime-100 text-lime-800 border border-lime-300",
];

// Fallback for an id with no roster row (e.g. a deleted member still listed
// on a project).
export const UNKNOWN_MEMBER_COLOR =
  "bg-neutral-100 text-neutral-700 border border-neutral-300";

export type Role = "Admin" | "Manager" | "Salesperson";

// Mirrors the `team_members_role_check` constraint (migration 002), which is
// the source of truth — if the constraint changes, update this list too.
export const ROLES: Role[] = ["Admin", "Manager", "Salesperson"];

// Lead status badges (leads.status, migration 017). Same pastel pattern as
// the stage badges; interested matches the Interested stage (fuchsia),
// converted matches Complete (green), not interested matches Lost (red).
export const LEAD_STATUS_COLORS: Record<
  "new" | "contacted" | "replied" | "interested" | "converted" | "not_interested" | "dead",
  string
> = {
  new: "bg-neutral-50 text-neutral-700 border border-neutral-200",
  contacted: "bg-sky-50 text-sky-700 border border-sky-200",
  replied: "bg-amber-50 text-amber-700 border border-amber-200",
  interested: "bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200",
  converted: "bg-green-50 text-green-700 border border-green-200",
  not_interested: "bg-red-50 text-red-700 border border-red-200",
  dead: "bg-stone-100 text-stone-600 border border-stone-300",
};

// Lead Finder: ServiceTitan badge and the website-status warning text.
export const SERVICETITAN_BADGE = "bg-tan text-accent border border-tan";
