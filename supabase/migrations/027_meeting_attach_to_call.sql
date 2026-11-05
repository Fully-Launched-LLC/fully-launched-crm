-- 027: no duplicate timeline entries when Granola and a manual log cover
-- the same call. meeting_note_touch() (022; used by log_meeting and
-- link_meeting): if the business already has a cold_call / meeting touch
-- within 3 hours of the meeting's start (closest first) that isn't tied to
-- another meeting, the meeting attaches to it (meeting_note_id set; its
-- summary filled with the first 300 characters of the notes if empty)
-- instead of adding a "Meeting held" touch. Attaching is an update, so the
-- insert trigger doesn't run and the status stays as the call left it.
-- Otherwise unchanged from 022.
--
-- One-off data fix run alongside (not part of this file): Dutchman Heating
-- (lead 1475fffe-...): standalone meeting touch 143c747c deleted, meeting
-- 7a216d93 attached to the Not available call c384cd47.
--
-- Applied with Supabase MCP apply_migration.

create or replace function public.meeting_note_touch(p_note_id uuid, p_fallback_member uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n public.meeting_notes;
  v_member uuid;
  v_at timestamptz;
  v_touch uuid;
begin
  select * into n from public.meeting_notes where id = p_note_id;
  if n.id is null or n.lead_id is null then
    return;
  end if;
  if exists (select 1 from public.lead_touches where meeting_note_id = n.id) then
    return;
  end if;
  v_at := coalesce(n.started_at, now());

  select id into v_touch
  from public.lead_touches
  where lead_id = n.lead_id
    and channel in ('cold_call', 'meeting')
    and meeting_note_id is null
    and touched_at between v_at - interval '3 hours' and v_at + interval '3 hours'
  order by abs(extract(epoch from (touched_at - v_at)))
  limit 1;

  if v_touch is not null then
    update public.lead_touches
    set meeting_note_id = n.id,
        summary = coalesce(nullif(btrim(summary), ''), nullif(left(btrim(coalesce(n.summary_md, '')), 300), ''))
    where id = v_touch;
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
          v_at,
          n.id);
end;
$$;

revoke all on function public.meeting_note_touch(uuid, uuid) from public, anon, authenticated;
