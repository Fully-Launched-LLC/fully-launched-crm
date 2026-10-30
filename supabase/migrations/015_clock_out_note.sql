-- Fully Launched CRM — migration 015
-- "What did you accomplish?" on clock out.
--
-- time_entries.accomplished: required once an entry is closed, at least 5
--   characters after trimming. Enforced by a CHECK constraint, so it holds
--   for every path that closes an entry: the owner clocking out, an Admin
--   closing a forgotten entry through admin_edit_time_entry(), or a direct
--   API call. It also stops anyone blanking it later.
-- Owners can edit their own accomplished text after clocking out. The
--   "own open update" policy becomes "own update" (any of their entries),
--   and the update trigger now limits a non-Admin's changes to a closed entry
--   to `accomplished` only. Clock times stay Admin-only, as before.
-- admin_edit_time_entry() gains p_accomplished (5 args; the 4-arg version is
--   dropped) so an Admin can close a forgotten entry and write its note in
--   one statement. Admins can also update accomplished directly (their
--   update policy), with no reason needed since no clock time changes.
-- time_entries_net is recreated to pick up the new column (its e.* was
--   expanded when the view was created), still security_invoker, and now
--   select-only for authenticated (see the grants at the end).
--
-- Applied with Supabase MCP apply_migration. time_entries was emptied
-- before this ran (test data), so the constraint has no existing rows to
-- check.

begin;

alter table time_entries add column if not exists accomplished text;

alter table time_entries drop constraint if exists time_entries_accomplished_check;
alter table time_entries add constraint time_entries_accomplished_check
  check (clock_out is null or char_length(btrim(coalesce(accomplished, ''))) >= 5);

-- Same as 014, plus: a non-Admin can only change `accomplished` on a closed
-- entry.
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

  if not admin
     and old.clock_out is not null
     and (new.entry_type, new.project_id, new.note)
         is distinct from (old.entry_type, old.project_id, old.note) then
    raise exception 'After clocking out, only the accomplishment note can be changed';
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

drop policy if exists "own open update" on time_entries;
drop policy if exists "own update" on time_entries;
create policy "own update" on time_entries
  for update to authenticated
  using (user_id = public.current_team_member_id())
  with check (user_id = public.current_team_member_id());

drop function if exists public.admin_edit_time_entry(uuid, timestamptz, timestamptz, text);

-- p_accomplished null/blank keeps the current text.
create or replace function public.admin_edit_time_entry(
  p_entry_id uuid,
  p_clock_in timestamptz,
  p_clock_out timestamptz,
  p_reason text,
  p_accomplished text default null
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
         clock_out = p_clock_out,
         accomplished = coalesce(nullif(btrim(p_accomplished), ''), accomplished)
   where id = p_entry_id;
  if not found then
    raise exception 'Entry not found or not editable';
  end if;

  perform set_config('fl.time_edit_reason', '', true);
end;
$$;

revoke execute on function public.admin_edit_time_entry(uuid, timestamptz, timestamptz, text, text) from public, anon;
grant execute on function public.admin_edit_time_entry(uuid, timestamptz, timestamptz, text, text) to authenticated;

drop view if exists time_entries_net;
create view time_entries_net
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

-- Read-only for signed-in users. Supabase's default privileges grant every
-- new object ALL to anon/authenticated, and 014 only revoked anon, so before
-- this authenticated also held insert/update/delete/truncate on the view
-- (harmless, the view isn't updatable, but not intended).
revoke all on time_entries_net from public, anon, authenticated;
grant select on time_entries_net to authenticated;

commit;
