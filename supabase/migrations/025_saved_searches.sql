-- 025: per-user saved searches (Sales > Find: "Save search", "My saved
-- searches"). params is the POST /api/lead-finder/runs body, so a saved
-- search runs exactly as it was saved. Own rows only (Admin reads all);
-- sweeps can only be saved by Admin/Manager, like running them.
--
-- Applied with Supabase MCP apply_migration.

create table public.saved_searches (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default public.current_team_member_id()
                references public.team_members(id) on delete cascade,
  name        text not null
    constraint saved_searches_name_check check (char_length(btrim(name)) between 1 and 120),
  kind        text not null
    constraint saved_searches_kind_check check (kind in ('search', 'sweep')),
  params      jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  created_at  timestamptz not null default now()
);

create index saved_searches_user_idx on public.saved_searches (user_id, created_at desc);

alter table public.saved_searches enable row level security;

create policy "own or admin read" on public.saved_searches
  for select to authenticated
  using (public.is_team_member() and (user_id = public.current_team_member_id() or public.is_admin()));

create policy "own insert" on public.saved_searches
  for insert to authenticated
  with check (public.is_team_member()
              and user_id = public.current_team_member_id()
              and (kind = 'search' or public.is_admin_or_manager()));

create policy "own update" on public.saved_searches
  for update to authenticated
  using (user_id = public.current_team_member_id())
  with check (user_id = public.current_team_member_id()
              and (kind = 'search' or public.is_admin_or_manager()));

create policy "own delete" on public.saved_searches
  for delete to authenticated
  using (user_id = public.current_team_member_id());

revoke all on public.saved_searches from anon;
revoke truncate, references, trigger, maintain on public.saved_searches from authenticated;
grant select, insert, update, delete on public.saved_searches to authenticated;
