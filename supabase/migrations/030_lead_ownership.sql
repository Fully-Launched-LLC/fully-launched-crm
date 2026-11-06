-- 030: one salesperson per business (leads.owner).
--
-- a) lead_touches.event: timeline entries that aren't outreach
--    (note, reassigned, released, removed_from_pipeline, project_lost).
--    Event rows never stamp last_touch_at, never change status (except
--    where the function that writes them sets it), never auto-assign.
-- b) Auto-assign: the first team member to log outreach on an unassigned
--    business becomes its owner (touch trigger). Meetings (service role,
--    meeting_note_id set) and event rows don't assign.
-- c) RLS: inserting a touch needs the business to be unassigned, mine, or
--    me Admin/Manager. update_business_contact (020) and log_meeting
--    (022, service role) are unaffected.
-- d) leads.owner_since: when the current owner got it (trigger). The
--    60-day release clock is max(owner_since, owner's last outreach).
-- e) reassign_lead(lead, owner, reason): Admin/Manager, reason required,
--    logged on the timeline.
-- f) release_stale_leads(): daily (pg_cron 08:15 UTC). Owner logged no
--    outreach for 60 days -> unassigned + "Released after 60 days without
--    contact". Exempt: any project for it (projects.lead_id or
--    leads.project_id) that isn't Lost, status
--    not_interested / dead / converted, source personal_network (Luke's
--    personal network), a revisit / follow-up date still in the future.
--
-- Applied with Supabase MCP apply_migration.

-- 0) projects.lead_id: the company's business record. Several projects
--    (one per branch / deal) share one lead. leads.project_id stays as the
--    company's most recent project (older code paths read it).
alter table public.projects add column lead_id uuid references public.leads(id) on delete set null;
create index projects_lead_id_idx on public.projects (lead_id) where lead_id is not null;

-- a) event column ------------------------------------------------------------
alter table public.lead_touches add column event text
  constraint lead_touches_event_check
  check (event in ('note', 'reassigned', 'released', 'removed_from_pipeline', 'project_lost'));

-- d) owner_since -------------------------------------------------------------
alter table public.leads add column owner_since timestamptz;
update public.leads set owner_since = now() where owner is not null;

create or replace function public.leads_owner_since()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.owner_since := case when new.owner is null then null else coalesce(new.owner_since, now()) end;
  elsif new.owner is distinct from old.owner then
    new.owner_since := case when new.owner is null then null else now() end;
  end if;
  return new;
end;
$$;
revoke all on function public.leads_owner_since() from public, anon, authenticated;

create trigger leads_owner_since
  before insert or update of owner on public.leads
  for each row execute function public.leads_owner_since();

-- b) touch trigger: events skip, outreach auto-assigns ------------------------
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
  if new.event is not null then
    return new;
  end if;

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
      owner = case
        when owner is null and new.meeting_note_id is null and new.touched_by is not null then new.touched_by
        else owner
      end,
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

-- c) RLS ----------------------------------------------------------------------
drop policy "team insert as self" on public.lead_touches;
create policy "owner, unassigned or manager insert" on public.lead_touches
  for insert to authenticated
  with check (
    public.is_team_member()
    and touched_by = public.current_team_member_id()
    and event is null
    and exists (
      select 1 from public.leads l
      where l.id = lead_id
        and (l.owner is null or l.owner = public.current_team_member_id() or public.is_admin_or_manager())
    )
  );

-- e) reassign -----------------------------------------------------------------
create or replace function public.reassign_lead(p_lead_id uuid, p_owner uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old uuid;
begin
  if not public.is_admin_or_manager() then
    raise exception 'Only an Admin or Manager can reassign a business' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  if p_owner is not null and not exists (select 1 from public.team_members where id = p_owner) then
    raise exception 'Team member not found' using errcode = 'P0002';
  end if;

  select owner into v_old from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Business record not found' using errcode = 'P0002';
  end if;
  if v_old is not distinct from p_owner then
    return;
  end if;

  update public.leads set owner = p_owner where id = p_lead_id;

  insert into public.lead_touches (lead_id, channel, direction, summary, touched_by, event, details)
  values (p_lead_id, 'other', 'outbound', btrim(p_reason), public.current_team_member_id(), 'reassigned',
          jsonb_build_object('from', v_old, 'to', p_owner));
end;
$$;
revoke all on function public.reassign_lead(uuid, uuid, text) from public, anon;
grant execute on function public.reassign_lead(uuid, uuid, text) to authenticated;

-- f) release ------------------------------------------------------------------
create or replace function public.release_stale_leads()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with stale as (
    select l.id, l.owner
    from public.leads l
    where l.owner is not null
      and not exists (select 1 from public.projects p
                      where (p.lead_id = l.id or p.id = l.project_id) and p.stage <> 'Lost')
      and l.status not in ('not_interested', 'dead', 'converted')
      and l.source <> 'personal_network'
      and (l.next_action_at is null or l.next_action_at <= now())
      and greatest(
            coalesce(l.owner_since, l.created_at),
            coalesce((select max(t.touched_at) from public.lead_touches t
                      where t.lead_id = l.id and t.touched_by = l.owner and t.event is null),
                     '-infinity'::timestamptz)
          ) < now() - interval '60 days'
    for update of l
  ),
  released as (
    update public.leads l set owner = null
    from stale s where l.id = s.id
    returning s.id, s.owner
  )
  insert into public.lead_touches (lead_id, channel, direction, summary, touched_by, event, details)
  select id, 'other', 'outbound', 'Released after 60 days without contact', null, 'released',
         jsonb_build_object('from', owner)
  from released;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.release_stale_leads() from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('crm-release-stale-leads', '15 8 * * *', 'select public.release_stale_leads()');

-- Data: legacy outreach with no owner -> Luke (matched on email, like 017).
update public.leads
set owner = (select id from public.team_members where lower(email) = 'luke@fullylaunched.com')
where owner is null
  and source in ('personal_network', 'etsy', 'manual', 'referral', 'csv_import');
