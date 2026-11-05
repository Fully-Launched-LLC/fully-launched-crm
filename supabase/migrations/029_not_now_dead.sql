-- 029: "Not now" and "Dead" outcomes (Sales).
--   not_now: the business asked us to come back later. The app also sets
--     next_action "Revisit" + next_action_at (the revisit date), so it shows
--     in Follow up today when that day comes. Status: at least contacted
--     (never read as a reply).
--   dead: wrong number, closed, bounced email, not a real business, other
--     (details.dead_reason). Status dead (not over converted).
-- Other Sales extras live in lead_touches.details (023): said_no_by
-- (owner / staff) on Not interested, talked_to (owner / staff) on calls.
-- The touch trigger is otherwise unchanged from 017 / 024.
--
-- Applied with Supabase MCP apply_migration.

alter table public.lead_touches drop constraint lead_touches_outcome_check;
alter table public.lead_touches add constraint lead_touches_outcome_check
  check (outcome in ('sent', 'no_answer', 'no_reply', 'replied', 'interested', 'not_interested',
                     'bad_fit', 'bounced', 'meeting_booked', 'meeting_held', 'not_available', 'connected',
                     'not_now', 'dead'));

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
    when new.meeting_note_id is not null                                  then null
    when new.outcome = 'dead'                                             then 'dead'
    when new.outcome in ('not_interested', 'bad_fit')                    then 'not_interested'
    when new.outcome = 'not_now'                                          then 'contacted'
    when new.outcome in ('interested', 'meeting_booked', 'meeting_held')  then 'interested'
    when new.outcome = 'replied' or new.direction = 'inbound'             then 'replied'
    when new.direction = 'outbound'                                       then 'contacted'
  end;

  update public.leads
  set last_touch_at = greatest(coalesce(last_touch_at, new.touched_at), new.touched_at),
      status = case
        when v_current = 'converted' or v_target is null then status
        when v_target in ('not_interested', 'dead') then v_target
        when new.outcome in ('replied', 'interested', 'meeting_booked', 'meeting_held')
         and v_current in ('not_interested', 'dead') then v_target
        when (v_rank ->> v_target)::int > (v_rank ->> v_current)::int then v_target
        else status
      end
  where id = new.lead_id;

  return new;
end;
$$;
