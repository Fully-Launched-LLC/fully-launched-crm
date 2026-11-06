-- 031: business contact vs owner contact.
--
-- Business (the company's main line): leads.phone, leads.email, website,
--   social links. Filled by scans (Google profile, website) and by hand.
-- Owner (the person): contact_name, title, contact_linkedin, and the new
--   owner_phone / owner_email (direct line, personal or work email).
--   Never filled by Google or website scans; only by hand, Apollo's
--   "Use as business owner", or a project's contact (backfill, 032).
-- update_business_contact (020/021) accepts the two new keys; still any
-- team member, whoever the business is assigned to.
--
-- Applied with Supabase MCP apply_migration.

alter table public.leads add column owner_phone text;
alter table public.leads add column owner_email text;

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
             where k not in ('contact_name', 'title', 'email', 'phone', 'contact_linkedin', 'company_linkedin',
                             'owner_phone', 'owner_email')) then
    raise exception 'Only contact_name, title, email, phone, owner_phone, owner_email, contact_linkedin and company_linkedin can be changed here' using errcode = '22023';
  end if;

  update public.leads set
    contact_name     = case when p_fields ? 'contact_name'     then nullif(btrim(p_fields ->> 'contact_name'), '')     else contact_name end,
    title            = case when p_fields ? 'title'            then nullif(btrim(p_fields ->> 'title'), '')            else title end,
    email            = case when p_fields ? 'email'            then nullif(btrim(p_fields ->> 'email'), '')            else email end,
    phone            = case when p_fields ? 'phone'            then nullif(btrim(p_fields ->> 'phone'), '')            else phone end,
    owner_email      = case when p_fields ? 'owner_email'      then nullif(btrim(p_fields ->> 'owner_email'), '')      else owner_email end,
    owner_phone      = case when p_fields ? 'owner_phone'      then nullif(btrim(p_fields ->> 'owner_phone'), '')      else owner_phone end,
    contact_linkedin = case when p_fields ? 'contact_linkedin' then nullif(btrim(p_fields ->> 'contact_linkedin'), '') else contact_linkedin end,
    company_linkedin = case when p_fields ? 'company_linkedin' then nullif(btrim(p_fields ->> 'company_linkedin'), '') else company_linkedin end
  where id = p_lead_id
  returning id, contact_name, title, email, phone, owner_email, owner_phone, contact_linkedin, company_linkedin into r;

  if not found then
    raise exception 'Business record not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', r.id, 'contact_name', r.contact_name, 'title', r.title, 'email', r.email,
                            'phone', r.phone, 'owner_email', r.owner_email, 'owner_phone', r.owner_phone,
                            'contact_linkedin', r.contact_linkedin, 'company_linkedin', r.company_linkedin);
end;
$$;
revoke all on function public.update_business_contact(uuid, jsonb) from public, anon;
grant execute on function public.update_business_contact(uuid, jsonb) to authenticated;
