-- 028: saved searches removed (migration 025). History > Searches (every
-- lead_finder_runs row, with Open and Run again) replaces them; Matteo's
-- built-in saved missions stay on the launch pad. Dropping the table drops
-- its policies and index. One row existed (Luke's "HVAC · Fresno · 20";
-- its run is still listed under Searches).
--
-- Applied with Supabase MCP apply_migration.

drop table if exists public.saved_searches;
