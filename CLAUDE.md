# Fully Launched CRM — CLAUDE.md

## Current status (keep under 30 lines)

- Live at `crm.fullylaunched.com`. Projects (25 rows), leads (32), contacts (26) have real data as of 2026-10-30.
- Built: Projects (Table/Kanban/Manage), Sales (`/sales`: Find + History, one-click outcomes, Move to Interested; replaced the Leads and Lead Finder tabs; migrations 017, 018), Contacts (grouping/merge), Transactions (Admin), Team (roster + directory), Dashboard, Stripe Piece 1 (Deposit/Build invoices), Cal.com stages 1 and 2.
- **Phase 1 Time clock: built; migration 014 applied to live 2026-10-30** (via MCP `apply_migration`, in migration history). Awaiting Luke's localhost click-through.
- Next: Phase 2 Payouts + Earn-up (needs the `project_hourly` rate from Luke; commission = cash collected, see roadmap below), Phase 3 Onboarding (needs `docs/onboarding/tait.md` + `elias.md`), Phase 4 Integrations (Social card, Lead Finder import contract).
- **Migration drift: resolved 2026-10-30.** `013b_baseline_live_policies.sql` (applied, in history) recreates the live CRM functions, triggers, policies and the `clients_owner_gin` index; proven a no-op on live. A fresh replay of schema.sql + 002..014 now matches live for the CRM tables and runs without FL-social-dash (013's `social_*` revokes are guarded by `to_regprocedure`). Apply future migrations with MCP `apply_migration` so they land in history. `set_updated_at()` is shared with FL-social-dash triggers. 016 (applied) normalized every role check and swept grants (see Roles).
- Open item: Default privileges in public still grant new objects to anon/public. Shared schema with FL-social-dash, decide with Tait before changing.
- Open items: Cal.com webhook secret + real test booking; Stripe env vars + end-to-end test; Salesperson RLS verification pass.

## Recent changes (last 10)

1. 020 (applied): `update_business_contact()` so any team member can edit a business's contact (name, title, email, phone) regardless of assignment; "Business owner" vs "Assigned to" wording; zero-row updates explain a deleted record instead of blaming RLS.
2. 019 (applied): leads `own recent delete` policy so Sales Undo removes a record its own click created (creator, under 10 minutes, no touches, no project).
3. Sales fixes: outcomes save on first click with an Add note / Undo toast; six outcomes (No answer, Emailed, Visited, Interested, Not interested, Booked call); outcome buttons only in the side preview + bulk bar; Website score (quick + background PageSpeed full, cached 30 days) replaces Matteo's score (exports keep it as Need Score); owner name from the About page with a stricter parser, editable in Sales and on the audit; Contact page / website fallback for email; "Runs on:" field-service badges + AI plug-in pitch; Book a call with Luke (Cal.com popup, auto-logs Booked call); FL Clock manifest scope `/clock`.
4. Sales tab (`/sales`) replaces Leads + Lead Finder (UI and queries only, no migration): Find (launch pad + Mission Control) and History views; one-click outcomes on every result (no Add step: logging saves the business via `upsert_lead(s)`); latest outcome inline, Not interested / Bad fit hidden by default; Results from + Re-run for fresh data after 7 days; `/leads` and `/lead-finder` redirect. Leads page, drawer, manual add and CSV import removed.
5. Leads page (Step 3): list, drawer, one-click touches, claim, bulk (incl. Log touch), alum/ServiceTitan/stale filters, manual add, CSV import with legacy preset. Move to Interested (Step 4): lead -> Interested project, Lead history + Send booking link on the project page. 018: lead upsert/matching moved into the database, `leads.source` fixed to 12 values. Lead Finder ecom tag only for businesses already selling online.
6. 016: is_admin()/is_admin_or_manager()/transactions policy use the is_team_member() identity rule (confirmed email, case-insensitive); trigger functions lose execute grants; truncate/references/trigger revoked on CRM tables; getCurrentTeamMember() uses current_team_member_id().
7. Clock-out accomplishment note (015, applied; also made `time_entries_net` select-only for authenticated); Timesheets date range presets + ?from=&to=, day grouping, grand total. 013b baseline applied (drift closed), 013 made runnable without FL-social-dash, 014 applied. Phase 1 fixes: weeks/today bucketed in America/Chicago; service worker caches only icons + manifest. Phase 1 Time clock: `time_entries` / `time_adjustments` / `time_entry_edits` + `time_entries_net` view (migration 014), nav clock, `/clock`, FL Clock PWA, Team > Timesheets. Login now returns to `?next=`.
8. 013: revoke anon execute on SECURITY DEFINER functions; pin search_path.
9. Cal.com stage 2: webhook, call history, unmatched calls (012).
10. Cal.com stage 1: booking links, Book a call, read-only Team directory.

## Stack & infra

- Next.js 14 (App Router, TypeScript, Tailwind)
- Supabase project `okvjdpqnqyrzpbaneivu` — **intentionally shared** with FL-social-dash, separated by table prefix (FL-social-dash owns the `social_*` tables; never touch those from this repo). This supersedes the original spec's "dedicated Supabase project" requirement.
- Vercel project `fl-crm` (a duplicate empty project named `fully-launched-crm` exists and should stay deleted/unused)
- GitHub: `Fully-Launched/fully-launched-crm`, local path `~/Desktop/Files/Dev/FL/fully-launched-crm`, alias `launch`
- Keep-alive cron: `app/api/keep-alive/route.ts` + `vercel.json`, pings Supabase every 3 days to prevent free-tier auto-pause. Don't duplicate this. **Until 2026-09-23 it never actually ran** — the auth middleware redirected the cron's session-less request to `/login`. Fixed by excluding it in the `middleware.ts` matcher.
- Server-to-server routes (crons, third-party webhooks) must skip the auth middleware: `/api/keep-alive` and everything under `/api/webhooks/` are excluded in the `middleware.ts` matcher. So are `/manifest.json` and `/sw.js` (browsers fetch the manifest without cookies; a login redirect breaks install). Put new webhooks under `/api/webhooks/<provider>` and have each handler verify its caller itself (e.g. the provider's signature) — nothing upstream authenticates them.

## Auth & nav

- Email/password only, no signup page
- Accounts are created manually in Supabase dashboard → Authentication → **Add User** (not "Invite User" — Invite User triggers an email flow that caused problems last time). Luke sets each person's initial password directly and sends it himself.
- Unauthenticated `/api/*` fetches (no `text/html` in Accept) get a **401 JSON**, not the login redirect (a fetch would follow it to HTML). Lead Finder client calls go through `apiFetch` (`lib/lead-finder/apiFetch.ts`): on 401 it refreshes the session in the browser and retries once; only a failed refresh shows the "sign-in expired" banner, keeping page state.
- Unauthenticated → redirect to `/login?next=<path>`; after sign-in → back to `next` (same-site paths only, `safeNext` in `app/login/actions.ts`), else `/dashboard`
- Nav (`components/TopNav.tsx`), two levels. Top: Dashboard / Sales / Projects / Transactions / Contacts / Team (Sales at `/sales`, everyone). "Projects" goes to `/projects/all` and is highlighted on any `/projects/*` page and on `/project/[id]`; on `/projects/*` a lighter second row shows All / Media / Websites / Ecomm / AI Integration (nav-only labels — routes, branch values, and page headings are unchanged, e.g. `/projects/ai` still says "AI"). Transactions is Admin-only (hidden from nav, page redirects non-Admins; RLS is the real gate). Team is visible to everyone: Admins get the roster manager, everyone else a read-only directory with booking links. Below `sm` the nav collapses to a hamburger dropdown with the Projects sub-tabs nested under an expandable Projects entry. The nav clock sits at the right of the top row (next to the hamburger on mobile); see Time clock. Team has in-page tabs People / Timesheets (`components/team/TeamTabs.tsx`), not a nav second row.

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

Original columns only; migration 017 added the rest (company/contact, scan data, status, owner, audit, ...), see the Sales and Leads data sections. Everyone reads; updates are owner, unassigned, or Admin/Manager (RLS).

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

### Identity rule (migration 016)

Every role check uses one rule: the signed-in auth user (`auth.uid()`), with a **confirmed** email, whose email matches a `team_members.email` **case-insensitively**. `is_team_member()`, `is_admin()`, `is_admin_or_manager()`, `current_team_member_id()` and the app's `getCurrentTeamMember()` (`lib/auth.ts`, via `current_team_member_id()`) all apply it, so a roster email stored with different capitalization still works. Grants (016): functions the app or a policy calls are executable by `authenticated` only; trigger functions have no execute grants (triggers don't need them); `time_entries_net` is select-only; CRM tables have no truncate/references/trigger for anon/authenticated (select/insert/update/delete left to RLS).

### Transactions RLS

Unlike most tables, `transactions` select/insert/update/delete is restricted by the `admin only access` policy to `public.is_admin()` (identity rule above, role Admin). Direct API access is blocked for non-Admins even if the frontend check is bypassed. Frontend also hides the tab and `/transactions` redirects non-Admins to `/dashboard` server-side (belt-and-suspenders, not the real gate).

### Project delete (migrations 006, 007)

Deleting a project is limited to **Admin or Manager**, enforced by the `admin or manager delete` RLS policy on `projects` (`using (public.is_admin_or_manager())`, migration 007 — replaced 006's Admin-only `admin delete`). Select/insert/update on `projects` stay open to all authenticated users. Salespeople can't delete.

- The only Delete button is on the Manage Project page (`/project/[id]`); the Table view's per-row Delete was removed. Salespeople don't see the button (UI only — RLS is the real gate).
- What deleting a project does: `project_tasks` **cascade** (deleted with it); `transactions` and `contacts` survive with `project_id` set to null.
- An RLS-blocked delete returns no error, just zero rows — delete calls must use `.select()` and check the returned rows.
- On success the page redirects to the `?from=`/`?tab=` origin (`projectOrigin` in `lib/projects.ts`).

## Manage Project page

`/project/[id]` — Build and Subscription sections, project tasks, Delete (Admin/Manager). Live.

**Duplicate project** (any authenticated user): inserts `duplicateProjectPayload()` (`lib/projects.ts`) — same stage, "(Copy)" appended to `client_name`, no id/timestamps/`scheduled_call`/Stripe fields. Tasks and transactions aren't copied. On success it opens the copy's detail page, carrying over `?from=`/`?tab=` so the back link still returns to the original view.

## Sales (`/sales`)

Replaced the Leads and Lead Finder tabs (Nov 5). `app/(app)/sales/page.tsx` renders `components/lead-finder/LeadFinder.tsx` (the Sales shell, Matteo's dark UI under `.lf-root`); Sales parts in `components/sales/` and `lib/sales/`. No schema of its own: a business is a `leads` row, an outcome is a `lead_touches` row. **No "lead" wording anywhere in the Sales UI** (business, outcome, match, prospect). **Two different "owners", never mixed up:** the person at the business (`contact_name` / `title` / `email` / `phone`) is labelled **"Business owner"** (or **"Contact"** when the title isn't owner-like, `contactLabel()`); the CRM user working it (`leads.owner`) is **"Assigned to"**. Same in the audit page, History and exports (Business Owner / Contact, Contact Title, Assigned To).

- **Top bar toggle:** **Find** (launch pad + Mission Control, `?run=<id>`) and **History** (`?view=history`, `?lead=<id>` opens one business; History updates the URL with `history.replaceState`, no server round trip). `/leads` and `/lead-finder` redirect to `/sales` in `next.config.mjs` with the query kept (`?lead=` opens History, `?run=` a search). `/lead-finder/audit` is a different path and stays.
- **Which businesses:** `SALES_SOURCES` in `lib/sales/outcomes.ts` (now `["lead_finder"]`; add `apify`, `etsy`, ... there). Search matches (`runResults` in `lib/lead-finder/runner.ts`) and History only attach/show leads whose `source` is in it. Legacy outreach (personal_network, etsy, manual, csv_import, ...) never shows in Sales and stays untouched in the table. Edge: a search result that matches only a legacy row shows as new; logging an outcome on it (`upsert_lead` skip returns the legacy id) puts the touch on that legacy row, which History then doesn't list.
- **Outcomes** (`OUTCOMES`, `lib/sales/outcomes.ts`), six, in order, each a `lead_touches` row as the current user: No answer = cold_call/outbound/no_answer, Emailed = email/outbound/sent, Visited = in_person/outbound/sent, Interested = inbound/interested on the last-used channel (default cold_call), Not interested = inbound/not_interested (same channel rule), Booked call = cold_call/outbound/meeting_booked (trigger sets status interested). Interested and Booked call open Move to Interested when the user may edit; Booked call passes `callBooked` so the dialog says no booking link is needed. `classifyTouch()` maps any touch back to a label (`DisplayKey`), so older touches (Called (talked) = cold_call with no outcome, Bad fit, voicemail, replied) still read correctly. The touch trigger (017) still sets `last_touch_at` and `leads.status`. Change channel/outcome mapping and `classifyTouch` together.
- **No Add step, save on first click:** outcome buttons live only in the side preview and the bulk bar (`components/sales/OutcomeChips.tsx`); rows have none. A click saves at once and shows the toast (`components/sales/OutcomeToast.tsx`, provider in the Sales shell): "<Outcome> saved for X" with **Add note** (optional, updates the touch's `summary`) and **Undo** (10 seconds: deletes the touches, resets the record's status and `last_touch_at`; a record that click created is deleted too, allowed by the 019 policy `own recent delete`: found_by = me, created in the last 10 minutes, no touches left, no project; Admins keep `admin delete`. If the delete is refused, e.g. a teammate touched it meanwhile, the record stays as No outcome yet). `logOutcome()` / `undoOutcome()` / `noteOutcome()` in `lib/sales/log.ts` (browser, RLS applies): businesses with no record are saved first by `ensureRecords()` with `upsert_leads` mode skip (`leadFromScan`: source `lead_finder`, owner = found_by = me, source_detail = run label). Before Nov 5 (evening) a click only opened a note box and nothing was written until Save; production showed one save in total.
- **Shared history in results:** a business with a Sales record shows its latest outcome under the name ("Not interested · Talon · Nov 5" + note). Not interested (and older Bad fit) are hidden by default; "Show already contacted (N)" (N = hidden count) shows them. Other outcomes stay visible, marked (badge, faint row tint). Moved to Interested shows as its own badge. Tabs: All, No real website, Hot (60+), Has contact, Not contacted (no outcome yet).
- **Results rows:** checkbox, Priority, Website score (quick/full), business (name, category, city, "Runs on: <software>" and "Sells on:" badges, latest outcome), rating, gaps. Click opens the side preview. Sort options: priority, weakest website, rating, reviews, name. Tooltips: Priority "Who to call first: established businesses with 1-2 clear gaps rank highest", Website score "Speed, SEO and AI-search readiness" (`PRIORITY_TIP` / `WEBSITE_SCORE_TIP`).
- **Side preview** (`components/sales/BusinessDetail.tsx`, same in Find and History): header Priority + Website score (quick, or full once PageSpeed is in; "checking" while it runs), Call / Google Maps / Visit site / Preview site / Run audit (with the record id so it saves), outcome buttons, latest outcome + assigned member, next action + date (owner, unowned, or Admin/Manager; RLS, zero rows = message), Move to Interested (auto-offered after logging Interested when the user may edit) or Open project, full touch timeline, contact (Owner: name or "unknown", **editable**: `saveOwnerName()` creates the record if needed and writes `contact_name` + `title = 'Owner'`; emails, else "Contact page" from the scan's `contactPage`, else the website), what they need, signals, review complaints, and the **Book a call with Luke** footer (below).
- **Business contact** (`lib/sales/owner.ts`): `ownerNameOf` shows a typed name (title set and not the scanner's "Possible owner") as is, a scan guess only if `plausibleOwnerName()` passes (older guesses read "unknown"); `contactEmail` / `contactPhone` prefer the record over the scan. **Any team member edits it, whoever the business is assigned to** (side preview "Edit contact": name, title, email, phone; audit page: Business owner name), through `saveBusinessContact()` -> `update_business_contact(p_lead_id, p_fields)` (migration 020: SECURITY DEFINER, `search_path = public`, `is_team_member()`, only those four columns, any other key rejected, `P0002` when the record is gone; anon has no execute). It saves the business first if it has no record, and if the record was deleted while the page was open it saves it again and retries once. Assignment, status, notes, next action and the rest keep the 017 RLS rules (assigned member, unassigned, or Admin/Manager). The call script uses the edited name.
- **A leads update with zero rows** isn't always RLS: `zeroRowsReason()` checks whether the record still exists and says "no longer exists (deleted), reload" vs "only the team member it's assigned to (or an Admin/Manager)". Admin/Manager pass every RLS check. (Nov 5: an Admin's audit-page edit was reported as refused; it was an update to a record deleted while the tab was open.)
- **Book a call with Luke** (`components/sales/BookCall.tsx`): Cal.com's official embed, element-click popup (`data-cal-link` / `data-cal-namespace="sales"` / `data-cal-config` with name + email prefilled from the owner name and first email; loader snippet from their docs, `embed.js` from `app.cal.com` for cal.com links). Whose calendar: the member whose email is `SALES_CALL_EMAIL` (luke@fullylaunched.com, matched on email like the pinned colors), link from `team_members.booking_link`, fallback `https://cal.com/luke-bothun`. **Copy link** copies the plain link ("Copied" toast). A finished booking (`bookingSuccessfulV2` / `bookingSuccessful`, deduped) logs Booked call on the open business and opens Move to Interested. History rebuilds the scan view from `leads.scan_tags` (`lib/sales/fromLead.ts`).
- **History** (`components/sales/SalesHistory.tsx`): columns business, latest outcome (outcome, who, when, note), branch tags, priority, website score, next action (overdue red). Filters: outcome (the six, Moved to Interested, No outcome yet, and older Called (talked) / Bad fit), person (all / Mine / member) and date range (local days), both by the latest outcome (who logged it, when; else who found it and when it was saved), branch, search (name, address, phone, city). Newest first, Refresh, Export CSV. Loads all Sales leads + their touches client-side (`lead_touches` with `leads!inner(source)`).
- **Mission Control header:** "Results from <date, time> · <search>" next to New search; results older than 7 days add **Re-run for fresh data** (same params; a quick search launches straight away, a sweep fills the form and opens its cost confirm; hidden for sweeps when the user can't sweep).
- **Exports:** Mission Control CSV: Priority, Website Score, Need Score (Matteo's score, shown nowhere else), Owner, Runs On, Latest Outcome / Outcome By / Outcome Date / Outcome Note; file `fullylaunched-sales-...csv`. History CSV adds Owner, Website Score, Need Score.

### Website score (`lib/lead-finder/websiteScore.ts`)

Replaces Matteo's score in the Sales UI. Change the code and these lines together.
- **Quick** (0 to 100, every result, from the scan): no website / social page only / broken = 0. Otherwise: site loads 20 (very slow or blocked from checking: 10) + https 10 + mobile viewport 10 + page title 8 + meta description 8 + H1 6 + LocalBusiness/Organization (or subtype) schema 10 + FAQPage schema 8 + Google profile: hours 7, photos 7 (5+) or 4 (1 to 4), reviews 6 (25+) or 3 (10+). Inputs: `ScannedPlace.site` (`siteChecks()` in the scanner, JSON-LD and microdata types) and `photos` (Places `places.photos`, added to the field mask; up to 10). Results scanned before Nov 5 have no `site`: https/mobile come from the tags, the SEO checks count 0 until re-run.
- **Full:** round(quick / 2 + average(PageSpeed performance, SEO, accessibility, best practices) / 2). Opening a business in the side preview runs PageSpeed in the background (`POST /api/lead-finder/website-score { placeId, website }`), and the audit's PageSpeed call passes `placeId` so it counts too. Cached 30 days per website (`lib/lead-finder/webScoreCache.ts`): stored as `webScore {url, at, speed}` in every `lead_finder_results.payload` for that place and in the record's `leads.scan_tags` (written as the user, so RLS can skip a write; then the next viewer may run it again). Shown as "quick" or "full".
- **Field-service software** ("Runs on:" badges, `fieldSoftware()`): ServiceTitan (incl. ScheduleEngine / FieldRoutes), Housecall Pro, Jobber, Service Fusion, FieldEdge, Workiz, Successware, BuildOps, ServiceTrade, Kickserv, GorillaDesk, Service Autopilot, JobNimbus, AccuLynx (`TECH_PATTERNS` in the scanner). The AI pitch (`lib/lead-finder/callScript.ts`) for ServiceTitan, Housecall Pro or Jobber says we build AI tools that plug into that software (follow-ups, quotes/invoices, call answering and booking, reporting).
- Removed with the Leads tab (in git history before Nov 5): the list (claim, assign, set status, alum/ServiceTitan/stale filters), the drawer with custom touches, manual Add lead, CSV import (`lib/leads/csv.ts`, legacy + generic presets), `POST /api/lead-finder/runs/[id]/add`. New outside sources should call the `upsert_leads` RPC with a `SALES_SOURCES` source.

## Leads data (migrations 017, 018)

- **Upsert in the database (018):** `upsert_lead(p jsonb)` -> `{lead_id, action: inserted|merged|skipped, matched_on, reason}`, `upsert_leads(p jsonb)` (array, max 500 per call) -> counts + per-row results, `find_lead_match(es)` (read-only). `p = {"mode": "skip"|"merge", "lead"|"leads": ...}`. SECURITY INVOKER, `search_path = public`, so RLS applies; anon has no execute. Match order google_place_id, cid, email, domain, phone_digits with the chain rule. **skip** (Sales outcome saves): a match is reported, nothing written. **merge** (imports): fill empty fields only, union `branch_fit`, merge `external_ids` (existing keys win); never touches status, owner, found_by, project_id, company. Per-row errors (RLS, bad value) come back as skipped with a reason. Outside sources (Apify, GrokBot, Claude research) should call these RPCs. Normalization helpers `lead_norm_email/domain/phone` are shared by the `leads_normalize` trigger and the matcher.
- **`leads.source`** (018 check, not null, default `manual`): `lead_finder`, `apify`, `grokbot`, `claude`, `happenstance`, `gojiberry`, `heyreach`, `csv_import`, `manual`, `referral`, `personal_network`, `etsy` (labels in `lib/leads/labels.ts`, change both together). Free text goes in `source_detail`. Legacy rows were mapped in 018 (personal outreach -> personal_network, Etsy cold list -> etsy, Reddit -> manual), old text kept in `source_detail`.

### Move to Interested (Step 4)

`components/sales/ConvertDialog.tsx`, helpers in `lib/leads/convert.ts`. Offered by the Sales detail panel button and automatically after logging Interested there (not yet moved, user may edit it). Only the business's owner, an unowned one, or Admin/Manager (RLS on the lead update). Rendered through a portal to `document.body` (light CRM styles, outside `.lf-root`).

- Modal: branch (prefilled from the first `branch_fit`), project owner (default: the member whose `lead_branches` has that branch), contact name, estimated value as one-time build (`build` + `build_value`) or monthly (`subscription` + `subscription_value`), note.
- Creates the project: stage Interested, `client_name`, `contact_name`, `email`, `phone`, branch, owner, `salesperson = [lead.found_by]`, notes; `source` mapped to the projects list (`referral` -> Referral, `personal_network` -> Relationship, else from the first touch: inbound -> Inbound, cold call/voicemail -> Cold Call, email -> Email, LinkedIn -> LinkedIn, else empty). The contact is created by the `projects_sync_contact` trigger (needs a contact name) and grouped with the same person on the Contacts page.
- Then the lead gets `project_id` + status `converted`, and a touch ("Moved to Interested: <branch> project"). Client-side steps, not one transaction: if the lead update fails after the project insert, the dialog says so and links the project.
- Multi-branch leads: one project for the chosen branch; the dialog says "Multi-branch: line items coming later."
- Manage Project page: **Lead history** (`components/LeadHistory.tsx`, leads with `project_id` = this project: source, found by, saved audit summary, touch timeline; links to `/sales?lead=`) and **Send booking link** in Book a call (mailto to the project email with the first owner's prefilled Cal.com link; needs an email and an owner with a booking link).

## Lead Finder (migration 017)

Port of Matteo's AI Lead Finder (`~/Desktop/AI-Lead finder/files`) into `lib/lead-finder/` + `app/api/lead-finder/*`, shown as Sales > Find (see Sales). Scoring, tags, `SWEEP_PRESETS`, recommendations, call script and preview are Matteo's logic; structure changed, behavior not (copy edits: em-dashes only).

- **Keys** (server-only): `GOOGLE_PLACES_API_KEY` (Places API (New): Text Search, Place Details), `GOOGLE_PAGESPEED_API_KEY` (audit speed check).
- **Runs on Vercel by steps**, not Matteo's in-memory jobs: `lead_finder_runs` / `lead_finder_results`; the page calls `POST /api/lead-finder/runs/[id]/step` in a loop (maxDuration 60, ~20s of work per step, a hard 48s deadline on website fetches). A lease in `params.lease_until` plus compare-and-set on `done_searches` keep two tabs from double-running; a run with no driver for 75s shows Resume.
- **Who:** quick search = any team member; area sweep = Admin/Manager (RLS + route), always shows searches + 1 location lookup and a dollar estimate (list price, before Google's free allowance) and needs a confirm click; 150-search cap.
- **Google calls:** quick search 1 Text Search per 20 results; sweep 1 center lookup + types x tiles; audit 1 Place Details + 1 PageSpeed (only for a real site). Website scans and the preview cost nothing.
- **Dedupe:** every result is checked against leads by `google_place_id`, then `external_ids.cid` (from the Maps URL, `lib/lead-finder/cid.ts`), then email, domain, phone_digits, by the database (`find_lead_matches`, migration 018). Soft keys never join two records that both carry a different place id or cid (chains); the oldest lead wins among soft-key candidates. Only Sales-source matches are attached; they show the latest outcome (see Sales).
- **priority_score** (`lib/lead-finder/priority.ts`), shown next to Matteo's score and the default sort. Fit by branches missing: 0 gaps = 0 (priority 0), 1 = 40, 2 = 45, 3 = 25, 4 = 10. Establishment: rating >= 4.0 and 25+ reviews = 40; rating >= 3.5 and 10+ reviews = 20; else 5. Plus round(score / 10). Established + 1 or 2 gaps lands 80 to 95; missing everything or few reviews ranks lower. Change the code and this line together.
- **UI is Matteo's design** (his `index.html`, Oct 25, not `index-classic.html`): launch pad (rocket, 3-2-1 countdown, keyed launch video, orbit/touchdown cards) and mission control (stats, tabs, sticky detail panel), under the CRM top nav. `components/lead-finder/` (`LeadFinder`, `RocketStage`, `MissionControl`, `Dropdown`); assets in `public/lead-finder/` (`.mp4` excluded from the auth middleware like images), paths in `components/lead-finder/assets.ts` (`LAUNCH_VIDEO_SRC`, `ROCKET_IDLE_SRC`): to swap the launch video, replace `launch.mp4` in place, framed like `rocket-idle.png`. Launch pad layout (our change, not Matteo's): no starfield, rocket left at about 60% size, console right; stacked console first on phones. The idle image and the video canvas share one box, fit and mask. **Deliberate exception to the theme rule:** his dark palette and fonts (self-hosted woff2 in `components/lead-finder/fonts/` via `next/font/local`, `fonts.ts`; not `next/font/google`, whose Next 14 loader crashes on Google's extension-less `/l/font?kit=` URLs since Nov 4) live in `lead-finder.css`, every selector scoped under `.lf-root` and keyframes prefixed `lf-`, so nothing leaks into other pages. Keep that scoping for any change.
- **Coming back:** Find with no `?run=` reopens the user's last opened run (localStorage `lf:last_run:<member id>`, try/catch), else their most recent `lead_finder_runs` row, else the launch pad (starting in History, this waits until Find is opened). Mission control's New search goes back to the launch pad.
- **Outcome buttons** replaced Matteo's pipeline buttons and Add to Leads (see Sales). Sweeps use an inline confirm in the estimate box.
- **E-commerce tag (CRM rule, Nov 4, replaces Matteo's):** only businesses that **already sell online** on Shopify, Etsy, Faire, Amazon or eBay get `ecom`. Evidence (`MARKETPLACE_LINKS` in `lib/lead-finder/scanner.ts`): Shopify tech/store or a `*.myshopify.com` listing URL, links to `etsy.com/shop/`, `faire.com/...`, an Amazon storefront (`/stores/`, `/shops/`, `s?me=`, `sp?seller=`), `ebay.com/str/` or `/usr/`, on the homepage, the contact page, or the Google listing's own URL. **Never** for service businesses (`SERVICE_TYPES` / `SERVICE_WORDS`: HVAC, plumbing, electrical, roofing, contractors, law, dental, medical, accounting, insurance, auto repair, cleaning, landscaping, pest control, property management, salons/barbers), judged from Google's types, the search type and Google's category (not the business name). Tags: "Already sells online (X), not on Y yet", plus Matteo's Shopify listing-quality check and "Large catalog" (Shopify only). His "Sells products but has no online store" and "Has a website but no online store / ordering" are gone. `ScannedPlace.marketplaces` records what was found (badges in Mission Control, the detail panel, the audit, CSV). Score and priority come from the tags as before, so they follow the new rule. Results scanned before Nov 4 keep their old tags until re-run.
- **Run audit** (detail panel, new tab): `/lead-finder/audit?place=&type=&lead=` (`app/lead-finder/audit/page.tsx`, outside the `(app)` layout like `/clock` so it prints without the nav; `AuditReport.tsx`, styles in `audit.css` scoped under `.lfa`). Matteo's audit.html: call script (screen only, `buildCallScript`/`pitchesFor`), PageSpeed scores, snapshot, findings, recommendations. Calls `/api/lead-finder/audit` (1 Place Details) then `/api/lead-finder/pagespeed` (real sites only). With `lead=` the finished audit is saved to `leads.audit` / `audit_at` (`SavedAudit`, version 1, PageSpeed screenshot dropped; RLS decides, a blocked save shows a message), and a business with a saved audit reopens it without a Google call until "Run again". Preview site stays its own button.
- **Owner name** (`lib/lead-finder/ownerName.ts`, shared): the scanner reads the homepage, then the first About-style link (about, about-us, our-story, our-team, team, meet-the-team, who-we-are, our-company; same timeouts) when the homepage has no name, then the Contact page. A name is two capitalized parts (optional middle initial), neither a common English/business word, in the same sentence and within ~40 characters of owner / co-owner / founder / co-founder / president / proprietor / CEO / owner-operator / owned and operated by / founded by, or after "My name is" / "I'm" with an ownership word within 400 characters. Not confident = null ("Owner: unknown"). Test case: Dutchman Heating and Cooling -> Mike Bakker (About page); the old case-insensitive parser had returned "throughout the".
- **Saving** a result (first outcome logged): `found_by` = `owner` = current user, `source` `lead_finder`, `source_detail` = the run label, tags to `branch_fit` (website = Websites, social = Media, ecom = Ecommerce, ai = AI). One shared upsert: the database functions `upsert_lead` / `upsert_leads` (migration 018), called through `lib/leads/upsert.ts` (a thin RPC wrapper; matching logic lives only in the database).

## Overdue logic

If Target Date is in the past and Stage is **not** Complete, Subscriber, or Lost → red text + light red background. Same treatment for `project_tasks.due_date` when status ≠ Done.

## Rules

- UI copy: no em-dashes anywhere (use a period, comma, colon, or "to").
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

## Time clock (Phase 1, migration 014)

- **Tables:** `time_entries` (one per clock-in; `entry_type` enum project / management / sales / internal; nullable `project_id`; `approved_by`/`approved_at`), `time_adjustments` (minutes, negative = deduction, reason default `distracted`), `time_entry_edits` (audit of Admin clock time changes: field, old, new, reason, editor, time). View `time_entries_net` (`security_invoker`): `duration_minutes`, `adjustment_minutes`, `deduction_count`, `net_minutes = greatest(0, duration + adjustments)`; open entries count to `now()`.
- `current_team_member_id()` (security definer) returns the caller's `team_members.id`, matched like `is_team_member()`.
- **Rules (all enforced in the DB, UI just mirrors):** one open entry per user (partial unique index). `clock_in` is always server time on insert. Owners can only update their own open entry; closing it forces `clock_out = now()`. Any other `clock_in`/`clock_out` change is Admin-only, needs a reason, and goes through `admin_edit_time_entry(id, in, out, reason)`; the update trigger writes `time_entry_edits`. Approval: Admin only, closed management entries only; trigger stamps approver + time. Management time counts toward pay only once approved; other types always count.
- **"I got distracted (-10)":** inserts a -10 adjustment on the open entry. Non-Admins: deductions only, own open entry only, never below 0 net (trigger, row-locked). Undo toast for 10s; the server allows the creator to delete within 60s (RLS), and a blocked delete returns zero rows.
- **Accomplishment note (migration 015):** `time_entries.accomplished`, required once closed: `time_entries_accomplished_check` = `clock_out is null or char_length(btrim(accomplished)) >= 5`, so every close path (owner, Admin edit, API) needs it and it can't be blanked later. Every Clock out button opens "What did you accomplish?" (`components/clock/ClockOutDialog.tsx` → `AccomplishedDialog.tsx`; Cmd/Ctrl+Enter submits, Cancel stays clocked in; one dialog per clock state, rendered in `TopNav` and `ClockPanel`). Owners can edit their own note afterwards ("own update" policy; the update trigger limits non-Admins on a closed entry to `accomplished` only). Admin edits it in the Edit dialog; `admin_edit_time_entry` takes a 5th arg `p_accomplished` so closing a forgotten entry and writing its note is one statement. A note-only Admin change is a plain update (no reason).
- Open > 12h → "Forgot to clock out?" (red) in the nav, `/clock`, and Timesheets. Never auto-closes; the person clocks out and an Admin fixes the time.
- `time_entries.user_id` is `ON DELETE RESTRICT`: a team member with time entries can't be deleted (pay records).
- **RLS:** every team member reads all entries, adjustments and edits (MOU: time reviewable by the team).
- **Pay timezone:** all pay-period math (Timesheets weeks, the clock's "Today" total and deduction count, and Phase 2 payout periods) buckets by **America/Chicago** (`PAY_TIMEZONE`, `lib/timeclock.ts`) for every viewer: weeks are Monday 00:00 to Sunday 23:59:59 Central, an entry belongs to the week/day of its `clock_in`. Times are *displayed* in the viewer's local timezone. Use the `PayDate` helpers (`payDateOf`, `payWeekMonday`, `payWeekRange`, `payMidnight`), never `Date#setHours`/`getDay`, for any bucketing.
- **UI:** nav clock (`components/clock/NavClock.tsx`; one `useTimeClock` state in `TopNav`, shared by the desktop and mobile instances). `/clock` (`app/clock/page.tsx`, outside the `(app)` layout, no nav, fits ~320x420). Team > Timesheets (`/team/timesheets`, `components/team/Timesheets.tsx`): range presets This week / Last week / This month / Last month / Custom (date pickers), in the URL as `?from=YYYY-MM-DD&to=YYYY-MM-DD` (whole America/Chicago days, inclusive; invalid or missing → this week; `parsePayRange`, `presetRange` in `lib/timeclock.ts`), Prev/Next arrows whenever the range is a whole Mon to Sun week, entries grouped by Central day with day subtotals, an "All" grand total row, accomplishment note under each entry (2 lines, click to expand), per-person totals by type, deductions, pending management time, "Clocked in now" list (open entries from any week), Admin Approve + Edit (reason required). Entries count in the week of their `clock_in`.
- Active projects for the picker = stage not Complete or Lost.

### FL Clock PWA

- `public/manifest.json` (name "FL Clock", `start_url` and **`scope` `/clock`** (was `/`, which made Chrome open every CRM link, e.g. Run audit, inside the installed app), standalone, navy theme / tan background), icons in `public/icons/` (`*-v2.png`: rocket mark tightly cropped from `fully-launched-site/assets/logo-white.png` on full-bleed navy with a tan bar; rocket + bar 85% of canvas height, 72% in the maskable versions (whole mark inside the 40%-radius safe zone); 192/512/1024 `any`, 192/512 `maskable`, 180 apple-touch; rename again on any change so browsers don't serve cached copies), `public/sw.js` registered by `components/pwa/ServiceWorkerRegister.tsx`.
- The service worker caches only `/icons/*` and `/manifest.json` (network first, cache as offline fallback, never a redirected response). Every other request (pages, `/_next/*`, `/api/*`, Supabase, cross-origin) is network only: the fetch handler returns without `respondWith`. Caching is off on localhost. Bump `CACHE` in `sw.js` if its caching logic changes (v2 dropped v1's `/_next/static` caching; v3 for the renamed -v2 icons).
- Navy/tan hex are repeated in `manifest.json` (static JSON) and `BRAND_NAVY_HEX` (`lib/theme.ts`, for the theme-color meta); `--color-tan` is the CSS token.
- **Install:** Chrome: open `crm.fullylaunched.com/clock` → **Install app** (the install icon at the right of the address bar, or ⋮ → Cast, save, and share → Install FL Clock). Safari (macOS Sonoma+): open the page → **File > Add to Dock**. Sign in once in the app window; after that it opens straight to the clock.

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

## Roadmap: Phase 2 decisions (not built yet)

- Rates in `payout_rates` (Admin-editable, nothing hardcoded): seed management_hourly = 50, sales_commission_pct = 10; project_hourly still needs a number from Luke.
- Commission is earned on cash collected: only paid transactions count, credited to the payout period containing the paid date. A later refund creates a negative commission line in the next open period; closed periods are never edited.
- Closed payout periods are immutable. Corrections go in as adjustment lines in an open period, with a required note.
- **Once a payout period is closed, every time entry in it is fully locked, including the accomplishment note for non-Admins** (today the owner can still edit their note on any closed entry; Phase 2 must add the period check to the `time_entries` update trigger).
- All period math uses America/Chicago (`PAY_TIMEZONE`).
- Lead Finder: ported, now Sales > Find (see Sales); outside sources import through the `upsert_leads` RPC.

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
