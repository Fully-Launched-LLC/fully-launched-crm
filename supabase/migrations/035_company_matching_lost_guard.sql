-- 035: split Air-Rite from Comfort X Design; company matching rule for new
-- projects; a phone match only suggests; Lost only through Remove from
-- pipeline (or an Admin).
--
-- a) Data: 032 grouped the three Air-Rite projects with Comfort X Design
--    because they share a phone number (630-308-0100). New company record
--    "Air-Rite Heating & Cooling" (contact Shelley Falconer, saf@air-rite.com,
--    owner Luke: none of the three has a salesperson; status interested;
--    source referral, from Air-Rite PO Reader) and the three projects
--    (Air-Rite PO Reader, Air-Rite Sales Ordering App, Air-Rite + Comfort X
--    Design Ordering App) point to it. Comfort X Design keeps its Complete
--    and Subscriber projects; nothing else on it changes (no touches or
--    meetings to move).
-- b) Company matching (company_key, email_domains, find_company_lead): same
--    normalized company name (lowercase, letters and digits only, a trailing
--    "(...)" dropped), or the same email domain, ignoring free mail (gmail,
--    yahoo, outlook, ...). A phone number alone never merges.
-- c) New projects: when a project has a real name and no lead_id (insert, or
--    client_name / email set later), it joins the matching company record,
--    else a new one is created (owner = first salesperson, else the creator,
--    else Luke). "New Project" placeholders are skipped until renamed.
-- d) company_phone_suggestions(project): other company records with the same
--    phone (last 10 digits, business or owner phone). Shown on the project
--    page as a suggestion; link_project_to_company(project, lead) links it
--    (any team member) and removes the old record when it was an empty
--    auto-created one (no touches, no other projects). "Not the same
--    company" is stored in project_link_dismissals (project_id, lead_id,
--    dismissed_by, created_at; unique pair; team read / insert as self), and
--    a dismissed pair is never suggested again.
-- e) Lost guard: a project moves to Lost only through remove_from_pipeline()
--    (reason, note, revisit) or by an Admin (the "Set Lost without a reason"
--    option on the project page). Anyone else's direct update is refused.
--
-- Applied with Supabase MCP apply_migration.

-- a) Split Air-Rite ----------------------------------------------------------------
with new_lead as (
  insert into public.leads
    (name, company, contact_name, owner_email, owner_phone, branch_fit, source, source_detail,
     owner, found_by, status, project_id, created_at)
  select 'Air-Rite Heating & Cooling', 'Air-Rite Heating & Cooling', 'Shelley Falconer', 'saf@air-rite.com',
         '630-308-0100', array['AI'], 'referral', 'From projects (split from Comfort X Design)',
         (select id from public.team_members where lower(email) = 'luke@fullylaunched.com'),
         (select id from public.team_members where lower(email) = 'luke@fullylaunched.com'),
         'interested',
         '0f227bd3-a0b0-4d47-85a8-d4db1b46864d', -- Air-Rite Sales Ordering App (newest Interested)
         (select min(created_at) from public.projects
          where id in ('2d0cc261-ddba-4a10-ab77-d8ed9c8afcee', '0f227bd3-a0b0-4d47-85a8-d4db1b46864d',
                       '8e38d147-6140-4cb2-b778-8b68222e7365'))
  returning id
)
update public.projects p
set lead_id = (select id from new_lead)
where p.id in ('2d0cc261-ddba-4a10-ab77-d8ed9c8afcee',  -- Air-Rite PO Reader
               '0f227bd3-a0b0-4d47-85a8-d4db1b46864d',  -- Air-Rite Sales Ordering App
               '8e38d147-6140-4cb2-b778-8b68222e7365'); -- Air-Rite + Comfort X Design Ordering App

-- b) Matching helpers ----------------------------------------------------------------
create or replace function public.company_key(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(regexp_replace(lower(regexp_replace(coalesce(p_name, ''), '\s*\([^)]*\)\s*$', '')), '[^a-z0-9]', '', 'g'), '');
$$;

create or replace function public.email_domains(p_emails text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array_agg(distinct d), '{}')
  from (select lower(split_part(btrim(e), '@', 2)) d
        from regexp_split_to_table(coalesce(p_emails, ''), '[;,\s]+') e
        where e like '%@%') x
  where d <> ''
    and d not in ('gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com', 'live.com',
                  'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'comcast.net', 'proton.me',
                  'protonmail.com', 'att.net', 'sbcglobal.net', 'verizon.net');
$$;

-- The company record for a name / email, or null. Records that already have
-- projects win, then the oldest.
create or replace function public.find_company_lead(p_name text, p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select l.id
  from public.leads l
  where (public.company_key(p_name) is not null
         and (public.company_key(l.company) = public.company_key(p_name)
              or public.company_key(l.name) = public.company_key(p_name)))
     or (cardinality(public.email_domains(p_email)) > 0
         and (l.domain = any (public.email_domains(p_email))
              or public.email_domains(l.email) && public.email_domains(p_email)
              or public.email_domains(l.owner_email) && public.email_domains(p_email)))
  order by exists (select 1 from public.projects p where p.lead_id = l.id) desc, l.created_at
  limit 1;
$$;
revoke all on function public.find_company_lead(text, text) from public, anon, authenticated;

-- c) New projects join a company -------------------------------------------------------
create or replace function public.projects_link_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead uuid;
  v_me   uuid := public.current_team_member_id();
  v_who  uuid;
begin
  if new.lead_id is not null
     or public.company_key(new.client_name) is null
     or public.company_key(new.client_name) = 'newproject' then
    return null;
  end if;

  v_lead := public.find_company_lead(new.client_name, new.email);

  if v_lead is null then
    v_who := coalesce(new.salesperson[1], v_me,
                      (select id from public.team_members where lower(email) = 'luke@fullylaunched.com'));
    insert into public.leads
      (name, company, contact_name, owner_email, owner_phone, branch_fit, source, source_detail,
       owner, found_by, status, project_id, created_at)
    values
      (new.client_name, new.client_name, nullif(btrim(new.contact_name), ''),
       nullif(btrim(split_part(coalesce(new.email, ''), ';', 1)), ''), nullif(btrim(new.phone), ''),
       case when new.branch is null then '{}'::text[] else array[new.branch] end,
       case new.source when 'Referral' then 'referral' when 'Relationship' then 'personal_network' else 'manual' end,
       'From projects',
       v_who, v_who,
       case when new.stage = 'Lost' then 'not_interested'
            when new.stage in ('Signed', 'In Progress', 'Subscriber', 'Complete') then 'converted'
            else 'interested' end,
       case when new.stage <> 'Lost' then new.id end,
       now())
    returning id into v_lead;
  else
    update public.leads
    set branch_fit = case when new.branch is null or new.branch = any (branch_fit) then branch_fit
                          else branch_fit || new.branch end,
        project_id = coalesce(project_id, case when new.stage <> 'Lost' then new.id end)
    where id = v_lead;
  end if;

  update public.projects set lead_id = v_lead where id = new.id;
  return null;
end;
$$;
revoke all on function public.projects_link_company() from public, anon, authenticated;

create trigger projects_link_company
  after insert or update of client_name, email on public.projects
  for each row
  when (new.lead_id is null)
  execute function public.projects_link_company();

-- d) Phone match: suggest only -----------------------------------------------------------
create table public.project_link_dismissals (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  lead_id      uuid not null references public.leads(id) on delete cascade,
  dismissed_by uuid references public.team_members(id) on delete set null default public.current_team_member_id(),
  created_at   timestamptz not null default now(),
  constraint project_link_dismissals_pair_key unique (project_id, lead_id)
);
create index project_link_dismissals_lead_idx on public.project_link_dismissals (lead_id);
alter table public.project_link_dismissals enable row level security;
create policy "team read" on public.project_link_dismissals
  for select to authenticated
  using (public.is_team_member());
create policy "team insert as self" on public.project_link_dismissals
  for insert to authenticated
  with check (public.is_team_member() and dismissed_by = public.current_team_member_id());
revoke all on public.project_link_dismissals from anon;
revoke truncate, references, trigger, update, delete on public.project_link_dismissals from authenticated;

create or replace function public.company_phone_suggestions(p_project_id uuid)
returns table (lead_id uuid, company text)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, coalesce(l.company, l.name)
  from public.projects p
  join public.leads l
    on right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10) in
       (right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 10),
        right(regexp_replace(coalesce(l.owner_phone, ''), '\D', '', 'g'), 10))
  where p.id = p_project_id
    and public.is_team_member()
    and length(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')) >= 10
    and l.id is distinct from p.lead_id
    and not exists (select 1 from public.project_link_dismissals d
                    where d.project_id = p.id and d.lead_id = l.id)
  order by l.created_at
  limit 5;
$$;
revoke all on function public.company_phone_suggestions(uuid) from public, anon;
grant execute on function public.company_phone_suggestions(uuid) to authenticated;

create or replace function public.link_project_to_company(p_project_id uuid, p_lead_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old uuid;
  p     public.projects;
begin
  if not public.is_team_member() then
    raise exception 'Not a team member' using errcode = '42501';
  end if;
  select * into p from public.projects where id = p_project_id for update;
  if not found then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.leads where id = p_lead_id) then
    raise exception 'Business record not found' using errcode = 'P0002';
  end if;
  v_old := p.lead_id;

  update public.projects set lead_id = p_lead_id where id = p.id;
  update public.leads
  set branch_fit = case when p.branch is null or p.branch = any (branch_fit) then branch_fit else branch_fit || p.branch end,
      project_id = coalesce(project_id, case when p.stage <> 'Lost' then p.id end)
  where id = p_lead_id;

  -- The old record was an empty auto-created one: remove it.
  if v_old is not null and v_old <> p_lead_id then
    update public.leads set project_id = null where id = v_old and project_id = p.id;
    delete from public.leads l
    where l.id = v_old
      and l.source_detail like 'From projects%'
      and not exists (select 1 from public.projects x where x.lead_id = l.id)
      and not exists (select 1 from public.lead_touches t where t.lead_id = l.id)
      and not exists (select 1 from public.meeting_notes m where m.lead_id = l.id);
  end if;
end;
$$;
revoke all on function public.link_project_to_company(uuid, uuid) from public, anon;
grant execute on function public.link_project_to_company(uuid, uuid) to authenticated;

-- e) Lost guard ------------------------------------------------------------------------
create or replace function public.projects_guard_lost()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.stage = 'Lost' and old.stage is distinct from 'Lost'
     and coalesce(current_setting('crm.removing_from_pipeline', true), '') <> 'on'
     and not public.is_admin()
     and auth.uid() is not null then  -- migrations / service role pass
    raise exception 'Use Remove from pipeline to move a project to Lost (reason and note)'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.projects_guard_lost() from public, anon, authenticated;

create trigger projects_guard_lost
  before update of stage on public.projects
  for each row execute function public.projects_guard_lost();

-- remove_from_pipeline (034) marks its own update so the guard lets it through.
create or replace function public.remove_from_pipeline(
  p_project_id uuid,
  p_reason     text,
  p_note       text default null,
  p_revisit    date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p        public.projects;
  v_me     uuid := public.current_team_member_id();
  v_lead   uuid;
  v_active uuid;
  v_not_now boolean;
  v_revisit date;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_team_member() then
    raise exception 'Not a team member' using errcode = '42501';
  end if;
  if p_reason not in ('Not interested', 'Just networking', 'Timing / not now', 'Budget',
                      'Went with someone else', 'Other') then
    raise exception 'Unknown reason' using errcode = '22023';
  end if;
  if p_reason = 'Other' and v_note is null then
    raise exception 'Add a note for Other' using errcode = '22023';
  end if;

  select * into p from public.projects where id = p_project_id for update;
  if not found then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  if p.stage = 'Lost' then
    raise exception 'This project is already out of the pipeline' using errcode = '22023';
  end if;

  v_not_now := p_reason in ('Timing / not now', 'Just networking');
  v_revisit := case when v_not_now
                 then coalesce(p_revisit, ((now() at time zone 'America/Chicago')::date + interval '6 months')::date)
               end;

  perform set_config('crm.removing_from_pipeline', 'on', true);
  update public.projects
  set stage = 'Lost',
      lost_reason = concat_ws(': ', p_reason, v_note)
  where id = p.id;
  perform set_config('crm.removing_from_pipeline', '', true);

  v_lead := p.lead_id;
  if v_lead is null then
    select id into v_lead from public.leads where project_id = p.id order by created_at limit 1;
  end if;
  if v_lead is null then
    insert into public.leads
      (name, company, contact_name, owner_email, owner_phone, branch_fit, source, source_detail,
       owner, found_by, created_at)
    values
      (p.client_name, p.client_name, nullif(btrim(p.contact_name), ''), nullif(btrim(p.email), ''),
       nullif(btrim(p.phone), ''),
       case when p.branch is null then '{}'::text[] else array[p.branch] end,
       case p.source when 'Referral' then 'referral' when 'Relationship' then 'personal_network' else 'manual' end,
       'From projects',
       coalesce(p.salesperson[1], v_me), coalesce(p.salesperson[1], v_me), p.created_at)
    returning id into v_lead;
  end if;
  update public.projects set lead_id = v_lead where id = p.id and lead_id is null;

  select id into v_active
  from public.projects
  where lead_id = v_lead and id <> p.id and stage <> 'Lost'
  order by updated_at desc
  limit 1;

  if v_active is null then
    update public.leads
    set status = case when v_not_now then 'contacted' else 'not_interested' end,
        project_id = null,
        next_action = case when v_not_now then 'Revisit' end,
        next_action_at = case when v_not_now
                           then (v_revisit + time '09:00') at time zone 'America/Chicago' end
    where id = v_lead;
  else
    update public.leads set project_id = v_active
    where id = v_lead and (project_id = p.id or project_id is null);
  end if;

  insert into public.lead_touches (lead_id, channel, direction, outcome, summary, touched_by, event, details)
  values (v_lead, 'other', 'inbound',
          case when v_active is not null then null when v_not_now then 'not_now' else 'not_interested' end,
          v_note, v_me, 'removed_from_pipeline',
          jsonb_build_object('reason', p_reason, 'note', v_note, 'project_id', p.id,
                             'project_name', p.client_name, 'branch', p.branch, 'revisit', v_revisit));

  return jsonb_build_object('lead_id', v_lead, 'revisit', v_revisit);
end;
$$;
revoke all on function public.remove_from_pipeline(uuid, text, text, date) from public, anon;
grant execute on function public.remove_from_pipeline(uuid, text, text, date) to authenticated;
