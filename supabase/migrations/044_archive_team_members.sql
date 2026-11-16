-- Fully Launched CRM, migration 044: archive team members instead of deleting.
--
-- team_members.archived_at: set = off the team. The row stays, so history
-- (time entries, lead touches, closed projects, payouts) keeps the name;
-- deleting isn't possible anyway once someone has time entries, touches or
-- found leads (ON DELETE RESTRICT). The app leaves archived members out of
-- every picker, filter, the Team page, booking links and the Websites /
-- AI default-owner lookup (lib/team.ts activeMembers()).
--
-- Nov 16, 2026: Elias O'Neil archived. He has no auth user, so there is no
-- login to ban. His Websites default-owner role moves to Luke
-- (lead_branches), which drives the owner default in Move to Interested.
--
-- Applied from the Supabase SQL editor (not apply_migration), so it is not in
-- the migration history table.

alter table public.team_members add column if not exists archived_at timestamptz;

update public.team_members
   set archived_at = coalesce(archived_at, now()),
       lead_branches = '{}'
 where id = '98cb1ca7-9def-496b-a582-587560b3ce31';

update public.team_members
   set lead_branches = array['AI', 'Websites']
 where lower(email) = 'luke@fullylaunched.com';
