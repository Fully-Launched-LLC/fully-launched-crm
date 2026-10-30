-- Fully Launched CRM — migration 013b
-- Baseline: the live functions, triggers and RLS policies on the CRM tables,
-- captured from the live database on 2026-10-30.
--
-- Why: hardening done directly in the SQL Editor never made it into a
-- migration. Live has is_team_member() (confirmed auth email that matches a
-- roster row) and every "authenticated = full access" policy was replaced by
-- a "team ..." policy that calls it; assign_call_to_project() also gained an
-- is_team_member() guard. Replaying 002..013 alone leaves `using (true)`
-- policies, so a fresh environment was more open than production.
--
-- Running this against live is a no-op (verified: before/after catalog diff
-- was empty). In a fresh environment it runs after 013 and before 014, and
-- brings the CRM tables to the live state.
--
-- Scope: CRM tables only (team_members, projects, project_tasks,
-- transactions, leads, contacts, contact_merges, calls, call_projects).
-- Nothing social_* is touched. Also adds the live-only GIN index
-- clients_owner_gin on projects(owner), which no earlier migration created.
--
-- Idempotent: functions are create or replace with the exact live bodies;
-- triggers are drop if exists + create; every existing policy on these
-- tables is dropped and the live set recreated, so stale policies from older
-- migrations (e.g. "authenticated full access", which would OR in
-- `using (true)`) can't survive in a fresh environment.

begin;

-- ---------------------------------------------------------------------------
-- Functions (bodies verbatim from pg_get_functiondef on live)

CREATE OR REPLACE FUNCTION public.is_team_member()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from auth.users u
    join public.team_members tm on lower(tm.email) = lower(u.email)
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.team_members tm
    where tm.email = auth.jwt() ->> 'email'
      and tm.role = 'Admin'
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_admin_or_manager()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.team_members tm
    where tm.email = auth.jwt() ->> 'email'
      and tm.role in ('Admin', 'Manager')
  );
$function$;

CREATE OR REPLACE FUNCTION public.ensure_an_admin_remains()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from old_rows where role = 'Admin') then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtext('public.team_members.admin_guard'));

  if not exists (select 1 from public.team_members where role = 'Admin') then
    raise exception 'At least one Admin must remain on the team'
      using errcode = 'check_violation';
  end if;

  return null;
end;
$function$;

-- Shared with FL-social-dash social_* triggers. Do not change without checking that repo.
-- (Body is identical to schema.sql; replacing it changes nothing for them.)
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_contact_from_project()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  insert into contacts (project_id, name, email, phone, company, stage)
  values (new.id, new.contact_name, new.email, new.phone, new.client_name, new.stage)
  on conflict (project_id) do update
    set name = excluded.name,
        email = excluded.email,
        phone = excluded.phone,
        company = excluded.company,
        stage = excluded.stage;
  return new;
end;
$function$;

-- Live body has the comments from 011 stripped; logic is unchanged.
CREATE OR REPLACE FUNCTION public.merge_contacts(p_primary uuid, p_members uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if p_primary is null or coalesce(array_length(p_members, 1), 0) = 0 then
    raise exception 'merge_contacts needs a primary and at least one member';
  end if;
  delete from contact_merges where contact_id = p_primary;
  update contact_merges set primary_contact_id = p_primary
   where primary_contact_id = any (p_members) and contact_id <> p_primary;
  insert into contact_merges (contact_id, primary_contact_id)
  select m, p_primary from unnest(p_members) as m where m <> p_primary
  on conflict (contact_id) do update
    set primary_contact_id = excluded.primary_contact_id, created_at = now();
end;
$function$;

-- Live adds the is_team_member() guard (not in 012).
CREATE OR REPLACE FUNCTION public.assign_call_to_project(p_call_id uuid, p_project_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_team_member() then
    raise exception 'Only team members can assign calls';
  end if;
  if not exists (select 1 from calls where id = p_call_id) then
    raise exception 'Call not found';
  end if;
  if not exists (select 1 from projects where id = p_project_id) then
    raise exception 'Project not found';
  end if;

  insert into call_projects (call_id, project_id)
  values (p_call_id, p_project_id)
  on conflict do nothing;

  update calls
     set matched_by = 'manual', updated_at = now()
   where id = p_call_id and matched_by = 'none';
end;
$function$;

-- Function privileges as on live: the SECURITY DEFINER functions and
-- merge_contacts are executable by authenticated + service_role only (no
-- PUBLIC, no anon). set_updated_at and sync_contact_from_project keep
-- Supabase's defaults.
revoke all on function public.is_team_member() from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_admin_or_manager() from public, anon;
revoke all on function public.ensure_an_admin_remains() from public, anon;
revoke all on function public.merge_contacts(uuid, uuid[]) from public, anon;
revoke all on function public.assign_call_to_project(uuid, uuid) from public, anon;
grant execute on function public.is_team_member() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.is_admin_or_manager() to authenticated, service_role;
grant execute on function public.ensure_an_admin_remains() to authenticated, service_role;
grant execute on function public.merge_contacts(uuid, uuid[]) to authenticated, service_role;
grant execute on function public.assign_call_to_project(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Indexes (definition from live: pg_get_indexdef)

create index if not exists clients_owner_gin on public.projects using gin (owner);

-- ---------------------------------------------------------------------------
-- Triggers

drop trigger if exists projects_set_updated_at on public.projects;
CREATE TRIGGER projects_set_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists projects_sync_contact on public.projects;
CREATE TRIGGER projects_sync_contact AFTER INSERT OR UPDATE OF contact_name, email, phone, client_name, stage ON public.projects FOR EACH ROW WHEN (((new.contact_name IS NOT NULL) AND (new.contact_name <> ''::text))) EXECUTE FUNCTION sync_contact_from_project();

drop trigger if exists team_members_admin_guard_delete on public.team_members;
CREATE TRIGGER team_members_admin_guard_delete AFTER DELETE ON public.team_members REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION ensure_an_admin_remains();

drop trigger if exists team_members_admin_guard_update on public.team_members;
CREATE TRIGGER team_members_admin_guard_update AFTER UPDATE ON public.team_members REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION ensure_an_admin_remains();

-- ---------------------------------------------------------------------------
-- RLS: enabled on every CRM table; drop whatever policies exist, then
-- recreate the live set.

alter table public.team_members enable row level security;
alter table public.projects enable row level security;
alter table public.project_tasks enable row level security;
alter table public.transactions enable row level security;
alter table public.leads enable row level security;
alter table public.contacts enable row level security;
alter table public.contact_merges enable row level security;
alter table public.calls enable row level security;
alter table public.call_projects enable row level security;

do $$
declare p record;
begin
  for p in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('team_members', 'projects', 'project_tasks', 'transactions',
                        'leads', 'contacts', 'contact_merges', 'calls', 'call_projects')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- team_members: everyone on the team reads; Admins write (005).
create policy "team read" on public.team_members
  for select to authenticated using (public.is_team_member());
create policy "admin insert" on public.team_members
  for insert to authenticated with check (public.is_admin());
create policy "admin update" on public.team_members
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin delete" on public.team_members
  for delete to authenticated using (public.is_admin());

-- projects: team select/insert/update; Admin or Manager delete (007).
create policy "team select" on public.projects
  for select to authenticated using (public.is_team_member());
create policy "team insert" on public.projects
  for insert to authenticated with check (public.is_team_member());
create policy "team update" on public.projects
  for update to authenticated using (public.is_team_member()) with check (public.is_team_member());
create policy "admin or manager delete" on public.projects
  for delete to authenticated using (public.is_admin_or_manager());

create policy "team full access" on public.project_tasks
  for all to authenticated using (public.is_team_member()) with check (public.is_team_member());

-- transactions: Admin only. Inline check (exact-case email), as on live.
create policy "admin only access" on public.transactions
  for all to authenticated
  using (exists (
    select 1 from team_members tm
    where tm.email = (auth.jwt() ->> 'email') and tm.role = 'Admin'
  ))
  with check (exists (
    select 1 from team_members tm
    where tm.email = (auth.jwt() ->> 'email') and tm.role = 'Admin'
  ));

create policy "team full access" on public.leads
  for all to authenticated using (public.is_team_member()) with check (public.is_team_member());
create policy "team full access" on public.contacts
  for all to authenticated using (public.is_team_member()) with check (public.is_team_member());
create policy "team full access" on public.contact_merges
  for all to authenticated using (public.is_team_member()) with check (public.is_team_member());

-- calls / call_projects: read-only to the app (writes: webhook service role,
-- assign_call_to_project()).
create policy "team read" on public.calls
  for select to authenticated using (public.is_team_member());
create policy "team read" on public.call_projects
  for select to authenticated using (public.is_team_member());

commit;
