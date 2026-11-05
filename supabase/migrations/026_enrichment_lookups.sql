-- 026: log of contact-enrichment lookups (Apollo, "Find owner contact" in
-- Sales), for credit tracking: who looked up which business, when, how many
-- results, credits left when Apollo reports them. Written by the
-- /api/sales/apollo route as the signed-in user. Team members read; nobody
-- edits or deletes (it's a log).
--
-- Applied with Supabase MCP apply_migration.

create table public.enrichment_lookups (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null default 'apollo'
    constraint enrichment_lookups_provider_check check (provider in ('apollo')),
  kind              text not null
    constraint enrichment_lookups_kind_check check (kind in ('search', 'reveal')),
  lead_id           uuid references public.leads(id) on delete set null,
  place_id          text,
  business_name     text,
  domain            text,
  person            text,
  results_count     integer,
  credits_remaining integer,
  error             text,
  looked_up_by      uuid default public.current_team_member_id()
                      references public.team_members(id) on delete set null,
  created_at        timestamptz not null default now()
);

create index enrichment_lookups_created_idx on public.enrichment_lookups (created_at desc);

alter table public.enrichment_lookups enable row level security;

create policy "team read" on public.enrichment_lookups
  for select to authenticated
  using (public.is_team_member());

create policy "team insert as self" on public.enrichment_lookups
  for insert to authenticated
  with check (public.is_team_member() and looked_up_by = public.current_team_member_id());

revoke all on public.enrichment_lookups from anon;
revoke update, delete, truncate, references, trigger, maintain on public.enrichment_lookups from authenticated;
grant select, insert on public.enrichment_lookups to authenticated;
