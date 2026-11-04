-- Fully Launched CRM — migration 017
-- Lead Finder + master lead list.
--
--   a) Revoke MAINTAIN (new in Postgres 17, default-granted) from anon and
--      authenticated on the 12 CRM tables that still have it.
--   b) Extend leads in place (existing 32 rows and ids kept), backfill from
--      contact_info, normalize trigger (email, domain, phone_digits, name),
--      found_by guard, dedupe indexes.
--   c) lead_touches (outreach history) + trigger that stamps last_touch_at and
--      promotes leads.status.
--   d) lead_imports (one row per CSV import).
--   e) lead_finder_runs + lead_finder_results (chunked search/sweep state,
--      stepped by the client; see app/api/lead-finder/runs).
--   f) RLS + grants for all of the above.
--   g) team_members.lead_branches (who leads each branch; read by the
--      Convert to Interested modal). Seeded once by roster email.
--
-- Identity/role helpers are the 016 ones: is_team_member(), is_admin(),
-- is_admin_or_manager(), current_team_member_id().
--
-- Applied with Supabase MCP apply_migration.

begin;

-- ===========================================================================
-- a) MAINTAIN revoke (call_projects, calls, contact_merges, contacts, leads,
--    project_tasks, projects, team_members, transactions: anon + authenticated;
--    time_adjustments, time_entries, time_entry_edits: authenticated).
--    Same loop shape as 016's truncate/references/trigger sweep. social_*
--    tables are skipped (FL-social-dash owns them).

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
    execute format('revoke maintain on public.%I from anon, authenticated', t.relname);
  end loop;
end $$;

-- ===========================================================================
-- g) team_members.lead_branches

alter table public.team_members
  add column lead_branches text[] not null default '{}'
    constraint team_members_lead_branches_check
    check (lead_branches <@ array['AI', 'Ecommerce', 'Media', 'Websites']::text[]);

-- One-time seed, keyed on roster email (case-insensitive), not name.
update public.team_members set lead_branches = array['AI']        where lower(email) = 'luke@fullylaunched.com';
update public.team_members set lead_branches = array['Ecommerce'] where lower(email) = 'matteo@fullylaunched.com';
update public.team_members set lead_branches = array['Media']     where lower(email) = 'tait@fullylaunched.com';
update public.team_members set lead_branches = array['Websites']  where lower(email) = 'elias@fullylaunched.com';

-- ===========================================================================
-- b) leads

alter table public.leads
  add column company         text,
  add column contact_name    text,
  add column title           text,
  add column email           text,
  add column phone           text,
  add column phone_digits    text,
  add column website         text,
  add column domain          text,
  add column address         text,
  add column city            text,
  add column state           text,
  add column industry        text,
  add column category        text,
  add column branch_fit      text[] not null default '{}'
    constraint leads_branch_fit_check
    check (branch_fit <@ array['AI', 'Ecommerce', 'Media', 'Websites']::text[]),
  add column wheaton_alum    boolean not null default false,
  add column source_detail   text,
  add column external_ids    jsonb not null default '{}'::jsonb,
  add column google_place_id text,
  add column maps_url        text,
  add column rating          numeric,
  add column review_count    integer,
  add column website_status  text,
  add column scan_tags       jsonb,
  add column lead_score      integer,
  add column priority_score  integer,
  add column uses_servicetitan boolean not null default false,
  add column audit           jsonb,
  add column audit_at        timestamptz,
  add column status          text not null default 'new'
    constraint leads_status_check
    check (status in ('new', 'contacted', 'replied', 'interested', 'converted', 'not_interested', 'dead')),
  -- Who added it (sales credit later). Restrict, like time_entries.user_id:
  -- a member who found leads can't be deleted out from under that record.
  add column found_by        uuid references public.team_members(id) on delete restrict
                               default public.current_team_member_id(),
  -- Who is working it now.
  add column owner           uuid references public.team_members(id) on delete set null,
  add column project_id      uuid references public.projects(id) on delete set null,
  add column last_touch_at   timestamptz,
  add column next_action     text,
  add column next_action_at  timestamptz,
  add column updated_at      timestamptz not null default now();

-- contact_info is kept (not dropped) as the original free text.

-- Normalize on every write:
--   email   -> trimmed, lowercase, null if blank
--   domain  -> lowercase host, no scheme/www/port/path; derived from website
--              when not given; null for social/link-in-bio hosts (same list
--              as the Lead Finder scanner's NOT_A_REAL_SITE) so a Facebook
--              page never claims "facebook.com" for one business
--   phone_digits -> last 10 digits of phone, null if fewer than 10
--   name    -> legacy not-null display column; mirrors company when blank
create or replace function public.leads_normalize()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host text;
  v_digits text;
begin
  new.email := nullif(lower(btrim(new.email)), '');

  v_host := lower(btrim(coalesce(nullif(btrim(new.domain), ''), new.website, '')));
  v_host := regexp_replace(v_host, '^[a-z][a-z0-9+.-]*://', '');
  v_host := regexp_replace(v_host, '^[^@/]*@', '');
  v_host := regexp_replace(v_host, '[/?#:].*$', '');
  v_host := regexp_replace(v_host, '^www\.', '');
  v_host := nullif(v_host, '');
  if v_host is not null and (
       v_host in ('facebook.com', 'fb.com', 'instagram.com', 'linktr.ee', 'linkin.bio',
                  'tiktok.com', 'yelp.com', 'business.site', 'g.page', 'google.com',
                  'nextdoor.com', 'x.com', 'twitter.com')
    or v_host ~ '\.(facebook\.com|fb\.com|instagram\.com|linktr\.ee|linkin\.bio|tiktok\.com|yelp\.com|business\.site|g\.page|google\.com|nextdoor\.com|x\.com|twitter\.com)$'
  ) then
    v_host := null;
  end if;
  new.domain := v_host;

  v_digits := regexp_replace(coalesce(new.phone, ''), '\D', '', 'g');
  new.phone_digits := case when length(v_digits) >= 10 then right(v_digits, 10) end;

  new.company := nullif(btrim(new.company), '');
  new.name := coalesce(nullif(btrim(new.name), ''), new.company, nullif(btrim(new.contact_name), ''), new.email, 'Unnamed lead');
  if new.company is null and tg_op = 'INSERT' then
    new.company := new.name;
  end if;

  return new;
end;
$$;

create trigger leads_normalize
  before insert or update on public.leads
  for each row execute function public.leads_normalize();

-- set_updated_at() is shared with FL-social-dash; used as-is, not modified.
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- Backfill the existing rows. contact_info shapes on live (Nov 3): 9 plain
-- emails, ~20 "LinkedIn: <url>", 2 "<email>; <phone|LinkedIn>", 1 other.
-- Each piece is extracted separately; anything with none of the three goes
-- to notes. company = name; found_by and owner = Luke (by roster email).
update public.leads l
set
  company = l.name,
  email = lower(substring(l.contact_info from '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')),
  -- URLs stripped first so digits in a LinkedIn slug never read as a phone.
  phone = substring(regexp_replace(l.contact_info, 'https?://\S+', '', 'g') from '\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}'),
  external_ids = case
    when l.contact_info ~* 'https?://(www\.)?linkedin\.com/'
      then jsonb_build_object('linkedin', substring(l.contact_info from '(?i)https?://(?:www\.)?linkedin\.com/[^\s;,]+'))
    else '{}'::jsonb
  end,
  notes = case
    when l.contact_info !~ '@'
     and l.contact_info !~* 'linkedin\.com/'
     and regexp_replace(l.contact_info, 'https?://\S+', '', 'g') !~ '\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}'
     and nullif(btrim(l.contact_info), '') is not null
      then concat_ws(E'\n', nullif(btrim(l.notes), ''), 'Contact info: ' || btrim(l.contact_info))
    else l.notes
  end,
  found_by = (select id from public.team_members where lower(email) = 'luke@fullylaunched.com'),
  owner    = (select id from public.team_members where lower(email) = 'luke@fullylaunched.com');

-- found_by is sales credit: only Admin/Manager can change it after insert.
-- Created after the backfill (no signed-in user during a migration).
create or replace function public.leads_guard_found_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.found_by is distinct from old.found_by and not public.is_admin_or_manager() then
    raise exception 'Only an Admin or Manager can change who found a lead'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger leads_guard_found_by
  before update of found_by on public.leads
  for each row execute function public.leads_guard_found_by();

-- Dedupe keys (match order in the app: google_place_id, cid, email, domain,
-- phone_digits). Only google_place_id and cid are unique: they identify one
-- physical location. Email, domain and phone are shared by chain/franchise
-- locations, so they're plain indexes; the shared upsert matches on them only
-- when the two records don't both carry a place id / cid that differ.
create unique index leads_google_place_id_key on public.leads (google_place_id) where google_place_id is not null;
create unique index leads_cid_key on public.leads ((external_ids ->> 'cid')) where (external_ids ->> 'cid') is not null;
create index leads_email_idx on public.leads (lower(email)) where email is not null;
create index leads_domain_idx on public.leads (domain) where domain is not null;
create index leads_phone_digits_idx on public.leads (phone_digits) where phone_digits is not null;
create index leads_owner_idx on public.leads (owner);
create index leads_status_idx on public.leads (status);
create index leads_project_id_idx on public.leads (project_id) where project_id is not null;

-- ===========================================================================
-- c) lead_touches

create table public.lead_touches (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads(id) on delete cascade,
  channel     text not null
    constraint lead_touches_channel_check
    check (channel in ('linkedin_connect', 'linkedin_dm', 'email', 'cold_call', 'voicemail', 'text', 'loom', 'in_person', 'meeting', 'other')),
  direction   text not null default 'outbound'
    constraint lead_touches_direction_check
    check (direction in ('outbound', 'inbound')),
  outcome     text
    constraint lead_touches_outcome_check
    check (outcome in ('sent', 'no_answer', 'no_reply', 'replied', 'interested', 'not_interested', 'bad_fit', 'bounced', 'meeting_booked', 'meeting_held')),
  summary     text,
  touched_by  uuid references public.team_members(id) on delete restrict
                default public.current_team_member_id(),
  touched_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index lead_touches_lead_idx on public.lead_touches (lead_id, touched_at desc);

-- After a touch: last_touch_at = latest touch, then status:
--   converted       -> never changed by a touch.
--   negative outcome (not_interested, bad_fit) -> not_interested, from any
--                      status below converted (including dead).
--   positive outcome (replied -> replied; interested, meeting_booked,
--                      meeting_held -> interested) -> also recovers a lead
--                      out of not_interested or dead.
--   everything else -> rank-based, forward only:
--                      new 0 < contacted 1 < replied 2 < interested 3
--                      < not_interested 4 < dead 5.
--   (outbound with no positive/negative outcome -> contacted; inbound with
--    no outcome -> replied, rank-based.)
-- Security definer: a Salesperson can log a touch on a lead someone else
-- owns (RLS would block their direct update); this only writes
-- last_touch_at and status.
create or replace function public.lead_touches_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
  v_target  text;
  v_rank    constant jsonb := '{"new":0,"contacted":1,"replied":2,"interested":3,"not_interested":4,"dead":5,"converted":6}';
begin
  select status into v_current from public.leads where id = new.lead_id for update;

  v_target := case
    when new.outcome in ('not_interested', 'bad_fit')                          then 'not_interested'
    when new.outcome in ('interested', 'meeting_booked', 'meeting_held')        then 'interested'
    when new.outcome = 'replied' or new.direction = 'inbound'                   then 'replied'
    when new.direction = 'outbound'                                             then 'contacted'
  end;

  update public.leads
  set last_touch_at = greatest(coalesce(last_touch_at, new.touched_at), new.touched_at),
      status = case
        when v_current = 'converted' or v_target is null then status
        when v_target = 'not_interested' then 'not_interested'
        when new.outcome in ('replied', 'interested', 'meeting_booked', 'meeting_held')
         and v_current in ('not_interested', 'dead') then v_target
        when (v_rank ->> v_target)::int > (v_rank ->> v_current)::int then v_target
        else status
      end
  where id = new.lead_id;

  return new;
end;
$$;

create trigger lead_touches_after_insert
  after insert on public.lead_touches
  for each row execute function public.lead_touches_after_insert();

-- ===========================================================================
-- d) lead_imports

create table public.lead_imports (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,
  file_name   text,
  row_count   integer not null default 0,
  inserted    integer not null default 0,
  merged      integer not null default 0,
  skipped     integer not null default 0,
  imported_by uuid references public.team_members(id) on delete set null
                default public.current_team_member_id(),
  created_at  timestamptz not null default now()
);

-- ===========================================================================
-- e) lead_finder_runs / lead_finder_results

create table public.lead_finder_runs (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null
    constraint lead_finder_runs_kind_check check (kind in ('search', 'sweep')),
  params           jsonb not null default '{}'::jsonb,
  planned_searches integer not null default 0,
  done_searches    integer not null default 0,
  est_cost         numeric(8, 2),
  status           text not null default 'queued'
    constraint lead_finder_runs_status_check
    check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  result_count     integer not null default 0,
  error            text,
  run_by           uuid references public.team_members(id) on delete set null
                     default public.current_team_member_id(),
  created_at       timestamptz not null default now(),
  -- Last step time; the UI uses it to show "stalled, Resume".
  updated_at       timestamptz not null default now(),
  finished_at      timestamptz
);

create index lead_finder_runs_created_idx on public.lead_finder_runs (created_at desc);

create trigger lead_finder_runs_set_updated_at
  before update on public.lead_finder_runs
  for each row execute function public.set_updated_at();

create table public.lead_finder_results (
  run_id          uuid not null references public.lead_finder_runs(id) on delete cascade,
  google_place_id text not null,
  -- The business type whose search found this place (scanPlace uses it for
  -- category detection).
  search_type     text,
  -- Raw Google place until scanned; scanPlace output after.
  payload         jsonb not null,
  -- Scan-phase cursor: null = not scanned yet.
  scanned_at      timestamptz,
  created_at      timestamptz not null default now(),
  primary key (run_id, google_place_id)
);

create index lead_finder_results_unscanned_idx on public.lead_finder_results (run_id) where scanned_at is null;

-- ===========================================================================
-- f) RLS

-- leads
drop policy if exists "team full access" on public.leads;

create policy "team read" on public.leads
  for select to authenticated
  using (public.is_team_member());

-- Any team member inserts. A Salesperson must credit themselves and can only
-- own it themselves or leave it unassigned; Admin/Manager (imports) can set
-- any found_by/owner.
create policy "team insert" on public.leads
  for insert to authenticated
  with check (
    public.is_team_member()
    and (
      public.is_admin_or_manager()
      or (found_by = public.current_team_member_id()
          and (owner is null or owner = public.current_team_member_id()))
    )
  );

-- Admin/Manager: any lead, any owner. Salesperson: leads they own or that
-- have no owner, and the owner can only end up as themselves or null.
create policy "owner or manager update" on public.leads
  for update to authenticated
  using (
    public.is_team_member()
    and (public.is_admin_or_manager()
         or owner is null
         or owner = public.current_team_member_id())
  )
  with check (
    public.is_team_member()
    and (public.is_admin_or_manager()
         or owner is null
         or owner = public.current_team_member_id())
  );

create policy "admin delete" on public.leads
  for delete to authenticated
  using (public.is_admin());

-- lead_touches
alter table public.lead_touches enable row level security;

create policy "team read" on public.lead_touches
  for select to authenticated
  using (public.is_team_member());

create policy "team insert as self" on public.lead_touches
  for insert to authenticated
  with check (public.is_team_member() and touched_by = public.current_team_member_id());

create policy "own or manager update" on public.lead_touches
  for update to authenticated
  using (public.is_admin_or_manager() or touched_by = public.current_team_member_id())
  with check (public.is_admin_or_manager() or touched_by = public.current_team_member_id());

create policy "own or manager delete" on public.lead_touches
  for delete to authenticated
  using (public.is_admin_or_manager() or touched_by = public.current_team_member_id());

-- lead_imports
alter table public.lead_imports enable row level security;

create policy "team read" on public.lead_imports
  for select to authenticated
  using (public.is_team_member());

create policy "team insert as self" on public.lead_imports
  for insert to authenticated
  with check (public.is_team_member() and imported_by = public.current_team_member_id());

create policy "own update" on public.lead_imports
  for update to authenticated
  using (imported_by = public.current_team_member_id())
  with check (imported_by = public.current_team_member_id());

create policy "admin delete" on public.lead_imports
  for delete to authenticated
  using (public.is_admin());

-- lead_finder_runs: everyone reads; Salesperson creates 'search' only;
-- sweeps are Admin/Manager. The runner or an Admin/Manager can step,
-- resume or cancel.
alter table public.lead_finder_runs enable row level security;

create policy "team read" on public.lead_finder_runs
  for select to authenticated
  using (public.is_team_member());

create policy "team insert, sweeps for managers" on public.lead_finder_runs
  for insert to authenticated
  with check (
    public.is_team_member()
    and run_by = public.current_team_member_id()
    and (kind = 'search' or public.is_admin_or_manager())
  );

create policy "runner or manager update" on public.lead_finder_runs
  for update to authenticated
  using (public.is_admin_or_manager() or run_by = public.current_team_member_id())
  with check (
    (public.is_admin_or_manager() or run_by = public.current_team_member_id())
    and (kind = 'search' or public.is_admin_or_manager())
  );

create policy "admin delete" on public.lead_finder_runs
  for delete to authenticated
  using (public.is_admin());

-- lead_finder_results: everyone reads; written by whoever may step the run.
alter table public.lead_finder_results enable row level security;

create policy "team read" on public.lead_finder_results
  for select to authenticated
  using (public.is_team_member());

create policy "runner or manager insert" on public.lead_finder_results
  for insert to authenticated
  with check (exists (
    select 1 from public.lead_finder_runs r
    where r.id = run_id
      and (public.is_admin_or_manager() or r.run_by = public.current_team_member_id())
  ));

create policy "runner or manager update" on public.lead_finder_results
  for update to authenticated
  using (exists (
    select 1 from public.lead_finder_runs r
    where r.id = run_id
      and (public.is_admin_or_manager() or r.run_by = public.current_team_member_id())
  ))
  with check (exists (
    select 1 from public.lead_finder_runs r
    where r.id = run_id
      and (public.is_admin_or_manager() or r.run_by = public.current_team_member_id())
  ));

-- ===========================================================================
-- Grants. anon: nothing on any of these. authenticated: select/insert/
-- update/delete only (RLS decides), no truncate/references/trigger/maintain.
-- Trigger functions: no execute for anyone (016 pattern).

revoke all on public.leads, public.lead_touches, public.lead_imports,
              public.lead_finder_runs, public.lead_finder_results
  from public, anon, authenticated;

grant select, insert, update, delete on public.leads, public.lead_touches, public.lead_imports,
                                      public.lead_finder_runs, public.lead_finder_results
  to authenticated;

revoke all on function public.leads_normalize() from public, anon, authenticated;
revoke all on function public.leads_guard_found_by() from public, anon, authenticated;
revoke all on function public.lead_touches_after_insert() from public, anon, authenticated;

commit;
