-- 021: LinkedIn on businesses (Sales).
--   contact_linkedin  the business owner's / contact's LinkedIn profile
--   company_linkedin  the business's LinkedIn company page (auto-filled
--                     from the website scan when the site links to
--                     linkedin.com/company/...)
-- Legacy rows kept person profile URLs in external_ids.linkedin (21 rows on
-- Nov 5, all linkedin.com/in/...): copied into contact_linkedin, not moved
-- (external_ids keeps its key). The shared updated_at trigger bumps
-- updated_at on those rows.
-- update_business_contact (020) now also takes both fields: any team
-- member, whoever the business is assigned to.
--
-- Applied with Supabase MCP apply_migration.

alter table public.leads
  add column contact_linkedin text,
  add column company_linkedin text;

update public.leads
set contact_linkedin = btrim(external_ids ->> 'linkedin')
where contact_linkedin is null
  and coalesce(btrim(external_ids ->> 'linkedin'), '') <> '';

create or replace function public.update_business_contact(p_lead_id uuid, p_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if not public.is_team_member() then
    raise exception 'Not on the team roster' using errcode = '42501';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'fields must be a JSON object' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_fields) k
             where k not in ('contact_name', 'title', 'email', 'phone', 'contact_linkedin', 'company_linkedin')) then
    raise exception 'Only contact_name, title, email, phone, contact_linkedin and company_linkedin can be changed here' using errcode = '22023';
  end if;

  update public.leads set
    contact_name     = case when p_fields ? 'contact_name'     then nullif(btrim(p_fields ->> 'contact_name'), '')     else contact_name end,
    title            = case when p_fields ? 'title'            then nullif(btrim(p_fields ->> 'title'), '')            else title end,
    email            = case when p_fields ? 'email'            then nullif(btrim(p_fields ->> 'email'), '')            else email end,
    phone            = case when p_fields ? 'phone'            then nullif(btrim(p_fields ->> 'phone'), '')            else phone end,
    contact_linkedin = case when p_fields ? 'contact_linkedin' then nullif(btrim(p_fields ->> 'contact_linkedin'), '') else contact_linkedin end,
    company_linkedin = case when p_fields ? 'company_linkedin' then nullif(btrim(p_fields ->> 'company_linkedin'), '') else company_linkedin end
  where id = p_lead_id
  returning id, contact_name, title, email, phone, contact_linkedin, company_linkedin into r;

  if not found then
    raise exception 'Business record not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', r.id, 'contact_name', r.contact_name, 'title', r.title, 'email', r.email,
                            'phone', r.phone, 'contact_linkedin', r.contact_linkedin, 'company_linkedin', r.company_linkedin);
end;
$$;

revoke all on function public.update_business_contact(uuid, jsonb) from public, anon;
grant execute on function public.update_business_contact(uuid, jsonb) to authenticated;
