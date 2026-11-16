-- Fully Launched CRM, migration 043: stored person pill colors.
--
-- Before: pill colors were computed in the app (memberColors(), lib/team.ts):
-- Luke pinned blue by email, everyone else rotating through six colors in
-- (created_at, id) order, so removing a member shifted everyone after them.
-- After: each member has team_members.color, a palette name. The app maps the
-- name to Tailwind classes (MEMBER_COLORS, lib/theme.ts). Red, orange, green
-- and blue are left out of the palette: those mean branches.
--
-- Backfill (Nov 16, 2026): Luke violet, Talon purple, Matteo teal, Tait pink,
-- Declan cyan, Elias slate (archived in 044, shown on history only).
-- New members get the least-used palette color on insert, ties broken in
-- the order amber, fuchsia, stone, yellow, violet, purple, teal, pink, cyan,
-- slate (so the next four hires get amber, fuchsia, stone, yellow).
--
-- Applied from the Supabase SQL editor (not apply_migration), so it is not in
-- the migration history table.

alter table public.team_members add column if not exists color text;

alter table public.team_members drop constraint if exists team_members_color_check;
alter table public.team_members add constraint team_members_color_check
  check (color is null or color in (
    'violet', 'purple', 'fuchsia', 'pink', 'teal', 'cyan',
    'slate', 'stone', 'amber', 'yellow'
  ));

update public.team_members set color = 'violet' where lower(email) = 'luke@fullylaunched.com';
update public.team_members set color = 'purple' where lower(email) = 'talon@fullylaunched.com';
update public.team_members set color = 'teal'   where lower(email) = 'matteo@fullylaunched.com';
update public.team_members set color = 'pink'   where lower(email) = 'tait@fullylaunched.com';
update public.team_members set color = 'cyan'   where lower(email) = 'declan@fullylaunched.com';
update public.team_members set color = 'slate'  where lower(email) = 'elias@fullylaunched.com';

create or replace function public.team_members_assign_color()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.color is null then
    select p.c into new.color
      from unnest(array['amber', 'fuchsia', 'stone', 'yellow',
                        'violet', 'purple', 'teal', 'pink', 'cyan', 'slate'])
           with ordinality as p(c, ord)
     order by (select count(*) from public.team_members tm where tm.color = p.c), p.ord
     limit 1;
  end if;
  return new;
end;
$$;

revoke all on function public.team_members_assign_color() from public, anon, authenticated;

drop trigger if exists team_members_assign_color on public.team_members;
create trigger team_members_assign_color
  before insert on public.team_members
  for each row execute function public.team_members_assign_color();
