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
revoke execute on function public.social_current_client_id() from anon, public;
revoke execute on function public.social_current_editor_id() from anon, public;
revoke execute on function public.social_current_role() from anon, public;
revoke execute on function public.social_is_operator() from anon, public;
revoke execute on function public.social_videos_default_filmed_by() from anon, public;

alter function public.set_updated_at() set search_path = public;
alter function public.sync_contact_from_project() set search_path = public;
