# Fully Launched CRM — CLAUDE.md

## Stack & infra

- Next.js 14 (App Router, TypeScript, Tailwind)
- Supabase project `okvjdpqnqyrzpbaneivu` — **intentionally shared** with FL-social-dash, separated by table prefix (FL-social-dash owns the `social_*` tables; never touch those from this repo). This supersedes the original spec's "dedicated Supabase project" requirement.
- Vercel project `fl-crm` (a duplicate empty project named `fully-launched-crm` exists and should stay deleted/unused)
- GitHub: `Fully-Launched/fully-launched-crm`, local path `~/Desktop/Files/Dev/FL/fully-launched-crm`, alias `launch`
- Keep-alive cron: `app/api/keep-alive/route.ts` + `vercel.json`, pings Supabase every 3 days to prevent free-tier auto-pause. Don't duplicate this. **Until 2026-09-23 it never actually ran** — the auth middleware redirected the cron's session-less request to `/login`. Fixed by excluding it in the `middleware.ts` matcher.
- Server-to-server routes (crons, third-party webhooks) must skip the auth middleware: `/api/keep-alive` and everything under `/api/webhooks/` are excluded in the `middleware.ts` matcher. Put new webhooks under `/api/webhooks/<provider>` and have each handler verify its caller itself (e.g. the provider's signature) — nothing upstream authenticates them.

## Auth & nav

- Email/password only, no signup page
- Accounts are created manually in Supabase dashboard → Authentication → **Add User** (not "Invite User" — Invite User triggers an email flow that caused problems last time). Luke sets each person's initial password directly and sends it himself.
- Unauthenticated → redirect to `/login`; authenticated → land on `/dashboard`
- Nav (`components/TopNav.tsx`), two levels. Top: Dashboard / Leads / Projects / Transactions / Contacts / Team. "Projects" goes to `/projects/all` and is highlighted on any `/projects/*` page and on `/project/[id]`; on `/projects/*` a lighter second row shows All / Media / Websites / Ecomm / AI Integration (nav-only labels — routes, branch values, and page headings are unchanged, e.g. `/projects/ai` still says "AI"). Transactions is Admin-only (hidden from nav, page redirects non-Admins; RLS is the real gate). Team is visible to everyone: Admins get the roster manager, everyone else a read-only directory with booking links. Below `sm` the nav collapses to a hamburger dropdown with the Projects sub-tabs nested under an expandable Projects entry.

## Branding

- Brand palette lives in one theme config file (`lib/theme.ts`), single swap point — never hardcode colors in components
- Brand accent is navy `#1B2B4B` (`--color-accent` in `app/globals.css`, replaced `#2563eb`). Any navy use references that variable, not the hex.
- Branch badges are **solid fills**, fixed regardless of brand palette. Values live once in `BRANCH_FILL` (`lib/theme.ts`); `tailwind.config.ts` imports it as `branch-*` colors, and the dashboard chart uses it directly:
  - Media — gold `#B8962E`, **navy text** (`text-accent`; white on this gold is 2.82:1 and fails AA)
  - Websites — brand navy (`var(--color-accent)`)
  - Ecommerce — dark green `#1B4B3A`
  - AI — maroon `#7A1F2A`
  - White text on Websites/Ecommerce/AI.
- Stage badges are **pastel** (`STAGE_COLORS`: `-50` tint, `-700` text, `-200` border, all ≥ 4.5:1): Leads gray, Interested fuchsia, Signed indigo, In Progress amber, Complete green, Subscriber teal, Lost red. The stage *chart* keeps stronger `-500`-ish fills (`STAGE_CHART_COLORS`).
- `tailwind.config.ts` `content` must include `./lib/**` — all badge/pill class strings live in `lib/theme.ts`, and before this was added none of them were generated (badges rendered uncolored).
- Owner/Salesperson pill colors are per person (`memberColors()` in `lib/team.ts`, palettes in `lib/theme.ts`): `PINNED_MEMBER_COLORS` fixes a color by email; everyone else rotates through `MEMBER_COLOR_ROTATION` (purple, orange, emerald, pink, cyan, lime) in `team_members` (`created_at`, `id`) order, so new members get a color with no code change. Adding a member never changes existing colors; removing one shifts the colors of members added after them. Unknown ids render gray.
- **Deliberate exception to "never hardcode team member names":** Luke is pinned to blue by his email (`luke@fullylaunched.com`) in `PINNED_MEMBER_COLORS`. It's keyed on email, not name, so a rename doesn't break it; if his login email changes, update it there. If more per-person colors are wanted, move this to a `team_members.color` column instead of adding emails.

## Data model (confirmed live via Supabase, 2026-09-22)

Live tables: `projects`, `team_members`, `project_tasks`, `transactions`, `leads`, `contacts` — all RLS enabled. Migration 002 (clients→projects rename, category→branch, roles, Transactions/Leads/Contacts, Lost stage, Build/Subscription toggles) is **applied to the live database**. `projects` had 9 rows as of 2026-09-23 (empty as of 2026-09-22). `supabase/migrations/002_projects_transactions_roles.sql` is the source of truth for schema; `supabase/schema.sql` is the historical baseline.

- **Projects** (renamed from `clients`)
- **Branch** (renamed from `category`) — Media, Websites, Ecommerce, AI. Ecommerce was "Marketplace" until migration 008 (constraint + existing rows renamed; `/projects/marketplace` redirects to `/projects/ecommerce` via `next.config.mjs`). The check is now `projects_branch_check` — before 008 it was still named `clients_category_check`.
- **Stage** — Leads → Interested → Signed → In Progress → Complete → Subscriber → Lost. Subscriber is a real, live stage (in `projects_stage_check`); keep it.
- **Owner** — `uuid[]` array of team_member ids; already multi-value. (`project_tasks.owner` is a single `uuid` — intentional.)
- **Transactions** — Admin-only, RLS-gated
- **Leads**, **Contacts** — built
- **Dashboard** (`app/(app)/dashboard/page.tsx`, `components/dashboard/`, `lib/dashboard.ts`, `lib/theme.ts`) — built and committed.
- **Kanban** (`/projects/[branch]?view=kanban`, `components/kanban/`) — built: dnd-kit stage columns sorted by `updated_at` desc, + New Project. Detail page back link reads `?from=`/`?tab=` (`lib/projects.ts`).

### `projects` fields

| Field | Type / Notes |
|---|---|
| client_name | text — the client/company this project is for |
| branch | single-select: Media / Websites / Ecommerce / AI, color-coded badge. Changing branch clears `channels` (`branchChangePatch` in `lib/channels.ts`) |
| channels | `text[]`, nullable (migration 008) — branch-specific channels/platforms. One column for every branch; the input type is presentation only, driven by branch (options in `lib/channels.ts`, no DB check): **Ecommerce** multi-select Faire / Shopify / Etsy / TikTok Shop / Amazon / Walmart / eBay; **Media** multi-select TikTok / Instagram / LinkedIn / Facebook / YouTube / Pinterest; **Websites** single-select Custom / WordPress / Shopify / Squarespace / Wix (stored as a one-element array); **AI** free-text tags (Enter to add). Empty = null. Editable on Manage Project and as a Table column (`components/ChannelsField.tsx`); carried over by Duplicate |
| contact_name | text |
| email | text |
| phone | text |
| stage | single-select, in order: Leads → Interested → Signed → In Progress → Complete → Subscriber → Lost, color-coded badge. Lost is reachable from any stage. |
| lost_reason | text, optional — shown only when stage = Lost |
| owner | multi-select (`uuid[]`) from team_members |
| salesperson | multi-select (`uuid[]`) from team_members — same pattern as owner |
| source | single-select: Cold Call / Email / LinkedIn / Instagram / Facebook / Website / Referral / Relationship / Inbound (Relationship added in migration 004, Inbound in 009) |
| value | $ — **legacy, not shown or edited anywhere in the UI.** Column kept in the DB (not dropped). Money is `build_value` (one-time) and `subscription_value` ($/mo): Table has Build Value / Sub Value columns (editable only when their toggle is on), Kanban cards show whichever apply, and the Dashboard shows Build Pipeline + Subscription MRR tiles and a Build/MRR-by-stage card — all counting every stage, Lost and Complete included |
| target_date | date |
| end_date | date — general project end date (replaces dropped next_step/last_step fields) |
| build | boolean, default false |
| build_value | $ — full price of the build. Meaningful only when `build` is true |
| payment_status | single-select: Waiting for Deposit / Deposit Paid / Waiting for Payment / Paid. Meaningful only when `build` is true |
| build_end_date | date. Meaningful only when `build` is true |
| deposit_percent | numeric, not null, default 50, check 0 < x ≤ 100 (migration 010). Deposit = `build_value × deposit_percent / 100` |
| stripe_deposit_invoice_id / stripe_build_invoice_id | text (migration 010) — the Stripe Invoice sent for each; blocks resending |
| subscription | boolean, default false |
| subscription_value | $/mo. Meaningful only when `subscription` is true |
| deliver_date | date. Meaningful only when `subscription` is true |
| commission_rate | numeric percent, default 10. Applies to Build transactions; Subscription commission is undecided — nothing auto-calculates from it yet |
| scheduled_call | datetime (populated by Cal.com integration) |
| notes | text |
| stripe_customer_id | text |
| stripe_subscription_id | text |
| subscription_status | text (active/past_due/canceled) |

The `build`/`subscription` conditional fields live on the Manage Project page as collapsing sections, not as Table view columns. The `build`/`subscription` booleans themselves are toggleable from the Table view.

### `transactions` fields

| Field | Type / Notes |
|---|---|
| id | uuid, primary key |
| project_id | uuid, nullable, fk → projects — `ON DELETE SET NULL` (migration 003), so transactions survive project deletion, same pattern as `contacts.project_id` |
| amount | numeric, not null |
| date | date, not null, default today |
| payer | text (free text) |
| payee | uuid, fk → team_members — who gets paid out |
| notes | text |
| created_at | timestamptz, default now() |

### `leads` fields

| Field | Type / Notes |
|---|---|
| id | uuid, primary key |
| name | text, not null |
| source | text |
| contact_info | text |
| notes | text |
| created_at | timestamptz, default now() |

Visible/editable to all authenticated users (not role-gated).

### `contacts` sync

`contacts` is its own table (not a filtered view of `projects`) so contacts survive project deletion. One row per project engagement, auto-synced by the `AFTER INSERT OR UPDATE` trigger `projects_sync_contact` → `sync_contact_from_project()` whenever `contact_name`, `email`, `phone`, `client_name`, or `stage` changes. Skipped for blank placeholder projects (no `contact_name`). `project_id` is `unique` and `ON DELETE SET NULL`, so when a project is deleted its contact row stays with `name`/`email`/`phone`/`company`/`stage` frozen at the last synced values. The table itself isn't deduplicated — grouping happens on the Contacts page (`lib/contacts.ts`, display-only):

- **Auto-grouping:** same name + same email when there's an email, otherwise same name + same company (trimmed, case-insensitive). One row per person, showing all their companies, distinct emails/phones, and branch badges (branch comes from the linked project; unknown once it's deleted). The page has no Stage column (one person can be at different stages across projects).
- **Manual merges** (migration 011): select 2+ rows → "Merge as one contact" → pick the name to show. Stored in `contact_merges` (`contact_id` → `primary_contact_id`, one level deep, cascade-deleted with either contact) via the `merge_contacts(p_primary, p_members[])` function, so merges survive syncs — safe because `sync_contact_from_project` upserts on `project_id` and never changes contact ids. Open to all authenticated users, like contacts. **Unmerge** (on merged rows) deletes every `contact_merges` row touching the group — no confirm; rows that still auto-match stay grouped.
- **Editing** (Contacts page, inline name/email/phone): writes to `projects.contact_name` / `email` / `phone` on **every live project** in the group, and the sync trigger updates the contacts rows. With 2+ live projects a confirm step shows the project count, companies, and values being replaced (email edits also change the Stripe invoice recipient). A name/email edit on a multi-row group first pins it with `merge_contacts` so the rename can't split it. Contacts with no live project (all projects deleted) are read-only; frozen rows in a mixed group keep their old values. No separate contacts storage — Projects stays the source of truth.

## Roles

Three-tier: Admin / Manager / Salesperson.

- Role checks apply only to Transactions, team_members writes (migration 005), and project deletion (Admin or Manager, migration 007).
- Never hardcode team member names — roster is data-driven.
- Salesperson role-gating (e.g. Talon: no Transactions access) is implemented via RLS but **not verified end-to-end**. Deferred to a dedicated pass, not bundled into unrelated feature work.
- "+ Add Team Member" UI: role selector across the three roles, roster editable via the app, not hardcoded. New members must be given a role when added; there's no meaningful default.

### Seed roster

Initial team (email pattern `firstname@fullylaunched.com`). This is the starting roster, not a fixed list — it lives in `team_members` and grows via the app.

| Name | Email | Role |
|---|---|---|
| Luke | luke@fullylaunched.com | Admin |
| Tait | tait@fullylaunched.com | Manager |
| Elias | elias@fullylaunched.com | Manager |
| Matteo | matteo@fullylaunched.com | Manager |
| Talon (sales) | talon@fullylaunched.com | Salesperson |

Each needs a Supabase login account (Add User, manual) before the app is handoff-ready.

### Transactions RLS

Unlike most tables (blanket "authenticated = full access"), `transactions` select/insert/update/delete is restricted by the `admin only access` policy to sessions where `auth.jwt() ->> 'email'` matches a `team_members.email` row with `role = 'Admin'`. Direct API access is blocked for non-Admins even if the frontend check is bypassed. Frontend also hides the tab and `/transactions` redirects non-Admins to `/dashboard` server-side (belt-and-suspenders, not the real gate).

### Project delete (migrations 006, 007)

Deleting a project is limited to **Admin or Manager**, enforced by the `admin or manager delete` RLS policy on `projects` (`using (public.is_admin_or_manager())`, migration 007 — replaced 006's Admin-only `admin delete`). Select/insert/update on `projects` stay open to all authenticated users. Salespeople can't delete.

- The only Delete button is on the Manage Project page (`/project/[id]`); the Table view's per-row Delete was removed. Salespeople don't see the button (UI only — RLS is the real gate).
- What deleting a project does: `project_tasks` **cascade** (deleted with it); `transactions` and `contacts` survive with `project_id` set to null.
- An RLS-blocked delete returns no error, just zero rows — delete calls must use `.select()` and check the returned rows.
- On success the page redirects to the `?from=`/`?tab=` origin (`projectOrigin` in `lib/projects.ts`).

## Manage Project page

`/project/[id]` — Build and Subscription sections, project tasks, Delete (Admin/Manager). Live.

**Duplicate project** (any authenticated user): inserts `duplicateProjectPayload()` (`lib/projects.ts`) — same stage, "(Copy)" appended to `client_name`, no id/timestamps/`scheduled_call`/Stripe fields. Tasks and transactions aren't copied. On success it opens the copy's detail page, carrying over `?from=`/`?tab=` so the back link still returns to the original view.

## Leads tab

Placeholder for Matteo's AI Lead Finder, backed by the `leads` table. Each row has an **"Add to Project"** button that creates a new `projects` row (Stage defaults to Leads, `source` carried over if it matches the fixed source list) and sends the user to that project's Manage Project page to fill in the rest. No live AI Lead Finder integration yet — rows are added manually.

## Overdue logic

If Target Date is in the past and Stage is **not** Complete, Subscriber, or Lost → red text + light red background. Same treatment for `project_tasks.due_date` when status ≠ Done.

## Rules

- Schema changes go in new numbered migration files — never edit `schema.sql` directly
- Don't touch DNS for the root domain `fullylaunched.com`
- Brand palette lives in one theme config file (`lib/theme.ts`), single swap point
- Never hardcode team member names
- This repo shares its Supabase project with FL-social-dash by design — never touch `social_*` tables

## Build patterns to apply going forward

(From a prior CRM build's lessons — apply proactively, not as after-the-fact fixes.)

- **Kanban**: `@dnd-kit/core` for drag between Stage columns. Sort cards within each column by `updated_at` descending from the first version — don't ship unsorted. Respect Branch tab filtering. Duplicate lives on the Manage Project page, not on cards (see Manage Project page section).
- **Detail page back button**: track origin view/tab via query param (`?from=table&tab=websites`), not `router.back()` alone — it breaks after client-side view-state changes.
- **Dropdowns inside scroll containers**: the Table view's `overflow-x-auto` wrapper also clips vertically (CSS forces the other axis to `auto`), so absolutely-positioned menus get cut off. Cell and filter dropdowns (`MultiSelectCell`, `BadgeSelectCell`, `ColumnHeader`) render through `components/table/Popover.tsx` — a portal to `document.body`, `position: fixed` from the trigger's rect, flips above when there's no room below. Use it for any new dropdown.
- **Multi-value fields**: array columns from day one, not retrofitted.
- Favicon changes are aggressively cached — test in incognito.
- Vercel Deployment Protection stays off (Settings → Deployment Protection → Disabled).
- Batch schema + UI + data changes into small testable phases, not one large multi-part change.

## Domain

**Live:** `crm.fullylaunched.com` via CNAME, verified on Vercel. No paid Vercel Team needed for a custom domain (that's only for removing the personal-account slug from the default `*.vercel.app` URL).

## Cal.com

Cal.com over Calendly. No team/paid tier — each team member uses their own free individual Cal.com account (on their `@fullylaunched.com` email); scales with headcount at no per-seat cost.

### Stage 1 — booking links (built)

- `team_members.booking_link` (text, migration 002) holds one Cal.com URL per person. **Admin-only edits** on the Team page (TeamManager "Booking link" column; RLS from migration 005). Non-Admins see a read-only directory with each link (open + copy).
- **Book a call** section on the Manage Project page (`components/BookCallSection.tsx`): everyone with a link, the project's Owners first. Links are pre-filled by `bookingUrl()` (`lib/booking.ts`): `name`, `email` (the project's contact), `metadata[project_id]`, `metadata[booked_by]` (current team member).

### Stage 2 — call history (built, migration 012)

- `calls` (one row per Cal.com booking, unique `cal_uid`; status booked / cancelled / rescheduled; `matched_by` metadata / email / manual / none) and `call_projects` (many-to-many — a call links to **every** matching project, e.g. Hesedea ×3). Read-only to the app; written by the webhook with the service role. `assign_call_to_project()` (security definer) links an unmatched call from the Dashboard.
- Webhook `app/api/webhooks/calcom/route.ts` (under `/api/webhooks/`, so exempt from the auth middleware). Verifies `X-Cal-Signature-256` (hex HMAC-SHA256 of the raw body, `lib/calcom.ts`) with one shared `CALCOM_WEBHOOK_SECRET` set on everyone's Cal.com webhook, before reading anything. Events: BOOKING_CREATED (upsert on `cal_uid`), BOOKING_RESCHEDULED (new booking recorded; old one → `rescheduled` + `rescheduled_to_uid`, its project links carried over), BOOKING_CANCELLED (`cancelled`, kept). A re-delivered CREATED never un-cancels. Project links are only ever added, so manual assignments survive. PING / unknown events → 200. Handler errors → 500 so Cal.com retries. Needs `SUPABASE_SERVICE_ROLE_KEY` + `CALCOM_WEBHOOK_SECRET`.
- **Payload field names** (`uid`, `startTime`, `organizer.email`, `attendees[]`, `metadata`, `rescheduleUid` / `fromReschedule`) follow Cal.com's docs but weren't verified against a live delivery when built — check the first real booking.
- Matching: `metadata.project_id` first (**confirm with a real test booking that metadata reaches the webhook before relying on it**), else attendee email vs `projects.email` (trimmed, case-insensitive) across projects in **every** stage; no match → stored unlinked and shown on the Dashboard's "Unmatched calls" card. Organizer matched to `team_members.email`.
- Shown: **Calls** section on the Manage Project page (`components/CallHistory.tsx`: when / with / team member (+ booked by) / status — Upcoming, Completed (= booked + past, `lib/calls.ts`), Cancelled, Rescheduled; upcoming first, then past). Dashboard: "Upcoming Scheduled Calls" (booked, next 7 days) reads from `calls`; **"Unmatched Calls"** card lists booked calls with no project link, each with a project picker + "Assign to project" (`assign_call_to_project()`). `projects.scheduled_call` stays in the schema, unused.
- Call times render in the viewer's timezone via `components/LocalDateTime.tsx` (client-side; server rendering would use UTC).

## Stripe

API keys server-side only, from env vars, never hardcoded. Start in **test mode** (`sk_test_…`).

### Piece 1 — Deposit / Build invoices (built, migration 010)

- **Env vars** (`.env.local` + Vercel, none are `NEXT_PUBLIC_`): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`. Nothing works until these are set; the build doesn't need them (clients are created lazily).
- **Stripe webhook endpoint:** `https://crm.fullylaunched.com/api/webhooks/stripe`, events `invoice.paid` and `invoice.payment_failed`.
- **Buttons** (Manage Project → Build section → Invoicing): "Send Deposit Invoice ($X)" while `payment_status` is unset / Waiting for Deposit, "Send Build Invoice ($X)" once it reaches Deposit Paid. **Admin or Manager only** — `POST /api/projects/[id]/invoice` returns 403 otherwise; the UI check just hides the buttons. A confirm dialog shows amount + recipient before sending.
- **Amounts** (`lib/billing.ts`, integer cents, shared by UI and route): deposit = `build_value × deposit_percent / 100`; Build invoice = **the balance** (`build_value − deposit`), not the full amount. `deposit_percent` (default 50) is editable in the Build section and locks once the deposit invoice is sent.
- **Stripe Invoices, not Checkout** (Checkout links expire after 24h): `collection_method: "send_invoice"` — Stripe emails it, **due in 14 days** (`INVOICE_DAYS_UNTIL_DUE`), never auto-charged. Draft with only our line item → finalize → send; every Stripe write has an idempotency key, so double-clicks/retries don't send twice. Invoice metadata carries `project_id` + `kind`.
- **Customer: one per company**, matched by `client_name` (trimmed, case-insensitive) across projects that already have a `stripe_customer_id`. The customer's email is **overwritten with the project's contact email on every send** (Stripe emails invoices to the customer's address).
- **No in-app resend/void.** After sending, the Invoicing field shows "… invoice sent · View in Stripe"; resend or void in the Stripe dashboard. `stripe_deposit_invoice_id` / `stripe_build_invoice_id` block a second send.
- **Webhook** (`app/api/webhooks/stripe/route.ts`, excluded from the auth middleware): verifies the Stripe signature before anything else. `invoice.paid` → `payment_status` Deposit Paid / Paid, only for invoices this app created (metadata) whose id matches the stored one, and never moves status backwards. `invoice.payment_failed` → logged only, no action. Writes via the service-role client (`lib/supabase/admin.ts`, server-only, bypasses RLS — webhook use only).
- Duplicate never copies `stripe_*` ids.
- `payment_status` is still hand-editable by any authenticated user (projects update isn't role-gated) — known gap, not addressed.

### Piece 2 — Subscriptions (not built)

- "Send Monthly Invoice" (Subscription section) is still a placeholder notice.
- Plan: Subscription-toggled projects use Stripe Subscriptions, store `stripe_subscription_id`, surface `subscription_status` (Stripe statuses include incomplete, trialing, active, past_due, canceled, unpaid, paused). Webhooks `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`.
- **Deferred:** Subscription auto-charge — do NOT build without a separate explicit decision. Open: failed-payment handling, proration, billing-event notifications.

## Deferred / explicitly out of scope

- Salesperson role-gating end-to-end verification
- Cal.com stage 2 — webhook + call history (see Cal.com section)
- Stripe subscriptions (Piece 2); automatic subscription charging needs a separate decision before building (see Stripe section)
- Customer-facing portal (separate client auth) — own future project, not started
- AI-generated proposals/SoWs, LinkedIn OAuth, notifications — no defined format/scope yet

## Current punch list (priority order)

1. ~~"+ Add Team Member" screen (three-role picker)~~ — done, shipped in 247e927
2. Load real client data — get Luke's actual client list first, don't invent sample data (all tables are currently empty)
3. Cal.com: set `CALCOM_WEBHOOK_SECRET` on Vercel, set up each person's Cal.com webhook + booking link, then a real test booking to confirm metadata/payload fields
4. Stripe: set env vars + webhook endpoint (test mode) and test Deposit/Build invoices end to end; then Piece 2 (subscriptions)
