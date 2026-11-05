-- 020: any team member can edit a business's contact info (the person at
-- the business: contact_name, title, email, phone), whoever the record is
-- assigned to. Everything else on leads (owner = "Assigned to", status,
-- notes, ...) keeps the 017 RLS rules.
--
-- SECURITY DEFINER so it works past "owner or manager update"; it touches
-- only those four columns, rejects any other key, and needs a team member
-- (is_team_member(), the 016 identity rule). leads_normalize still runs
-- (phone_digits, domain), and set_updated_at stamps updated_at.
-- Errors: 42501 not on the roster, 22023 bad fields, P0002 no such record.
--
-- Applied with Supabase MCP apply_migration.

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
             where k not in ('contact_name', 'title', 'email', 'phone')) then
    raise exception 'Only contact_name, title, email and phone can be changed here' using errcode = '22023';
  end if;

  update public.leads set
    contact_name = case when p_fields ? 'contact_name' then nullif(btrim(p_fields ->> 'contact_name'), '') else contact_name end,
    title        = case when p_fields ? 'title'        then nullif(btrim(p_fields ->> 'title'), '')        else title end,
    email        = case when p_fields ? 'email'        then nullif(btrim(p_fields ->> 'email'), '')        else email end,
    phone        = case when p_fields ? 'phone'        then nullif(btrim(p_fields ->> 'phone'), '')        else phone end
  where id = p_lead_id
  returning id, contact_name, title, email, phone into r;

  if not found then
    raise exception 'Business record not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', r.id, 'contact_name', r.contact_name, 'title', r.title,
                            'email', r.email, 'phone', r.phone);
end;
$$;

revoke all on function public.update_business_contact(uuid, jsonb) from public, anon;
grant execute on function public.update_business_contact(uuid, jsonb) to authenticated;
