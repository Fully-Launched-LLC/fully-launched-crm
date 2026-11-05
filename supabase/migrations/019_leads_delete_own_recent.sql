-- 019: Sales Undo can remove a business record its own click created.
--
-- Before: leads delete was Admin-only ("admin delete", 017), so Undo on a
-- first outcome left an empty record ("No outcome yet") for everyone else.
-- Now a team member may also delete a record they created (found_by = me)
-- within 10 minutes of creating it, when it has no touches (Undo deletes
-- its touch first) and isn't linked to a project. Admins keep "admin
-- delete"; permissive policies OR together.
--
-- Applied with Supabase MCP apply_migration.

create policy "own recent delete" on public.leads
  for delete to authenticated
  using (
    public.is_team_member()
    and found_by = public.current_team_member_id()
    and created_at > now() - interval '10 minutes'
    and project_id is null
    and not exists (select 1 from public.lead_touches t where t.lead_id = leads.id)
  );
