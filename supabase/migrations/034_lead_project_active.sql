-- 034: leads.project_id = the company's active project (any stage but
-- Lost), else null. Code that reads it (Move to Interested state, result
-- dimming, "already a client" confirm, Open project) then treats a company
-- whose projects are all Lost as back in History, not a client.
-- projects.lead_id (030) keeps every project, Lost included, linked.
--
-- Data: companies whose projects are all Lost (from 032: Evercoat, SALT)
-- get project_id null.
-- remove_from_pipeline (033): when no other project is active, the lead's
-- project_id is cleared; otherwise it moves to the other active project.
--
-- Applied with Supabase MCP apply_migration.

update public.leads l
set project_id = null
where l.project_id is not null
  and exists (select 1 from public.projects p where p.id = l.project_id and p.stage = 'Lost')
  and not exists (select 1 from public.projects p where p.lead_id = l.id and p.stage <> 'Lost');

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

  update public.projects
  set stage = 'Lost',
      lost_reason = concat_ws(': ', p_reason, v_note)
  where id = p.id;

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
