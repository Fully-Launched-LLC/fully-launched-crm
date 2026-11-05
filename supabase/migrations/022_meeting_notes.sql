-- 022: meeting notes (Granola) on Sales businesses.
--
-- meeting_notes: one row per meeting from an outside notes tool (Granola
-- first), written only through log_meeting() (service_role: the sync job)
-- and link_meeting() (Admin/Manager, from the History page). Team members
-- read everything; the app never inserts or updates directly.
--
-- Granola title convention: "Business name, contact name". The title match
-- tries the part before the first comma first.
--
-- A matched meeting becomes one lead_touches row (channel meeting, inbound,
-- outcome meeting_held, summary = first 300 characters of the notes,
-- touched_by = the team member whose email is the meeting's creator),
-- linked by lead_touches.meeting_note_id (unique: one touch per meeting).
-- The lead_touches trigger (017) then stamps last_touch_at and moves the
-- status to interested.
--
-- Applied with Supabase MCP apply_migration.

create table public.meeting_notes (
  id            uuid primary key default gen_random_uuid(),
  source        text not null default 'granola',
  source_id     text not null unique,   -- Granola meeting id
  source_url    text,
  title         text,
  started_at    timestamptz,
  creator_email text,
  attendees     jsonb not null default '[]'::jsonb,  -- [{name, email}] or ["email", ...]
  summary_md    text,
  lead_id       uuid references public.leads(id) on delete set null,
  matched_by    text
    constraint meeting_notes_matched_by_check
    check (matched_by in ('lead_id', 'email', 'title', 'manual')),
  created_at    timestamptz not null default now()
);

create index meeting_notes_lead_idx on public.meeting_notes (lead_id);
create index meeting_notes_unmatched_idx on public.meeting_notes (started_at desc) where lead_id is null;

alter table public.meeting_notes enable row level security;

create policy "team read" on public.meeting_notes
  for select to authenticated
  using (public.is_team_member());

-- Read only for the app; no insert/update/delete policies exist either.
revoke all on public.meeting_notes from anon;
revoke insert, update, delete, truncate, references, trigger on public.meeting_notes from authenticated;
grant select on public.meeting_notes to authenticated;

alter table public.lead_touches
  add column meeting_note_id uuid references public.meeting_notes(id) on delete set null;

create unique index lead_touches_meeting_note_key
  on public.lead_touches (meeting_note_id) where meeting_note_id is not null;

-- ---------------------------------------------------------------------------
-- Internal: the touch for a linked meeting, once. No execute grants; called
-- only from the two functions below (same owner).
create or replace function public.meeting_note_touch(p_note_id uuid, p_fallback_member uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n public.meeting_notes;
  v_member uuid;
begin
  select * into n from public.meeting_notes where id = p_note_id;
  if n.id is null or n.lead_id is null then
    return;
  end if;
  if exists (select 1 from public.lead_touches where meeting_note_id = n.id) then
    return;
  end if;
  select id into v_member
  from public.team_members
  where lower(btrim(email)) = lower(btrim(n.creator_email))
  limit 1;
  insert into public.lead_touches (lead_id, channel, direction, outcome, summary, touched_by, touched_at, meeting_note_id)
  values (n.lead_id, 'meeting', 'inbound', 'meeting_held',
          nullif(left(btrim(coalesce(n.summary_md, '')), 300), ''),
          coalesce(v_member, p_fallback_member),
          coalesce(n.started_at, now()),
          n.id);
end;
$$;

revoke all on function public.meeting_note_touch(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- log_meeting: the sync job's entry point (service_role only).
-- Upsert on source_id. Business: p_lead_id if given; else the link the row
-- already has (a manual link survives re-syncs); else an attendee email
-- (not @fullylaunched.com) matching leads.email; else the title: the part
-- before the first comma equal to leads.company, then the longest company
-- name contained in the title (company names under 3 characters ignored).
-- Sales sources win ties, then the most recently touched.
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
    -- Attendee emails, outside our own domain.
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

-- ---------------------------------------------------------------------------
-- link_meeting: Admin/Manager attach an unmatched meeting to a business
-- (History > Unmatched meetings). Logs the touch (creator, else the caller).
create or replace function public.link_meeting(p_meeting_id uuid, p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_or_manager() then
    raise exception 'Only an Admin or Manager can link meetings' using errcode = '42501';
  end if;
  if not exists (select 1 from public.leads where id = p_lead_id) then
    raise exception 'Business record not found' using errcode = 'P0002';
  end if;
  update public.meeting_notes
  set lead_id = p_lead_id, matched_by = 'manual'
  where id = p_meeting_id;
  if not found then
    raise exception 'Meeting not found' using errcode = 'P0002';
  end if;
  perform public.meeting_note_touch(p_meeting_id, public.current_team_member_id());
  return jsonb_build_object('meeting_note_id', p_meeting_id, 'lead_id', p_lead_id, 'matched_by', 'manual');
end;
$$;

revoke all on function public.link_meeting(uuid, uuid) from public, anon;
grant execute on function public.link_meeting(uuid, uuid) to authenticated;
