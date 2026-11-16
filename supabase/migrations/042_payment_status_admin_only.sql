-- Fully Launched CRM, migration 042: only Admins can set projects.payment_status.
--
-- Before: projects update is open to every team member (RLS), so anyone could
-- mark a project Paid. After: a trigger refuses any app-user change to
-- payment_status (insert with a value, or update to a different value) unless
-- public.is_admin(). Every other projects column keeps its current rules.
--
-- Who passes:
--   - Admins (is_admin(): confirmed auth email matched to an Admin roster row).
--   - Server-side writes that don't run as an app user: the Stripe webhook
--     (service_role), migrations and the SQL editor (postgres). Those run as a
--     role other than authenticated / anon, so the guard skips them.
-- Who is refused (42501): Managers and Salespeople signed in to the app, and anon.
--
-- A trigger instead of column privileges: revoking UPDATE (payment_status)
-- would mean granting every other column by name, and every future column
-- would silently be read-only until someone remembered to grant it.
--
-- Applied Nov 16, 2026 from the Supabase SQL editor (not apply_migration), so
-- it is not in the migration history table. Verified on live in rolled-back
-- transactions: Talon (Salesperson) changing payment_status refused 42501,
-- Talon editing another column allowed, Luke (Admin) changing it allowed.

create or replace function public.projects_guard_payment_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Security invoker: current_user is the caller's role. App users run as
  -- authenticated (or anon); service_role / postgres are server-side.
  if current_user not in ('authenticated', 'anon') or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' and new.payment_status is not null then
    raise exception 'Only an Admin can set payment status'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.payment_status is distinct from old.payment_status then
    raise exception 'Only an Admin can change payment status'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.projects_guard_payment_status() from public, anon, authenticated;

drop trigger if exists projects_guard_payment_status on public.projects;
create trigger projects_guard_payment_status
  before insert or update on public.projects
  for each row execute function public.projects_guard_payment_status();
