-- A project's company record follows the project's name while it is still
-- the untouched record projects_link_company (035) created for it.
--
-- Why: a project saved mid-rename (e.g. "New ProjectTEST deak desj C") got
-- its company record from that intermediate name, and the later rename never
-- reached it, so documents and the Drive folder used the stale name.
--
-- Renamed only when all hold, else left alone:
--   * created by the matching trigger: source_detail = 'From projects'
--     (remove_from_pipeline also writes that, but always logs a touch in
--     the same call, so the next rule excludes it);
--   * no outreach history: no lead_touches rows, no last_touch_at, no
--     meeting notes;
--   * this is the only project of that company;
--   * the company name was never edited (still equals the old project name).
create or replace function public.projects_company_follow_rename()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(new.client_name);
begin
  if v_name = '' or public.company_key(v_name) is null or public.company_key(v_name) = 'newproject' then
    return null;
  end if;

  update public.leads l
  set company = v_name,
      name = case when l.name = l.company then v_name else l.name end
  where l.id = new.lead_id
    and l.source_detail = 'From projects'
    and l.last_touch_at is null
    and l.company = old.client_name
    and not exists (select 1 from public.lead_touches t where t.lead_id = l.id)
    and not exists (select 1 from public.meeting_notes m where m.lead_id = l.id)
    and not exists (select 1 from public.projects p where p.lead_id = l.id and p.id <> new.id);
  return null;
end;
$$;
revoke all on function public.projects_company_follow_rename() from public, anon, authenticated;

create trigger projects_company_follow_rename
  after update of client_name on public.projects
  for each row
  when (new.lead_id is not null and new.client_name is distinct from old.client_name)
  execute function public.projects_company_follow_rename();
