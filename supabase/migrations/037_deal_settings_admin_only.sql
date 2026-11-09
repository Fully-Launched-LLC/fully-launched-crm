-- Deal Desk settings (rates that feed the internal deal doc and Phase 2
-- payouts) are edited by Admins only, from Settings > Deal Desk. 036 allowed
-- Admin or Manager; the page is Admin-only, so the database matches it.
drop policy if exists "admin or manager update" on public.deal_settings;
create policy "admin update" on public.deal_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
