-- Fully Launched CRM — migration 014
-- Time clock.
--
-- time_entries: one row per clock-in. A user can have at most one open entry
--   (clock_out is null), enforced by a partial unique index. clock_in is
--   always server time (forced on insert). Users close their own open entry;
--   clock_out is then forced to now() as well. Only Admins can change
--   clock_in/clock_out after that, through admin_edit_time_entry() with a
--   reason; every such change is logged to time_entry_edits by a trigger.
--   Management entries need Admin approval (approved_by/approved_at) before
--   they count toward pay; other types don't.
--   user_id is ON DELETE RESTRICT: time entries are pay records, so a team
--   member with entries can't be deleted.
-- time_adjustments: minute adjustments on an entry. "I got distracted" adds
--   -10. Non-Admins can only add deductions, only to their own open entry, and
--   never below 0 net. The creator can delete their own adjustment within 60
--   seconds (Undo).
-- time_entries_net: per-entry duration, adjustments, and net minutes
--   (greatest(0, duration + adjustments)); open entries count up to now().
--
-- Everything is readable by every team member (time must be reviewable by
-- the team). Policies use is_team_member(), matching the live policies on the
-- other tables.
--
-- Run once, after 013, in the Supabase SQL Editor. Creates new objects only;
-- no existing data is touched.

begin;

-- ---------------------------------------------------------------------------
-- Helper: the signed-in user's team_members.id (same match as
-- is_team_member(): confirmed auth email = roster email, case-insensitive).

create or replace function public.current_team_member_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tm.id
  from auth.users u
  join public.team_members tm on lower(tm.email) = lower(u.email)
  where u.id = auth.uid()
    and u.email_confirmed_at is not null
  limit 1;
$$;

revoke execute on function public.current_team_member_id() from public, anon;
grant execute on function public.current_team_member_id() to authenticated;

-- ---------------------------------------------------------------------------
-- Tables

do $$
begin
  if not exists (select 1 from pg_type where typname = 'time_entry_type') then
    create type public.time_entry_type as enum
      ('project', 'management', 'sales', 'internal');
  end if;
end $$;

create table if not exists time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references team_members(id) on delete restrict,
  project_id uuid references projects(id) on delete set null,
  entry_type public.time_entry_type not null,
  clock_in timestamptz not null default now(),
  clock_out timestamptz,
  note text,
  approved_by uuid references team_members(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check (clock_out is null or clock_out >= clock_in),
  -- Only management entries are ever approved.
  check (approved_at is null or entry_type = 'management')
);

create unique index if not exists time_entries_one_open_per_user
  on time_entries (user_id) where clock_out is null;
create index if not exists time_entries_clock_in_idx on time_entries (clock_in);
create index if not exists time_entries_project_idx on time_entries (project_id);

create table if not exists time_adjustments (
  id uuid primary key default gen_random_uuid(),
  time_entry_id uuid not null references time_entries(id) on delete cascade,
  minutes integer not null check (minutes <> 0),
  reason text not null default 'distracted',
  created_by uuid references team_members(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists time_adjustments_entry_idx
  on time_adjustments (time_entry_id);

create table if not exists time_entry_edits (
  id uuid primary key default gen_random_uuid(),
  time_entry_id uuid not null references time_entries(id) on delete cascade,
  field text not null check (field in ('clock_in', 'clock_out')),
  old_value timestamptz,
  new_value timestamptz,
  reason text not null,
  edited_by uuid references team_members(id) on delete set null,
  edited_at timestamptz not null default now()
);

create index if not exists time_entry_edits_entry_idx
  on time_entry_edits (time_entry_id);

-- ---------------------------------------------------------------------------
-- time_entries triggers

-- New entries always start now, open, unapproved — regardless of what the
-- client sent.
create or replace function public.time_entries_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.clock_in := now();
  new.clock_out := null;
  new.approved_by := null;
  new.approved_at := null;
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists time_entries_before_insert on time_entries;
create trigger time_entries_before_insert
  before insert on time_entries
  for each row execute function public.time_entries_before_insert();

-- Guards every update. Security definer so it can write the audit log
-- (time_entry_edits has no insert policy).
--
-- A reason is passed in the transaction-local setting fl.time_edit_reason,
-- which only admin_edit_time_entry() sets.
--
-- - user_id never changes.
-- - Clocking out: the owner closing their own open entry with no reason set.
--   clock_out is forced to now().
-- - Any other change to clock_in/clock_out is an Admin edit: Admin only,
--   reason required, one time_entry_edits row per changed field.
-- - approved_by/approved_at: Admin only, closed management entries only;
--   approving stamps the current Admin and now().
create or replace function public.time_entries_before_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.current_team_member_id();
  admin boolean := public.is_admin();
  reason text := nullif(btrim(current_setting('fl.time_edit_reason', true)), '');
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'An entry''s owner can''t be changed';
  end if;
  if new.created_at is distinct from old.created_at then
    new.created_at := old.created_at;
  end if;

  if old.clock_out is null
     and new.clock_out is not null
     and new.clock_in = old.clock_in
     and old.user_id = me
     and reason is null then
    new.clock_out := now();
  elsif new.clock_in is distinct from old.clock_in
     or new.clock_out is distinct from old.clock_out then
    if not admin then
      raise exception 'Only Admins can change clock times';
    end if;
    if reason is null then
      raise exception 'A reason is required to change clock times';
    end if;
    if new.clock_in is distinct from old.clock_in then
      insert into time_entry_edits
        (time_entry_id, field, old_value, new_value, reason, edited_by)
      values (old.id, 'clock_in', old.clock_in, new.clock_in, reason, me);
    end if;
    if new.clock_out is distinct from old.clock_out then
      insert into time_entry_edits
        (time_entry_id, field, old_value, new_value, reason, edited_by)
      values (old.id, 'clock_out', old.clock_out, new.clock_out, reason, me);
    end if;
  end if;

  if new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at then
    if not admin then
      raise exception 'Only Admins can approve entries';
    end if;
    if new.approved_at is not null or new.approved_by is not null then
      if new.entry_type <> 'management' then
        raise exception 'Only management entries need approval';
      end if;
      if new.clock_out is null then
        raise exception 'Clock out before approving';
      end if;
      new.approved_by := me;
      new.approved_at := now();
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.time_entries_before_update() from public, anon;

drop trigger if exists time_entries_before_update on time_entries;
create trigger time_entries_before_update
  before update on time_entries
  for each row execute function public.time_entries_before_update();

-- Admin edit of clock times, with the reason the audit trigger requires.
-- Security invoker: the Admin update policy and the trigger do the checks.
create or replace function public.admin_edit_time_entry(
  p_entry_id uuid,
  p_clock_in timestamptz,
  p_clock_out timestamptz,
  p_reason text
)
returns void
language plpgsql
set search_path = public
as $$
begin
  if nullif(btrim(p_reason), '') is null then
    raise exception 'A reason is required to change clock times';
  end if;
  perform set_config('fl.time_edit_reason', p_reason, true);

  update time_entries
     set clock_in = p_clock_in,
         clock_out = p_clock_out
   where id = p_entry_id;
  if not found then
    raise exception 'Entry not found or not editable';
  end if;

  perform set_config('fl.time_edit_reason', '', true);
end;
$$;

revoke execute on function public.admin_edit_time_entry(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.admin_edit_time_entry(uuid, timestamptz, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- time_adjustments trigger

-- Validates every adjustment. Security definer so it can lock the entry row
-- (serializing double-clicks) without needing update rights on it.
create or replace function public.time_adjustments_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.current_team_member_id();
  e time_entries%rowtype;
  current_net integer;
begin
  select * into e from time_entries where id = new.time_entry_id for update;
  if not found then
    raise exception 'Time entry not found';
  end if;

  new.created_by := me;
  new.created_at := now();

  if not public.is_admin() then
    if e.user_id is distinct from me then
      raise exception 'You can only adjust your own time';
    end if;
    if e.clock_out is not null then
      raise exception 'You can only adjust time while clocked in';
    end if;
    if new.minutes > 0 then
      raise exception 'Only deductions can be added';
    end if;
  end if;

  select floor(extract(epoch from coalesce(e.clock_out, now()) - e.clock_in) / 60)::integer
         + coalesce(sum(a.minutes), 0)
    into current_net
    from time_adjustments a
   where a.time_entry_id = e.id;

  if current_net + new.minutes < 0 then
    raise exception 'That would take this entry below zero minutes';
  end if;

  return new;
end;
$$;

revoke execute on function public.time_adjustments_before_insert() from public, anon;

drop trigger if exists time_adjustments_before_insert on time_adjustments;
create trigger time_adjustments_before_insert
  before insert on time_adjustments
  for each row execute function public.time_adjustments_before_insert();

-- ---------------------------------------------------------------------------
-- Net view. security_invoker so the caller's RLS applies.

create or replace view time_entries_net
with (security_invoker = true)
as
select
  e.*,
  floor(extract(epoch from coalesce(e.clock_out, now()) - e.clock_in) / 60)::integer
    as duration_minutes,
  coalesce(a.adjustment_minutes, 0)::integer as adjustment_minutes,
  coalesce(a.deduction_count, 0)::integer as deduction_count,
  greatest(
    0,
    floor(extract(epoch from coalesce(e.clock_out, now()) - e.clock_in) / 60)::integer
      + coalesce(a.adjustment_minutes, 0)
  )::integer as net_minutes
from time_entries e
left join (
  select
    time_entry_id,
    sum(minutes) as adjustment_minutes,
    count(*) filter (where minutes < 0) as deduction_count
  from time_adjustments
  group by time_entry_id
) a on a.time_entry_id = e.id;

revoke all on time_entries_net from anon;
grant select on time_entries_net to authenticated;

-- ---------------------------------------------------------------------------
-- RLS

alter table time_entries enable row level security;
alter table time_adjustments enable row level security;
alter table time_entry_edits enable row level security;

revoke all on time_entries, time_adjustments, time_entry_edits from anon;

drop policy if exists "team read" on time_entries;
create policy "team read" on time_entries
  for select to authenticated using (public.is_team_member());

drop policy if exists "own insert" on time_entries;
create policy "own insert" on time_entries
  for insert to authenticated
  with check (user_id = public.current_team_member_id());

-- Owners can only touch their open entry (to clock out); the trigger limits
-- what can change.
drop policy if exists "own open update" on time_entries;
create policy "own open update" on time_entries
  for update to authenticated
  using (user_id = public.current_team_member_id() and clock_out is null)
  with check (user_id = public.current_team_member_id());

drop policy if exists "admin update" on time_entries;
create policy "admin update" on time_entries
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "team read" on time_adjustments;
create policy "team read" on time_adjustments
  for select to authenticated using (public.is_team_member());

drop policy if exists "own insert" on time_adjustments;
create policy "own insert" on time_adjustments
  for insert to authenticated
  with check (created_by = public.current_team_member_id());

-- Undo: the creator, within 60 seconds.
drop policy if exists "creator undo" on time_adjustments;
create policy "creator undo" on time_adjustments
  for delete to authenticated
  using (
    created_by = public.current_team_member_id()
    and created_at > now() - interval '60 seconds'
  );

-- Written only by the time_entries update trigger.
drop policy if exists "team read" on time_entry_edits;
create policy "team read" on time_entry_edits
  for select to authenticated using (public.is_team_member());

commit;
