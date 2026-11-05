-- 024: grouped Sales outcomes + meeting fixes.
--
-- a) Outcome 'connected' (LinkedIn: they accepted our request). The other
--    new buttons map onto existing values:
--      Left voicemail  = channel voicemail,        outbound, outcome null
--      Connection sent = channel linkedin_connect, outbound, outcome sent
--      Connected       = channel linkedin_connect, outbound, outcome connected
--      Messaged        = channel linkedin_dm,      outbound, outcome sent
--    (not_available already exists, migration 023.)
-- b) Meetings never change a business's status: the touch trigger skips the
--    status step for touches with a meeting_note_id (log_meeting and
--    link_meeting). last_touch_at is still stamped. Otherwise unchanged
--    from 017.
-- c) log_meeting matches a phone number in the title (last 10 digits vs
--    leads.phone_digits) after attendee emails and before the business
--    name. matched_by gains 'phone'. Otherwise unchanged from 022.
--
-- Applied with Supabase MCP apply_migration.

-- a)
alter table public.lead_touches drop constraint lead_touches_outcome_check;
alter table public.lead_touches add constraint lead_touches_outcome_check
  check (outcome in ('sent', 'no_answer', 'no_reply', 'replied', 'interested', 'not_interested',
                     'bad_fit', 'bounced', 'meeting_booked', 'meeting_held', 'not_available', 'connected'));

-- b)
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

  -- Meeting notes (022) only add a timeline entry: no status change.
  v_target := case
    when new.meeting_note_id is not null                                        then null
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

-- c)
alter table public.meeting_notes drop constraint meeting_notes_matched_by_check;
alter table public.meeting_notes add constraint meeting_notes_matched_by_check
  check (matched_by in ('lead_id', 'email', 'phone', 'title', 'manual'));

create or replace function public.log_meeting(
  p_source_id     text,
  p_title         text,
  p_creator_email text,
  p_started_at    timestamptz,
  p_attendees     jsonb,
  p_summary_md    text,
  p_source_url    text,
  p_lead_id       uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note_id  uuid;
  v_lead     uuid;
  v_by       text;
  v_existing public.meeting_notes;
  v_emails   text[];
  v_head     text;
  v_phone    text;
begin
  if coalesce(btrim(p_source_id), '') = '' then
    raise exception 'source_id is required' using errcode = '22023';
  end if;

  select * into v_existing from public.meeting_notes where source_id = p_source_id;

  if p_lead_id is not null then
    if not exists (select 1 from public.leads where id = p_lead_id) then
      raise exception 'Business record not found' using errcode = 'P0002';
    end if;
    v_lead := p_lead_id;
    v_by := 'lead_id';
  elsif v_existing.lead_id is not null then
    v_lead := v_existing.lead_id;
    v_by := v_existing.matched_by;
  else
    -- 1. Attendee emails, outside our own domain.
    select array_agg(distinct e) into v_emails
    from (
      select lower(btrim(coalesce(a ->> 'email', case when jsonb_typeof(a) = 'string' then a #>> '{}' end))) e
      from jsonb_array_elements(case when jsonb_typeof(p_attendees) = 'array' then p_attendees else '[]'::jsonb end) a
    ) x
    where e like '%@%' and e not like '%@fullylaunched.com';

    if v_emails is not null then
      select id into v_lead
      from public.leads
      where lower(btrim(email)) = any (v_emails)
      order by (source = 'lead_finder') desc, last_touch_at desc nulls last, created_at
      limit 1;
      if v_lead is not null then v_by := 'email'; end if;
    end if;

    -- 2. A phone number in the title: last 10 digits vs phone_digits.
    if v_lead is null and coalesce(p_title, '') <> '' then
      -- No capturing groups, so [1] is the whole match.
      v_phone := public.lead_norm_phone(
        (regexp_match(p_title, '(?:\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}'))[1]
      );
      if v_phone is not null then
        select id into v_lead
        from public.leads
        where phone_digits = v_phone
        order by (source = 'lead_finder') desc, last_touch_at desc nulls last, created_at
        limit 1;
        if v_lead is not null then v_by := 'phone'; end if;
      end if;
    end if;

    -- 3. The business name ("Business name, contact name").
    if v_lead is null and coalesce(btrim(p_title), '') <> '' then
      v_head := lower(btrim(split_part(p_title, ',', 1)));
      select id into v_lead
      from public.leads
      where company is not null and char_length(btrim(company)) >= 3
        and (lower(btrim(company)) = v_head
             or position(lower(btrim(company)) in lower(p_title)) > 0)
      order by (lower(btrim(company)) = v_head) desc,
               char_length(btrim(company)) desc,
               (source = 'lead_finder') desc,
               last_touch_at desc nulls last
      limit 1;
      if v_lead is not null then v_by := 'title'; end if;
    end if;
  end if;

  insert into public.meeting_notes as m
    (source, source_id, source_url, title, started_at, creator_email, attendees, summary_md, lead_id, matched_by)
  values
    ('granola', p_source_id, p_source_url, p_title, p_started_at, p_creator_email,
     coalesce(p_attendees, '[]'::jsonb), p_summary_md, v_lead, v_by)
  on conflict (source_id) do update set
    source_url    = excluded.source_url,
    title         = excluded.title,
    started_at    = excluded.started_at,
    creator_email = excluded.creator_email,
    attendees     = excluded.attendees,
    summary_md    = excluded.summary_md,
    lead_id       = excluded.lead_id,
    matched_by    = excluded.matched_by
  returning id into v_note_id;

  perform public.meeting_note_touch(v_note_id, null);

  return jsonb_build_object('meeting_note_id', v_note_id, 'matched', v_lead is not null,
                            'lead_id', v_lead, 'matched_by', v_by);
end;
$$;

revoke all on function public.log_meeting(text, text, text, timestamptz, jsonb, text, text, uuid) from public, anon, authenticated;
grant execute on function public.log_meeting(text, text, text, timestamptz, jsonb, text, text, uuid) to service_role;
