-- Fully Launched CRM — migration 013
-- Supabase security advisor fixes.
--
-- Lint 0028 (anon can execute SECURITY DEFINER functions): signed-out users
--   could call these six through /rest/v1/rpc/. None is meant to be called
--   before sign-in. Revoked from anon and PUBLIC (PUBLIC is how anon got
--   access by default); the explicit grants to authenticated and service_role
--   stay, so signed-in users, RLS policies (all scoped to authenticated) and
--   the other SECURITY DEFINER functions that call these keep working.
--   ensure_an_admin_remains and social_videos_default_filmed_by are trigger
--   functions; Postgres doesn't check EXECUTE when a trigger fires, so their
--   triggers are unaffected.
-- Lint 0011 (mutable search_path): pin search_path on the two trigger
--   functions that didn't set one. Both only touch public tables.

revoke execute on function public.ensure_an_admin_remains() from anon, public;

-- The social_* functions belong to FL-social-dash (same Supabase project).
-- Each revoke only runs if that function exists, so this migration also runs
-- in a database without FL-social-dash. On the shared live project they all
-- exist and this is the same as the plain revokes.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.social_current_client_id()',
    'public.social_current_editor_id()',
    'public.social_current_role()',
    'public.social_is_operator()',
    'public.social_videos_default_filmed_by()'
  ] loop
    if to_regprocedure(fn) is not null then
      execute format('revoke execute on function %s from anon, public', fn);
    end if;
  end loop;
end $$;

alter function public.set_updated_at() set search_path = public;
alter function public.sync_contact_from_project() set search_path = public;
