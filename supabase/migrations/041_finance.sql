-- Fully Launched CRM, migration 041: Team > Finance tab.
--
-- 1. projects: win_probability (0-100, overrides the stage default in the
--    weighted pipeline), expected_sub_months (overrides the default
--    subscription length), related_party (excluded from LTV and CAC, shown
--    as a badge; false for every project, Grad Gig included).
-- 2. expenses: monthly overhead. Admin writes; Admin/Manager read.
-- 3. Seed expenses.
-- 4. deal_settings: assumed_labor_pct, payment_fee_pct, default_sub_months,
--    stage_probability (commission_pct already exists). The tool builder fee
--    is not part of Finance (its column and tool_builder_pct were dropped in
--    039), so tool_builder_pct is not re-added.
-- 5. transactions: Managers can read (the Finance tab is Admin/Manager).
--    Writes stay Admin-only through the existing "admin only access" policy.
--
-- Apply with Supabase MCP apply_migration.

-- 1. projects ----------------------------------------------------------------
alter table public.projects
  add column if not exists win_probability numeric
    check (win_probability is null or (win_probability >= 0 and win_probability <= 100)),
  add column if not exists expected_sub_months int
    check (expected_sub_months is null or expected_sub_months >= 0),
  add column if not exists related_party boolean not null default false;

-- 2. expenses ----------------------------------------------------------------
create table if not exists public.expenses (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  monthly_amount numeric not null check (monthly_amount >= 0),
  owner          uuid references public.team_members(id) on delete set null,
  category       text not null default 'tools' check (category in ('tools', 'sales', 'other')),
  active         boolean not null default true,
  start_date     date default current_date,
  notes          text,
  created_at     timestamptz not null default now()
);

alter table public.expenses enable row level security;

drop policy if exists "admin all" on public.expenses;
create policy "admin all" on public.expenses for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin or manager read" on public.expenses;
create policy "admin or manager read" on public.expenses for select to authenticated
  using (public.is_admin_or_manager());

revoke all on public.expenses from anon, public;
revoke truncate, references, trigger on public.expenses from authenticated;
grant select, insert, update, delete on public.expenses to authenticated;

-- 3. seed (only into an empty table, so a re-run doesn't duplicate) ----------
insert into public.expenses (name, monthly_amount, category, notes)
select v.name, v.monthly_amount, v.category, v.notes
  from (values
    ('Claude',             500, 'tools', null),
    ('Google Workspace',    49, 'tools', null),
    ('LinkedIn',            60, 'sales', 'Goes to 120 after 2 months'),
    ('Higgsfield',          19, 'tools', null),
    ('Vercel',              20, 'tools', null),
    ('Supabase',            20, 'tools', null),
    ('Grokbot',             30, 'sales', null),
    ('Apify',               10, 'sales', null)
  ) as v(name, monthly_amount, category, notes)
 where not exists (select 1 from public.expenses);

-- 4. deal_settings -------------------------------------------------------------
alter table public.deal_settings
  add column if not exists assumed_labor_pct numeric not null default 32.5
    check (assumed_labor_pct between 0 and 100),
  add column if not exists payment_fee_pct numeric not null default 2.5
    check (payment_fee_pct between 0 and 100),
  add column if not exists default_sub_months int not null default 12
    check (default_sub_months >= 0),
  add column if not exists stage_probability jsonb not null
    default '{"Interested":20,"Negotiation":60,"Signed":90}'::jsonb;

-- 5. transactions: Admin/Manager read ---------------------------------------
drop policy if exists "admin or manager read" on public.transactions;
create policy "admin or manager read" on public.transactions for select to authenticated
  using (public.is_admin_or_manager());
