-- 032: every project belongs to a company record (one lead per company);
-- pipeline stages.
--
-- a) Projects at stage "Leads" move to the Leads tab: a leads row (status
--    contacted, owner = first project owner else Luke, found_by = first
--    salesperson else Luke) or, if a business with the same email already
--    exists, that one; the project notes become a timeline note; then the
--    project row is deleted (no tasks, transactions, calls or time entries
--    reference them; their contacts rows stay, project_id null).
--    Decade: Not now, revisit in 6 months ("Just networking, connecting not
--    interested in help right now").
-- b) Every other project joins a company: projects are grouped when they
--    share a normalized client_name, an email domain (not gmail, yahoo,
--    ...) or the last 10 phone digits (transitively). One lead per company,
--    projects.lead_id set on all of its projects, leads.project_id = its
--    most active project (In Progress / Subscriber, Signed, Negotiation,
--    Interested, Complete, Lost; newest first).
--      name / company: the earliest project's client_name
--      owner + found_by: the earliest project's first salesperson, else Luke
--        (project owners, the branch leads, stay on each project)
--      contact_name, owner_email, owner_phone: the project contact (a person,
--        not the business line; first value across the projects, oldest first)
--      branch_fit: every branch; source: earliest project's source mapped
--        (Referral -> referral, Relationship -> personal_network, else manual)
--      status: converted if any project is Signed / In Progress / Subscriber
--        / Complete, else interested if any is Interested / Negotiation,
--        else not_interested (all Lost: one "Project lost" note per project)
-- c) Stages: Interested -> Negotiation -> Signed -> In Progress ->
--    Subscriber -> Complete (+ Lost). "Leads" removed, default Interested.
-- d) log_meeting: attendee emails also match owner_email; title matching
--    uses word boundaries (a 4-letter company like "SALT" no longer matches
--    "consultation"); new rule 4 matches the contact name after the last
--    comma ("Business, contact name (meeting)") against contact_name
--    (matched_by 'contact').
-- e) Re-run matching for every unmatched meeting note.
--
-- Applied with Supabase MCP apply_migration.

create temp table _luke on commit drop as
  select id from public.team_members where lower(email) = 'luke@fullylaunched.com';

-- a) Leads-stage projects ------------------------------------------------------
create temp table _moved on commit drop as
select p.*,
       gen_random_uuid() as new_lead_id,
       (select l.id from public.leads l
        where nullif(btrim(p.email), '') is not null
          and lower(btrim(l.email)) = lower(btrim(p.email))
        order by l.created_at limit 1) as existing_lead_id
from public.projects p
where p.stage = 'Leads';

insert into public.leads
  (id, name, company, contact_name, owner_email, owner_phone, branch_fit, source, source_detail,
   owner, found_by, status, created_at)
select m.new_lead_id, m.client_name, m.client_name,
       nullif(btrim(m.contact_name), ''), nullif(btrim(m.email), ''), nullif(btrim(m.phone), ''),
       case when m.branch is null then '{}'::text[] else array[m.branch] end,
       case m.source when 'Referral' then 'referral' when 'Relationship' then 'personal_network' else 'manual' end,
       concat_ws(' · ', 'Moved from Projects (Leads stage)',
                 case when m.source not in ('Referral', 'Relationship') then 'Project source: ' || m.source end),
       coalesce(m.owner[1], (select id from _luke)),
       coalesce(m.salesperson[1], (select id from _luke)),
       'contacted', m.created_at
from _moved m
where m.existing_lead_id is null;

update public.leads l
set status       = case when l.status = 'new' then 'contacted' else l.status end,
    contact_name = coalesce(l.contact_name, nullif(btrim(m.contact_name), '')),
    phone        = coalesce(l.phone, nullif(btrim(m.phone), '')),
    branch_fit   = case when m.branch is null or m.branch = any (l.branch_fit) then l.branch_fit
                        else l.branch_fit || m.branch end,
    owner        = coalesce(l.owner, m.owner[1], (select id from _luke))
from _moved m
where l.id = m.existing_lead_id;

insert into public.lead_touches (lead_id, channel, direction, summary, touched_by, touched_at, event, details)
select coalesce(m.existing_lead_id, m.new_lead_id), 'other', 'outbound',
       concat_ws(E'\n', 'Moved from Projects (was at stage Leads).', nullif(btrim(m.notes), '')),
       coalesce(m.owner[1], (select id from _luke)), now(), 'note',
       jsonb_build_object('from_project', m.client_name, 'branch', m.branch, 'project_created_at', m.created_at)
from _moved m;

-- Decade: Not now, revisit in 6 months (a normal outcome, after the note).
insert into public.lead_touches (lead_id, channel, direction, outcome, summary, touched_by, touched_at)
select coalesce(m.existing_lead_id, m.new_lead_id), 'cold_call', 'inbound', 'not_now',
       'Just networking, connecting not interested in help right now',
       coalesce(m.owner[1], (select id from _luke)), now() + interval '1 second'
from _moved m
where lower(btrim(m.client_name)) = 'decade';

update public.leads l
set next_action = 'Revisit',
    next_action_at = ((((now() at time zone 'America/Chicago')::date + interval '6 months')::date) + time '09:00')
                     at time zone 'America/Chicago'
from _moved m
where lower(btrim(m.client_name)) = 'decade'
  and l.id = coalesce(m.existing_lead_id, m.new_lead_id);

delete from public.projects where id in (select id from _moved);

-- b) One lead per company -------------------------------------------------------
create temp table _p on commit drop as
select p.*, p.id::text as grp
from public.projects p
where p.lead_id is null
  and not exists (select 1 from public.leads l where l.project_id = p.id);

-- Matching keys per project.
create temp table _keys on commit drop as
select id, 'n:' || regexp_replace(lower(client_name), '[^a-z0-9]', '', 'g') as k
from _p where regexp_replace(lower(coalesce(client_name, '')), '[^a-z0-9]', '', 'g') <> ''
union
select id, 'd:' || d
from (select p.id, lower(split_part(btrim(e), '@', 2)) d
      from _p p, regexp_split_to_table(coalesce(p.email, ''), '[;,\s]+') e
      where e like '%@%') x
where d <> '' and d not in ('gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com',
                            'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'comcast.net', 'proton.me',
                            'protonmail.com')
union
select id, 'p:' || right(regexp_replace(phone, '\D', '', 'g'), 10)
from _p where length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) >= 10;

-- Connected components: repeat "take the smallest group id among projects
-- sharing a key" until nothing changes.
do $$
begin
  loop
    update _p set grp = s.g
    from (select k1.id, min(p2.grp) g
          from _keys k1 join _keys k2 on k2.k = k1.k join _p p2 on p2.id = k2.id
          group by k1.id) s
    where _p.id = s.id and s.g < _p.grp;
    exit when not found;
  end loop;
end;
$$;

create temp table _co on commit drop as
select g.grp,
       gen_random_uuid() as lead_id,
       (array_agg(p.client_name order by p.created_at))[1] as name,
       (array_agg(nullif(btrim(p.contact_name), '') order by p.created_at) filter (where nullif(btrim(p.contact_name), '') is not null))[1] as contact_name,
       (array_agg(btrim(split_part(p.email, ';', 1)) order by p.created_at) filter (where nullif(btrim(p.email), '') is not null))[1] as owner_email,
       (array_agg(btrim(p.phone) order by p.created_at) filter (where nullif(btrim(p.phone), '') is not null))[1] as owner_phone,
       array(select distinct b from unnest(array_agg(p.branch)) b where b is not null order by b) as branch_fit,
       (array_agg(p.source order by p.created_at) filter (where p.source is not null))[1] as source,
       (array_agg(p.salesperson[1] order by p.created_at) filter (where p.salesperson[1] is not null))[1] as salesperson,
       case when bool_or(p.stage in ('Signed', 'In Progress', 'Subscriber', 'Complete')) then 'converted'
            when bool_or(p.stage in ('Interested', 'Negotiation')) then 'interested'
            else 'not_interested' end as status,
       (array_agg(p.id order by case p.stage when 'In Progress' then 0 when 'Subscriber' then 0 when 'Signed' then 1
                                       when 'Negotiation' then 2 when 'Interested' then 3 when 'Complete' then 4 else 5 end,
                          p.updated_at desc))[1] as main_project,
       min(p.created_at) as created_at
from (select distinct grp from _p) g
join _p p on p.grp = g.grp
group by g.grp;

insert into public.leads
  (id, name, company, contact_name, owner_email, owner_phone, branch_fit, source, source_detail,
   owner, found_by, status, project_id, created_at)
select c.lead_id, c.name, c.name, c.contact_name, c.owner_email, c.owner_phone, c.branch_fit,
       case c.source when 'Referral' then 'referral' when 'Relationship' then 'personal_network' else 'manual' end,
       concat_ws(' · ', 'From projects',
                 case when c.source not in ('Referral', 'Relationship') then 'Project source: ' || c.source end),
       coalesce(c.salesperson, (select id from _luke)),
       coalesce(c.salesperson, (select id from _luke)),
       c.status, c.main_project, c.created_at
from _co c;

update public.projects p set lead_id = c.lead_id
from _p x join _co c on c.grp = x.grp
where p.id = x.id;

insert into public.lead_touches (lead_id, channel, direction, outcome, summary, touched_by, touched_at, event, details)
select c.lead_id, 'other', 'inbound', 'not_interested',
       'Project lost' || coalesce(' (' || p.branch || ')', '')
         || coalesce(': ' || nullif(btrim(p.lost_reason), ''), ', no reason recorded'),
       coalesce(c.salesperson, (select id from _luke)), p.updated_at, 'project_lost',
       jsonb_build_object('project_id', p.id, 'branch', p.branch, 'lost_reason', p.lost_reason)
from _co c join _p p on p.grp = c.grp
where c.status = 'not_interested';

-- c) Stages --------------------------------------------------------------------
alter table public.projects drop constraint projects_stage_check;
alter table public.projects add constraint projects_stage_check
  check (stage in ('Interested', 'Negotiation', 'Signed', 'In Progress', 'Subscriber', 'Complete', 'Lost'));
alter table public.projects alter column stage set default 'Interested';

-- d) log_meeting matching -------------------------------------------------------
alter table public.meeting_notes drop constraint meeting_notes_matched_by_check;
alter table public.meeting_notes add constraint meeting_notes_matched_by_check
  check (matched_by in ('lead_id', 'email', 'phone', 'title', 'contact', 'manual'));

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
  v_contact  text;
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
      where lower(btrim(email)) = any (v_emails) or lower(btrim(owner_email)) = any (v_emails)
      order by (source = 'lead_finder') desc, last_touch_at desc nulls last, created_at
      limit 1;
      if v_lead is not null then v_by := 'email'; end if;
    end if;

    -- 2. A phone number in the title: last 10 digits vs phone_digits.
    if v_lead is null and coalesce(p_title, '') <> '' then
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

    -- 3. The business name ("Business name, contact name"), whole words only.
    if v_lead is null and coalesce(btrim(p_title), '') <> '' then
      v_head := lower(btrim(split_part(p_title, ',', 1)));
      select id into v_lead
      from public.leads
      where company is not null and char_length(btrim(company)) >= 3
        and (lower(btrim(company)) = v_head
             or lower(p_title) ~ ('\m' || regexp_replace(lower(btrim(company)), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\M'))
      order by (lower(btrim(company)) = v_head) desc,
               char_length(btrim(company)) desc,
               (source = 'lead_finder') desc,
               last_touch_at desc nulls last
      limit 1;
      if v_lead is not null then v_by := 'title'; end if;
    end if;

    -- 4. The contact name after the last comma (business names can contain
    --    commas), without a trailing "(...)".
    if v_lead is null and position(',' in coalesce(p_title, '')) > 0 then
      v_contact := lower(btrim(regexp_replace(regexp_replace(p_title, '^.*,', ''), '\([^)]*\)\s*$', '')));
      if char_length(v_contact) >= 3 then
        select id into v_lead
        from public.leads
        where lower(btrim(contact_name)) = v_contact
        order by (project_id is not null) desc, last_touch_at desc nulls last, created_at
        limit 1;
        if v_lead is not null then v_by := 'contact'; end if;
      end if;
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

-- e) Re-match unmatched meetings ------------------------------------------------
do $$
declare
  m record;
begin
  for m in select * from public.meeting_notes where lead_id is null loop
    perform public.log_meeting(m.source_id, m.title, m.creator_email, m.started_at,
                               m.attendees, m.summary_md, m.source_url);
  end loop;
end;
$$;
