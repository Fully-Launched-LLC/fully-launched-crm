-- Deal Desk simplification (Nov 9): no reporting / support terms in the SOW,
-- no management hours in deal labor, no productized-tool / tool-builder share.
-- The functions that read these columns are replaced first (SQL function
-- bodies aren't dependency-tracked, so a drop alone would break them later).

-- Content snapshot that resets an approved deal: reporting / support gone.
create or replace function public.deal_content(d public.deals)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_array(d.id, d.project_id, d.lead_id, d.valid_through,
    d.target_start, d.target_launch,
    d.production_notice_days, d.production_setups, d.production_cancel_hours);
$$;

-- Same as 036 except the internal-fields block: owner and est. project hours only.
create or replace function public.deals_before_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user  boolean := auth.uid() is not null;
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_content_changed boolean := public.deal_content(new) is distinct from public.deal_content(old);
begin
  if old.status = 'void' then
    if (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then
      return new;
    end if;
    raise exception 'This deal is void and can no longer be changed' using errcode = '42501';
  end if;

  new.updated_at := now();

  -- Explicit reset: the trigger does the cleanup, for users and the service role.
  if new.status = 'draft' and old.status in ('approved', 'sent', 'viewed') and not v_content_changed then
    new.approved_by := null;
    new.approved_at := null;
    new.sent_at := null;
    new.viewed_at := null;
    update public.deal_signatures set revoked_at = now()
    where deal_id = old.id and signed_at is null and revoked_at is null;
    insert into public.deal_events (deal_id, kind, actor, details)
    values (old.id, 'reset_to_draft', public.current_team_member_id(),
            jsonb_build_object('cause', coalesce(nullif(current_setting('crm.deal_reset_cause', true), ''), 'manual')));
    return new;
  end if;

  if not v_user then
    return new;
  end if;

  if old.status in ('signed', 'countersigned') then
    if new.status = 'void' and public.is_admin() and not v_content_changed then
      return new;
    end if;
    raise exception 'This deal is signed and can no longer be changed' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if new.status in ('viewed', 'signed', 'countersigned') then
      raise exception 'Status % is set by the signing page', new.status using errcode = '42501';
    end if;
    if new.status in ('approved', 'void') and not public.is_admin_or_manager() then
      raise exception 'Only an Admin or Manager can % a deal',
        case new.status when 'void' then 'void' else 'approve' end
        using errcode = '42501';
    end if;
  end if;

  if new.approved_by is not null and new.approved_by is distinct from old.approved_by
     and not public.is_admin_or_manager() then
    raise exception 'Only an Admin or Manager can approve a deal' using errcode = '42501';
  end if;

  -- Internal-only fields on an approved / sent / viewed deal: logged, no reset.
  if old.status in ('approved', 'sent', 'viewed')
     and (new.owner_id, new.est_project_hours) is distinct from (old.owner_id, old.est_project_hours) then
    insert into public.deal_events (deal_id, kind, actor, details)
    values (old.id, 'internal_fields_changed', public.current_team_member_id(),
            jsonb_build_object(
              'owner_id', jsonb_build_array(old.owner_id, new.owner_id),
              'est_project_hours', jsonb_build_array(old.est_project_hours, new.est_project_hours)));
  end if;

  -- Content edits after approval: back to draft.
  if v_content_changed and old.status in ('approved', 'sent', 'viewed') then
    new.status := 'draft';
    new.approved_by := null;
    new.approved_at := null;
    new.sent_at := null;
    new.viewed_at := null;
    update public.deal_signatures set revoked_at = now()
    where deal_id = old.id and signed_at is null and revoked_at is null;
    insert into public.deal_events (deal_id, kind, actor, details)
    values (old.id, 'reset_to_draft', public.current_team_member_id(), jsonb_build_object('cause', 'deal fields'));
    return new;
  end if;

  -- Every approval: fresh dates.
  if new.status = 'approved' and old.status is distinct from 'approved' then
    new.date_issued := v_today;
    new.valid_through := greatest(coalesce(new.valid_through, v_today), v_today + 14);
  end if;

  -- Sending or regenerating the link.
  if new.status = 'sent'
     and (old.status is distinct from 'sent' or new.sent_at is distinct from old.sent_at) then
    if old.status not in ('approved', 'sent', 'viewed') then
      raise exception 'Approve the deal before sending it' using errcode = '22023';
    end if;
    if new.valid_through < v_today then
      raise exception 'This deal expired on % (valid through). Approve it again to refresh the dates', new.valid_through
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$function$;

alter table public.deals
  drop column reporting_cadence,
  drop column reporting_metrics,
  drop column support_response,
  drop column est_management_hours,
  drop column tool_builder_id;
alter table public.deal_line_items drop column is_productized_tool;
alter table public.deal_settings drop column tool_builder_pct;
