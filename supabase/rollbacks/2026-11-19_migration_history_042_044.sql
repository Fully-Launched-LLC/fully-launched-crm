-- Rollback for the Nov 19, 2026 migration-history repair: removes the three
-- history-only rows recorded for 042, 043 and 044 (applied from the SQL
-- editor on Nov 16). Touches supabase_migrations.schema_migrations only;
-- the schema objects those migrations created stay in place.
begin;
do $$
declare n int;
begin
  delete from supabase_migrations.schema_migrations
  where version in ('20261116120000', '20261116120100', '20261116120200')
    and name in ('042_payment_status_admin_only', '043_team_member_colors', '044_archive_team_members');
  get diagnostics n = row_count;
  if n <> 3 then raise exception 'expected 3 rows deleted, got %', n; end if;
end $$;
commit;
select version, name from supabase_migrations.schema_migrations where version >= '20261115' order by version;
