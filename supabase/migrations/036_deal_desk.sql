-- 036: Deal Desk. Deals (one per project), line items, versioned Proposal /
-- SOW / Internal documents backed by Google Docs (frozen to PDF at
-- approval), click-to-sign signatures, project links (Drive folder, docs,
-- PDFs, manual links), deal settings, deal activity, a sign-route rate limit
-- and a private storage bucket for signed PDFs.
--
-- Fixed legal text is NOT in the database: the CRM Master SOW Google Doc is
-- its single source (written once by scripts/build-doc-templates.ts, then
-- edited in Google Docs). deal_documents.template_doc_id /
-- template_modified_at record which master revision a version came from.
--
-- Conventions (match the rest of the schema): text + check constraints for
-- the enum-like columns, team member columns reference team_members(id),
-- role checks use is_team_member() / is_admin() / is_admin_or_manager().
--
-- Who writes what:
--   deals, deal_line_items, deal_documents, project_links: any team member
--     (RLS), with the triggers below guarding approval, status changes and
--     signed deals. Approval needs Admin/Manager.
--   deal_signatures, the storage bucket and deal_rate_limits: server routes
--     with the service role only. Sign / countersign also write deal_events
--     and a lead_touches event row with the service role.
--   deal_settings: Admin/Manager.
-- No anon access to anything here.
--
-- Applied with Supabase MCP apply_migration.

-- ---------------------------------------------------------------------------
-- deals
-- ---------------------------------------------------------------------------
create table public.deals (
  id                      uuid primary key default gen_random_uuid(),
  project_id              uuid not null references public.projects(id) on delete restrict,
  lead_id                 uuid references public.leads(id) on delete set null,
  owner_id                uuid references public.team_members(id) on delete set null,
  status                  text not null default 'draft'
                            check (status in ('draft', 'approved', 'sent', 'viewed', 'signed', 'countersigned', 'void')),
  date_issued             date not null default ((now() at time zone 'America/Chicago')::date),
  valid_through           date,
  target_start            date,
  target_launch           date,
  reporting_cadence       text not null default 'monthly',
  reporting_metrics       text,
  support_response        text not null default 'Same-day',
  production_notice_days  int check (production_notice_days is null or production_notice_days >= 0),
  production_setups       text,
  production_cancel_hours int default 48 check (production_cancel_hours is null or production_cancel_hours >= 0),
  est_management_hours    numeric check (est_management_hours is null or est_management_hours >= 0),
  est_project_hours       numeric check (est_project_hours is null or est_project_hours >= 0),
  tool_builder_id         uuid references public.team_members(id) on delete set null,
  drive_folder_id         text,
  drive_folder_url        text,
  approved_by             uuid references public.team_members(id) on delete set null,
  approved_at             timestamptz,
  sent_at                 timestamptz,
  viewed_at               timestamptz,
  signed_at               timestamptz,
  created_by              uuid references public.team_members(id) on delete set null
                            default public.current_team_member_id(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
-- One live deal per project (void ones are kept for the record).
create unique index deals_one_open_per_project on public.deals (project_id) where status <> 'void';
create index deals_lead_id_idx on public.deals (lead_id);

-- ---------------------------------------------------------------------------
-- deal_line_items
-- ---------------------------------------------------------------------------
create table public.deal_line_items (
  id                  uuid primary key default gen_random_uuid(),
  deal_id             uuid not null references public.deals(id) on delete cascade,
  branch              text not null check (branch in ('website', 'social', 'ai_tool', 'marketplace', 'other')),
  label               text not null,
  description         text,
  tier_name           text,
  kind                text not null check (kind in ('one_time', 'monthly', 'hourly')),
  amount              numeric(10,2) not null check (amount >= 0),
  hours_included      numeric check (hours_included is null or hours_included >= 0),
  overage_rate        numeric(10,2) check (overage_rate is null or overage_rate >= 0),
  selected_by_default boolean not null default true,
  optional            boolean not null default false,
  is_productized_tool boolean not null default false,
  sort_order          int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index deal_line_items_deal_idx on public.deal_line_items (deal_id, branch, sort_order);

-- ---------------------------------------------------------------------------
-- deal_documents: every generation, manual edit or restore is a new version
-- with its own Google Doc. generated_by = the team member who clicked;
-- source says how it was made ('claude', 'manual', 'restore', 'computed' for
-- the internal snapshot). content_json = the AI output (no prices).
-- At approval the doc is frozen: exported to PDF (frozen_pdf_path in
-- deal-docs, drive_file_id_pdf in Drive), hashed (content_hash), and the
-- Doc's Drive modifiedTime recorded (drive_modified_at_approval) so a later
-- edit in Google Docs can be detected.
-- ---------------------------------------------------------------------------
create table public.deal_documents (
  id                         uuid primary key default gen_random_uuid(),
  deal_id                    uuid not null references public.deals(id) on delete cascade,
  kind                       text not null check (kind in ('proposal', 'sow', 'internal')),
  version                    int not null check (version >= 1),
  content_json               jsonb not null default '{}'::jsonb,
  content_hash               text,
  google_doc_id              text,
  google_doc_url             text,
  template_doc_id            text,
  template_modified_at       timestamptz,
  frozen_pdf_path            text,
  frozen_at                  timestamptz,
  drive_modified_at_approval timestamptz,
  drive_file_id_pdf          text,
  source                     text not null default 'manual'
                               check (source in ('claude', 'manual', 'restore', 'computed')),
  generated_by               uuid references public.team_members(id) on delete set null
                               default public.current_team_member_id(),
  model                      text,
  section_flags              jsonb not null default '{}'::jsonb,
  approved_by                uuid references public.team_members(id) on delete set null,
  approved_at                timestamptz,
  created_at                 timestamptz not null default now(),
  unique (deal_id, kind, version)
);

-- ---------------------------------------------------------------------------
-- deal_signatures: one row per signing link. Only the sha256 of the token is
-- stored. Written by server routes (service role) only.
-- ---------------------------------------------------------------------------
create table public.deal_signatures (
  id                     uuid primary key default gen_random_uuid(),
  deal_id                uuid not null references public.deals(id) on delete cascade,
  document_id            uuid references public.deal_documents(id) on delete restrict,
  proposal_document_id   uuid references public.deal_documents(id) on delete restrict,
  token_hash             text not null unique,
  expires_at             timestamptz not null,
  revoked_at             timestamptz,
  viewed_at              timestamptz,
  signer_name            text,
  signer_title           text,
  signer_email           text,
  typed_signature        text,
  consent                boolean,
  consent_text           text,
  selections             jsonb,
  content_hash           text,
  signed_at              timestamptz,
  ip                     text,
  user_agent             text,
  pdf_path               text,
  fl_countersigned_by    uuid references public.team_members(id) on delete set null,
  fl_countersigner_name  text,
  fl_countersigner_title text,
  fl_countersigned_at    timestamptz,
  final_pdf_path         text,
  created_by             uuid references public.team_members(id) on delete set null,
  created_at             timestamptz not null default now()
);
create index deal_signatures_deal_idx on public.deal_signatures (deal_id, created_at desc);

-- ---------------------------------------------------------------------------
-- project_links: the project's Drive folder, generated Docs, PDFs, and links
-- people add by hand. source 'system' rows are written by the Deal Desk;
-- only kind 'other' + source 'manual' rows can be deleted.
-- ---------------------------------------------------------------------------
create table public.project_links (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  deal_id       uuid references public.deals(id) on delete set null,
  document_id   uuid references public.deal_documents(id) on delete set null,
  kind          text not null check (kind in ('drive_folder', 'proposal_doc', 'sow_doc', 'proposal_pdf',
                                              'sow_pdf', 'signed_pdf', 'final_pdf', 'internal_doc', 'other')),
  label         text not null,
  url           text not null,
  drive_file_id text,
  source        text not null default 'manual' check (source in ('manual', 'system')),
  created_by    uuid references public.team_members(id) on delete set null
                  default public.current_team_member_id(),
  created_at    timestamptz not null default now()
);
create index project_links_project_idx on public.project_links (project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- deal_settings: one row (no payout config table exists yet; Phase 2's
-- payout_rates can read from or replace this).
-- ---------------------------------------------------------------------------
create table public.deal_settings (
  id                     boolean primary key default true check (id),
  project_hourly_rate    numeric check (project_hourly_rate is null or project_hourly_rate >= 0),
  management_hourly_rate numeric not null default 50 check (management_hourly_rate >= 0),
  commission_pct         numeric not null default 10 check (commission_pct between 0 and 100),
  earn_up_pct            numeric not null default 20 check (earn_up_pct between 0 and 100),
  earn_up_ends           date not null default '2027-12-31',
  tool_builder_pct       numeric not null default 15 check (tool_builder_pct between 0 and 100),
  default_overage_rate   numeric not null default 100 check (default_overage_rate >= 0),
  updated_by             uuid references public.team_members(id) on delete set null,
  updated_at             timestamptz not null default now()
);
insert into public.deal_settings (id) values (true);

-- ---------------------------------------------------------------------------
-- deal_events: the deal's activity log (created, generated, edited,
-- restored, approved, sent, link_regenerated, viewed, signed, countersigned,
-- reset_to_draft, void).
-- ---------------------------------------------------------------------------
create table public.deal_events (
  id         uuid primary key default gen_random_uuid(),
  deal_id    uuid not null references public.deals(id) on delete cascade,
  kind       text not null,
  actor      uuid references public.team_members(id) on delete set null,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index deal_events_deal_idx on public.deal_events (deal_id, created_at desc);

-- lead_touches: deal_signed / deal_countersigned timeline events on the
-- company's business record (inserted by the sign / countersign routes with
-- the service role; the 030 RLS still refuses events from app users).
alter table public.lead_touches drop constraint lead_touches_event_check;
alter table public.lead_touches add constraint lead_touches_event_check
  check (event in ('note', 'reassigned', 'released', 'removed_from_pipeline', 'project_lost',
                   'deal_signed', 'deal_countersigned'));

-- ---------------------------------------------------------------------------
-- deal_rate_limits: per-IP counters for the public sign routes (service
-- role). Each call also deletes windows older than 24 hours (no pg_cron).
-- ---------------------------------------------------------------------------
create table public.deal_rate_limits (
  key          text not null,
  window_start timestamptz not null,
  hits         int not null default 0,
  primary key (key, window_start)
);

create or replace function public.deal_rate_hit(p_key text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits  int;
begin
  delete from public.deal_rate_limits where window_start < now() - interval '24 hours';
  insert into public.deal_rate_limits (key, window_start, hits)
  values (p_key, v_start, 1)
  on conflict (key, window_start) do update set hits = deal_rate_limits.hits + 1
  returning hits into v_hits;
  return v_hits <= p_limit;
end;
$$;
revoke all on function public.deal_rate_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.deal_rate_hit(text, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Insert defaults: lead from the project, owner from the lead's owner (else
-- the project's first salesperson), valid_through = date_issued + 14.
create or replace function public.deals_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project public.projects;
begin
  select * into v_project from public.projects where id = new.project_id;
  new.lead_id := coalesce(new.lead_id, v_project.lead_id);
  if new.owner_id is null then
    select owner into new.owner_id from public.leads where id = new.lead_id;
    new.owner_id := coalesce(new.owner_id, v_project.salesperson[1]);
  end if;
  new.valid_through := coalesce(new.valid_through, new.date_issued + 14);
  if auth.uid() is not null and new.status <> 'draft' then
    raise exception 'A new deal starts as a draft' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger deals_before_insert before insert on public.deals
  for each row execute function public.deals_before_insert();

-- Content columns: changing any of them after approval sends the deal back
-- to draft and revokes unsigned signing links. Everything else is excluded:
-- status, approved_by/at, sent_at, viewed_at, signed_at, updated_at,
-- created_at, created_by, date_issued (set by every approval), the Drive
-- folder columns, and the internal-only fields owner_id,
-- est_management_hours, est_project_hours, tool_builder_id (they only feed
-- the internal doc, computed live; changes are logged, see below).
-- valid_through IS content: a manual change resets approval.
create or replace function public.deal_content(d public.deals)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_array(d.id, d.project_id, d.lead_id, d.valid_through,
    d.target_start, d.target_launch, d.reporting_cadence, d.reporting_metrics, d.support_response,
    d.production_notice_days, d.production_setups, d.production_cancel_hours);
$$;

-- Reset a deal to draft with a cause recorded in deal_events (the deals
-- trigger does the cleanup). SECURITY INVOKER: RLS and the trigger apply.
create or replace function public.reset_deal_to_draft(p_deal_id uuid, p_cause text default 'manual')
returns void
language plpgsql
set search_path = public
as $$
begin
  perform set_config('crm.deal_reset_cause', left(coalesce(p_cause, 'manual'), 200), true);
  update public.deals set status = 'draft'
  where id = p_deal_id and status in ('approved', 'sent', 'viewed');
  perform set_config('crm.deal_reset_cause', '', true);
end;
$$;
revoke all on function public.reset_deal_to_draft(uuid, text) from public, anon;
grant execute on function public.reset_deal_to_draft(uuid, text) to authenticated, service_role;

-- Update rules.
--  * void is terminal: any update is refused (service role included) unless
--    it only touches updated_at.
--  * Everything below applies to signed-in users (auth.uid() set). Server
--    routes using the service role (sign page, countersign) pass.
--  * signed / countersigned deals: only an Admin may void them, nothing else.
--  * approval (approved_by set, status -> approved): Admin/Manager only.
--    EVERY approval sets date_issued to today and valid_through to
--    greatest(valid_through, today + 14) (America/Chicago). The approve
--    route then writes these dates into the Google Docs before freezing them.
--  * status: users may set draft, approved (Admin/Manager), sent (from
--    approved / viewed) and void (Admin/Manager); viewed / signed /
--    countersigned come from the server routes only.
--  * sending (status -> sent, or Regenerate link, which bumps sent_at) is
--    refused once valid_through is before today.
--  * a content change (deal_content) on an approved / sent / viewed deal
--    resets it to draft, clears approval and revokes its unsigned links.
create or replace function public.deals_before_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

  -- Explicit reset (status -> draft from approved / sent / viewed): the
  -- trigger does the cleanup, for users and the service role alike. Cause from
  -- reset_deal_to_draft() / deal_touch_content(), else 'manual'.
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

  -- Internal-only fields (owner, hours, tool builder) on an approved / sent /
  -- viewed deal: logged, no reset (the internal doc is computed live).
  if old.status in ('approved', 'sent', 'viewed')
     and (new.owner_id, new.est_management_hours, new.est_project_hours, new.tool_builder_id)
         is distinct from (old.owner_id, old.est_management_hours, old.est_project_hours, old.tool_builder_id) then
    insert into public.deal_events (deal_id, kind, actor, details)
    values (old.id, 'internal_fields_changed', public.current_team_member_id(),
            jsonb_build_object(
              'owner_id', jsonb_build_array(old.owner_id, new.owner_id),
              'est_management_hours', jsonb_build_array(old.est_management_hours, new.est_management_hours),
              'est_project_hours', jsonb_build_array(old.est_project_hours, new.est_project_hours),
              'tool_builder_id', jsonb_build_array(old.tool_builder_id, new.tool_builder_id)));
  end if;

  -- Content edits after approval: back to draft (this wins over any status
  -- change in the same update).
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
$$;
create trigger deals_before_update before update on public.deals
  for each row execute function public.deals_before_update();

-- Shared by line item and document changes, whoever makes them (service
-- role included): refuse on signed and void deals, reset approved / sent /
-- viewed ones to draft. Internal; no grants.
create or replace function public.deal_touch_content(p_deal_id uuid, p_cause text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from public.deals where id = p_deal_id for update;
  if v_status in ('signed', 'countersigned') then
    raise exception 'This deal is signed and can no longer be changed' using errcode = '42501';
  end if;
  if v_status = 'void' then
    raise exception 'This deal is void and can no longer be changed' using errcode = '42501';
  end if;
  if v_status in ('approved', 'sent', 'viewed') then
    -- The deals trigger does the cleanup (approval cleared, links revoked,
    -- reset_to_draft logged with this cause).
    perform set_config('crm.deal_reset_cause', left(p_cause, 200), true);
    update public.deals set status = 'draft' where id = p_deal_id;
    perform set_config('crm.deal_reset_cause', '', true);
  end if;
end;
$$;
revoke all on function public.deal_touch_content(uuid, text) from public, anon, authenticated;

create or replace function public.deal_line_items_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  perform public.deal_touch_content(coalesce(new.deal_id, old.deal_id), 'line items');
  if tg_op = 'UPDATE' and new.deal_id is distinct from old.deal_id then
    perform public.deal_touch_content(old.deal_id, 'line items');
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
create trigger deal_line_items_changed before insert or update or delete on public.deal_line_items
  for each row execute function public.deal_line_items_changed();

-- Documents.
--  * INSERT of a proposal / sow version resets an approved / sent / viewed
--    deal to draft, whoever inserts it (before the service-role return), and
--    is refused on signed or void deals. kind 'internal' snapshots never
--    reset anything.
--  * Versions are immutable. At approval an Admin/Manager may set
--    approved_by, approved_at, frozen_pdf_path, content_hash, frozen_at,
--    drive_modified_at_approval and drive_file_id_pdf, in one update or
--    several; nothing else ever changes.
--  * The service role is not limited beyond the reset.
create or replace function public.deal_documents_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.kind in ('proposal', 'sow') then
    perform public.deal_touch_content(new.deal_id, new.kind || ' v' || new.version);
  end if;

  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if (new.approved_by is not null or new.approved_at is not null or new.frozen_pdf_path is not null
        or new.frozen_at is not null or new.drive_modified_at_approval is not null
        or new.drive_file_id_pdf is not null)
       and not public.is_admin_or_manager() then
      raise exception 'Only an Admin or Manager can approve a document' using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  if (new.id, new.deal_id, new.kind, new.version, new.content_json, new.google_doc_id,
      new.google_doc_url, new.template_doc_id, new.template_modified_at,
      new.source, new.generated_by, new.model, new.section_flags, new.created_at)
     is distinct from
     (old.id, old.deal_id, old.kind, old.version, old.content_json, old.google_doc_id,
      old.google_doc_url, old.template_doc_id, old.template_modified_at,
      old.source, old.generated_by, old.model, old.section_flags, old.created_at) then
    raise exception 'Document versions are never edited; save a new version' using errcode = '42501';
  end if;
  if (new.approved_by, new.approved_at, new.frozen_pdf_path, new.content_hash, new.frozen_at,
      new.drive_modified_at_approval, new.drive_file_id_pdf)
     is distinct from
     (old.approved_by, old.approved_at, old.frozen_pdf_path, old.content_hash, old.frozen_at,
      old.drive_modified_at_approval, old.drive_file_id_pdf)
     and not public.is_admin_or_manager() then
    raise exception 'Only an Admin or Manager can approve a document' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger deal_documents_guard before insert or update on public.deal_documents
  for each row execute function public.deal_documents_guard();

-- Deleting: Admin/Manager (RLS below); signed deals never.
create or replace function public.deals_before_delete()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('signed', 'countersigned') then
    raise exception 'A signed deal cannot be deleted' using errcode = '42501';
  end if;
  return old;
end;
$$;
create trigger deals_before_delete before delete on public.deals
  for each row execute function public.deals_before_delete();

create trigger deal_settings_set_updated_at before update on public.deal_settings
  for each row execute function public.set_updated_at();

revoke all on function public.deals_before_insert() from public, anon, authenticated;
revoke all on function public.deals_before_update() from public, anon, authenticated;
revoke all on function public.deals_before_delete() from public, anon, authenticated;
revoke all on function public.deal_line_items_changed() from public, anon, authenticated;
revoke all on function public.deal_documents_guard() from public, anon, authenticated;
revoke all on function public.deal_content(public.deals) from public, anon;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.deals            enable row level security;
alter table public.deal_line_items  enable row level security;
alter table public.deal_documents   enable row level security;
alter table public.deal_signatures  enable row level security;
alter table public.project_links    enable row level security;
alter table public.deal_settings    enable row level security;
alter table public.deal_events      enable row level security;
alter table public.deal_rate_limits enable row level security;

create policy "team read"   on public.deals for select to authenticated using (public.is_team_member());
create policy "team insert" on public.deals for insert to authenticated with check (public.is_team_member());
create policy "team update" on public.deals for update to authenticated
  using (public.is_team_member()) with check (public.is_team_member());
create policy "admin or manager delete" on public.deals for delete to authenticated
  using (public.is_admin_or_manager());

create policy "team read"   on public.deal_line_items for select to authenticated using (public.is_team_member());
create policy "team insert" on public.deal_line_items for insert to authenticated with check (public.is_team_member());
create policy "team update" on public.deal_line_items for update to authenticated
  using (public.is_team_member()) with check (public.is_team_member());
create policy "team delete" on public.deal_line_items for delete to authenticated using (public.is_team_member());

create policy "team read"   on public.deal_documents for select to authenticated using (public.is_team_member());
create policy "team insert" on public.deal_documents for insert to authenticated with check (public.is_team_member());
create policy "admin or manager update" on public.deal_documents for update to authenticated
  using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());

create policy "team read" on public.deal_signatures for select to authenticated using (public.is_team_member());

create policy "team read"   on public.project_links for select to authenticated using (public.is_team_member());
create policy "team insert" on public.project_links for insert to authenticated with check (public.is_team_member());
create policy "team update" on public.project_links for update to authenticated
  using (public.is_team_member()) with check (public.is_team_member());
create policy "team delete manual other" on public.project_links for delete to authenticated
  using (public.is_team_member() and kind = 'other' and source = 'manual');

create policy "team read" on public.deal_settings for select to authenticated using (public.is_team_member());
create policy "admin or manager update" on public.deal_settings for update to authenticated
  using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());

create policy "team read" on public.deal_events for select to authenticated using (public.is_team_member());
create policy "team insert as self" on public.deal_events for insert to authenticated
  with check (public.is_team_member() and actor = public.current_team_member_id());

-- deal_rate_limits: no policies (service role only).

-- Grants: nothing for anon; no truncate / references / trigger for
-- authenticated; signatures and rate limits are not written by app users.
revoke all on public.deals, public.deal_line_items, public.deal_documents, public.deal_signatures,
              public.project_links, public.deal_settings, public.deal_events, public.deal_rate_limits
  from anon;
revoke truncate, references, trigger on public.deals, public.deal_line_items, public.deal_documents,
              public.deal_signatures, public.project_links, public.deal_settings, public.deal_events
  from authenticated;
revoke insert, update, delete on public.deal_signatures from authenticated;
revoke delete on public.deal_documents from authenticated;
revoke insert, delete on public.deal_settings from authenticated;
revoke update, delete on public.deal_events from authenticated;
revoke all on public.deal_rate_limits from authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for frozen and signed PDFs. No storage.objects
-- policies, so only the service role reads or writes; downloads go through
-- short-lived signed URLs created by the server after its own checks.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('deal-docs', 'deal-docs', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;
