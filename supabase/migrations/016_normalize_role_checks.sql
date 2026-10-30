-- Fully Launched CRM — migration 016
-- One identity rule for every role check, and a grant sweep.
--
-- Identity rule (same as is_team_member() and current_team_member_id()
-- already used): the signed-in auth user (auth.uid()), with a CONFIRMED
-- email, whose email matches a team_members row case-insensitively.
--   Before: is_admin() and is_admin_or_manager() compared
--   auth.jwt() ->> 'email' to team_members.email exactly (case-sensitive)
--   and didn't require a confirmed email; the transactions policy inlined the
--   same exact-case check. A roster email stored as "Luke@FullyLaunched.com"
--   locked its owner out of every Admin/Manager power while is_team_member()
--   still let them in.
--   After: is_admin() and is_admin_or_manager() use the is_team_member()
--   match plus a role check, and the transactions policy calls is_admin().
--
-- Grant sweep (non-social_* objects in public; the anon/authenticated/PUBLIC
-- grants Supabase's default privileges hand out):
--   Functions called by the app (supabase.rpc) or by a policy: execute for
--     authenticated only (revoked from PUBLIC and anon).
--   Trigger functions: no execute for PUBLIC, anon or authenticated. Postgres
--     doesn't check EXECUTE when a trigger fires, so the triggers keep
--     working. set_updated_at() is shared with FL-social-dash's social_*
--     triggers; neither app calls it directly, so this is safe for both.
--   Views: select only for authenticated (already true for time_entries_net).
--   Tables: TRUNCATE, REFERENCES and TRIGGER revoked from anon and
--     authenticated (TRUNCATE bypasses RLS). Select/insert/update/delete
--     unchanged: RLS governs them, and every CRM table has RLS enabled.
--   service_role and postgres grants are left alone.
-- Not changed: Supabase's default privileges for future objects. New
--   functions/tables in public will still get PUBLIC/anon grants; the schema
--   is shared with FL-social-dash, so that's a joint decision.
--
-- Applied with Supabase MCP apply_migration.

begin;

-- ---------------------------------------------------------------------------
-- Role checks

-- Unchanged body; restated so all three read the same way.
create or replace function public.is_team_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from auth.users u
    join public.team_members tm on lower(tm.email) = lower(u.email)
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from auth.users u
    join public.team_members tm on lower(tm.email) = lower(u.email)
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and tm.role = 'Admin'
  );
$$;

create or replace function public.is_admin_or_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from auth.users u
    join public.team_members tm on lower(tm.email) = lower(u.email)
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and tm.role in ('Admin', 'Manager')
  );
$$;

drop policy if exists "admin only access" on public.transactions;
create policy "admin only access" on public.transactions
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Function grants: app / policy callable -> authenticated only

revoke all on function public.is_team_member() from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_admin_or_manager() from public, anon;
revoke all on function public.current_team_member_id() from public, anon;
revoke all on function public.merge_contacts(uuid, uuid[]) from public, anon;
revoke all on function public.assign_call_to_project(uuid, uuid) from public, anon;
revoke all on function public.admin_edit_time_entry(uuid, timestamptz, timestamptz, text, text) from public, anon;

grant execute on function public.is_team_member() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_admin_or_manager() to authenticated;
grant execute on function public.current_team_member_id() to authenticated;
grant execute on function public.merge_contacts(uuid, uuid[]) to authenticated;
grant execute on function public.assign_call_to_project(uuid, uuid) to authenticated;
grant execute on function public.admin_edit_time_entry(uuid, timestamptz, timestamptz, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Function grants: trigger functions -> nobody (triggers don't need EXECUTE)

-- set_updated_at: shared with FL-social-dash social_* triggers. Do not change without checking that repo.
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.sync_contact_from_project() from public, anon, authenticated;
revoke all on function public.ensure_an_admin_remains() from public, anon, authenticated;
revoke all on function public.time_entries_before_insert() from public, anon, authenticated;
revoke all on function public.time_entries_before_update() from public, anon, authenticated;
revoke all on function public.time_adjustments_before_insert() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Views: select only

revoke all on public.time_entries_net from public, anon, authenticated;
grant select on public.time_entries_net to authenticated;

-- ---------------------------------------------------------------------------
-- Tables: drop TRUNCATE, REFERENCES and TRIGGER from anon and authenticated
-- on every non-social_* table (12 as of this migration). TRUNCATE in
-- particular ignores RLS. Select/insert/update/delete are untouched; RLS
-- governs those. (MAINTAIN, new in Postgres 17, is also default-granted and
-- left as is.)

do $$
declare t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relname not like 'social\_%' escape '\'
  loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', t.relname);
  end loop;
end $$;

commit;
