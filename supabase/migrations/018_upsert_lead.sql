-- Fully Launched CRM — migration 018
-- The shared lead upsert moves into the database, so every source (Lead
-- Finder, CSV import, manual adds, and later Apify, GrokBot, Claude research,
-- ...) uses one copy of the matching rules. lib/leads/upsert.ts becomes a thin
-- RPC wrapper; lib/leads/match.ts no longer matches anything.
--
--   a) leads.source vocabulary: legacy free-text sources are mapped (old text
--      kept in source_detail), source becomes one of 12 fixed values (check
--      constraint), default 'manual', not null.
--   b) Normalization helpers lead_norm_email / lead_norm_domain /
--      lead_norm_phone, and leads_normalize() rewritten to use them (same
--      behavior as 017), so stored keys and lookup keys can't drift apart.
--   c) find_lead_match(p jsonb) / find_lead_matches(p jsonb): the match rule.
--      Order: google_place_id, cid, email, domain, phone_digits. Place id and
--      cid identify one location. Email, domain and phone are shared by chain
--      locations, so they only match when the two records do NOT both carry a
--      place id that differs, or both carry a cid that differs (chain rule).
--      Among several soft-key candidates the oldest lead wins.
--   d) upsert_lead(p jsonb) -> {lead_id, action, matched_on, reason}
--      upsert_leads(p jsonb) -> {inserted, merged, skipped, results: [...]}
--        p = {"mode": "skip" | "merge", "lead": {...}}       (one)
--        p = {"mode": "skip" | "merge", "leads": [{...}, ...]} (up to 500)
--      skip:  a match is reported and left alone (Lead Finder adds).
--      merge: fill empty fields only, union branch_fit, merge external_ids
--             (existing keys win). Never touches status, owner, found_by,
--             project_id or company.
--   e) Grants.
--
-- All new functions are SECURITY INVOKER with search_path = public: RLS
-- applies exactly as it does to the app's own queries (a Salesperson's
-- insert must credit themselves; a merge into a lead someone else owns
-- updates nothing and comes back "skipped").
--
-- Applied with Supabase MCP apply_migration.

begin;

-- ===========================================================================
-- a) Source vocabulary (12 values).
-- Live on Nov 4: "Luke contacts - personal outreach" (23), "E-com cold list:
-- Etsy" (8), "E-com intent: Reddit r/FulfillmentByAmazon" (1), lead_finder (1).
-- The old free text is kept in source_detail (only where that's empty).
--   "Luke contacts - personal outreach"          -> personal_network
--   "E-com cold list: Etsy"                      -> etsy
--   anything else not already an allowed value   -> manual

update public.leads
set source_detail = coalesce(nullif(btrim(source_detail), ''), nullif(btrim(source), '')),
    source = case btrim(coalesce(source, ''))
               when 'Luke contacts - personal outreach' then 'personal_network'
               when 'E-com cold list: Etsy' then 'etsy'
               else 'manual'
             end
where source is null
   or source not in ('lead_finder', 'apify', 'grokbot', 'claude', 'happenstance', 'gojiberry',
                     'heyreach', 'csv_import', 'manual', 'referral', 'personal_network', 'etsy');

alter table public.leads
  alter column source set default 'manual',
  alter column source set not null,
  add constraint leads_source_check
    check (source in ('lead_finder', 'apify', 'grokbot', 'claude', 'happenstance', 'gojiberry',
                      'heyreach', 'csv_import', 'manual', 'referral', 'personal_network', 'etsy'));

-- ===========================================================================
-- b) Normalization helpers (the 017 trigger's rules, unchanged).

create or replace function public.lead_norm_email(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(lower(btrim(p)), '')
$$;

-- Lowercase host, no scheme/userinfo/port/path/www. Null for social and
-- link-in-bio hosts, so a Facebook page never claims "facebook.com".
create or replace function public.lead_norm_domain(p text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text;
begin
  v := lower(btrim(coalesce(p, '')));
  v := regexp_replace(v, '^[a-z][a-z0-9+.-]*://', '');
  v := regexp_replace(v, '^[^@/]*@', '');
  v := regexp_replace(v, '[/?#:].*$', '');
  v := regexp_replace(v, '^www\.', '');
  v := nullif(v, '');
  if v is not null and (
       v in ('facebook.com', 'fb.com', 'instagram.com', 'linktr.ee', 'linkin.bio',
             'tiktok.com', 'yelp.com', 'business.site', 'g.page', 'google.com',
             'nextdoor.com', 'x.com', 'twitter.com')
    or v ~ '\.(facebook\.com|fb\.com|instagram\.com|linktr\.ee|linkin\.bio|tiktok\.com|yelp\.com|business\.site|g\.page|google\.com|nextdoor\.com|x\.com|twitter\.com)$'
  ) then
    v := null;
  end if;
  return v;
end;
$$;

-- Last 10 digits, null if fewer than 10.
create or replace function public.lead_norm_phone(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select case when length(d) >= 10 then right(d, 10) end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) s
$$;

-- 017's trigger, now via the helpers. Same results for every input.
create or replace function public.leads_normalize()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.email := public.lead_norm_email(new.email);
  new.domain := public.lead_norm_domain(coalesce(nullif(btrim(new.domain), ''), new.website));
  new.phone_digits := public.lead_norm_phone(new.phone);

  new.company := nullif(btrim(new.company), '');
  new.name := coalesce(nullif(btrim(new.name), ''), new.company, nullif(btrim(new.contact_name), ''), new.email, 'Unnamed lead');
  if new.company is null and tg_op = 'INSERT' then
    new.company := new.name;
  end if;

  return new;
end;
$$;

-- ===========================================================================
-- c) Matching.

-- p: a lead-shaped object; reads google_place_id, external_ids.cid, email,
-- domain (else website) and phone. Returns {lead_id, matched_on} or null.
-- matched_on: google_place_id | cid | email | domain | phone.
create or replace function public.find_lead_match(p jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_place text := nullif(btrim(p ->> 'google_place_id'), '');
  v_cid   text := nullif(btrim(p -> 'external_ids' ->> 'cid'), '');
  v_email text := public.lead_norm_email(p ->> 'email');
  v_dom   text := public.lead_norm_domain(coalesce(nullif(btrim(p ->> 'domain'), ''), p ->> 'website'));
  v_phone text := public.lead_norm_phone(p ->> 'phone');
  v_id    uuid;
begin
  if v_place is not null then
    select l.id into v_id from public.leads l where l.google_place_id = v_place;
    if v_id is not null then
      return jsonb_build_object('lead_id', v_id, 'matched_on', 'google_place_id');
    end if;
  end if;

  if v_cid is not null then
    select l.id into v_id from public.leads l where l.external_ids ->> 'cid' = v_cid;
    if v_id is not null then
      return jsonb_build_object('lead_id', v_id, 'matched_on', 'cid');
    end if;
  end if;

  -- Soft keys, with the chain rule: skip a candidate when both sides carry a
  -- place id that differs, or both carry a cid that differs.
  if v_email is not null then
    select l.id into v_id from public.leads l
    where lower(l.email) = v_email
      and (v_place is null or l.google_place_id is null or l.google_place_id = v_place)
      and (v_cid is null or l.external_ids ->> 'cid' is null or l.external_ids ->> 'cid' = v_cid)
    order by l.created_at, l.id
    limit 1;
    if v_id is not null then
      return jsonb_build_object('lead_id', v_id, 'matched_on', 'email');
    end if;
  end if;

  if v_dom is not null then
    select l.id into v_id from public.leads l
    where l.domain = v_dom
      and (v_place is null or l.google_place_id is null or l.google_place_id = v_place)
      and (v_cid is null or l.external_ids ->> 'cid' is null or l.external_ids ->> 'cid' = v_cid)
    order by l.created_at, l.id
    limit 1;
    if v_id is not null then
      return jsonb_build_object('lead_id', v_id, 'matched_on', 'domain');
    end if;
  end if;

  if v_phone is not null then
    select l.id into v_id from public.leads l
    where l.phone_digits = v_phone
      and (v_place is null or l.google_place_id is null or l.google_place_id = v_place)
      and (v_cid is null or l.external_ids ->> 'cid' is null or l.external_ids ->> 'cid' = v_cid)
    order by l.created_at, l.id
    limit 1;
    if v_id is not null then
      return jsonb_build_object('lead_id', v_id, 'matched_on', 'phone');
    end if;
  end if;

  return null;
end;
$$;

-- p: array of lead-shaped objects. Returns an array of the same length:
-- {index, lead_id, matched_on} (lead_id/matched_on null when no match).
-- Read-only; the Lead Finder uses it to mark results that are already leads.
create or replace function public.find_lead_matches(p jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_el  jsonb;
  v_i   bigint;
  v_m   jsonb;
begin
  if jsonb_typeof(p) is distinct from 'array' then
    raise exception 'find_lead_matches expects a JSON array' using errcode = '22023';
  end if;
  for v_el, v_i in select e, n - 1 from jsonb_array_elements(p) with ordinality as t(e, n) loop
    v_m := public.find_lead_match(v_el);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'index', v_i,
      'lead_id', v_m -> 'lead_id',
      'matched_on', v_m -> 'matched_on'));
  end loop;
  return v_out;
end;
$$;

-- ===========================================================================
-- d) Upsert.

-- p = {"mode": "skip" | "merge", "lead": {...leads columns...}}
-- Returns {lead_id, action: inserted | merged | skipped, matched_on, reason}.
-- Settable on insert: every leads column except id, name, phone_digits,
-- project_id, last_touch_at, created_at, updated_at (name, domain and
-- phone_digits come from the normalize trigger). Defaults: source 'manual',
-- status 'new', found_by = the caller, branch_fit {}, external_ids {}.
-- Errors on one lead (RLS, a bad value) come back as "skipped" with the
-- reason, so a batch keeps going.
create or replace function public.upsert_lead(p jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_mode   text := coalesce(p ->> 'mode', 'skip');
  v_in     jsonb := p -> 'lead';
  r        public.leads;
  v_match  jsonb;
  v_id     uuid;
  v_on     text;
  v_upd    uuid;
  v_source text;
  v_company text;
begin
  if v_mode not in ('skip', 'merge') then
    raise exception 'upsert_lead: mode must be skip or merge' using errcode = '22023';
  end if;
  if jsonb_typeof(v_in) is distinct from 'object' then
    raise exception 'upsert_lead: "lead" must be a JSON object' using errcode = '22023';
  end if;

  v_company := nullif(btrim(coalesce(v_in ->> 'company', v_in ->> 'name', '')), '');
  if v_company is null then
    return jsonb_build_object('lead_id', null, 'action', 'skipped', 'matched_on', null,
                              'reason', 'Missing company name');
  end if;

  v_source := coalesce(nullif(btrim(v_in ->> 'source'), ''), 'manual');

  begin
    r := jsonb_populate_record(null::public.leads, v_in);
  exception when others then
    return jsonb_build_object('lead_id', null, 'action', 'skipped', 'matched_on', null,
                              'reason', 'Bad value: ' || sqlerrm);
  end;

  v_match := public.find_lead_match(v_in);

  if v_match is null then
    begin
      insert into public.leads (
        company, contact_name, title, email, phone, website, domain, address, city, state,
        industry, category, branch_fit, wheaton_alum, source, source_detail, external_ids,
        google_place_id, maps_url, rating, review_count, website_status, scan_tags,
        lead_score, priority_score, uses_servicetitan, audit, audit_at, contact_info, notes,
        status, found_by, owner, next_action, next_action_at)
      values (
        v_company, r.contact_name, r.title, r.email, r.phone, r.website, r.domain, r.address, r.city, r.state,
        r.industry, r.category, coalesce(r.branch_fit, '{}'), coalesce(r.wheaton_alum, false), v_source,
        r.source_detail, coalesce(r.external_ids, '{}'::jsonb),
        r.google_place_id, r.maps_url, r.rating, r.review_count, r.website_status, r.scan_tags,
        r.lead_score, r.priority_score, coalesce(r.uses_servicetitan, false), r.audit, r.audit_at,
        r.contact_info, r.notes,
        coalesce(r.status, 'new'), coalesce(r.found_by, public.current_team_member_id()), r.owner,
        r.next_action, r.next_action_at)
      returning id into v_id;
      return jsonb_build_object('lead_id', v_id, 'action', 'inserted', 'matched_on', null, 'reason', null);
    exception
      when unique_violation then
        -- Someone added the same place id / cid a moment ago: treat it as a match.
        v_match := public.find_lead_match(v_in);
        if v_match is null then
          return jsonb_build_object('lead_id', null, 'action', 'skipped', 'matched_on', null, 'reason', sqlerrm);
        end if;
      when insufficient_privilege then
        return jsonb_build_object('lead_id', null, 'action', 'skipped', 'matched_on', null,
          'reason', 'Not allowed: a Salesperson can only add leads credited to and owned by themselves');
      when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation then
        return jsonb_build_object('lead_id', null, 'action', 'skipped', 'matched_on', null, 'reason', sqlerrm);
    end;
  end if;

  v_id := (v_match ->> 'lead_id')::uuid;
  v_on := v_match ->> 'matched_on';

  if v_mode = 'skip' then
    return jsonb_build_object('lead_id', v_id, 'action', 'skipped', 'matched_on', v_on, 'reason', 'Already a lead');
  end if;

  -- merge: fill what's empty, never overwrite.
  begin
    update public.leads l set
      contact_name    = coalesce(nullif(btrim(l.contact_name), ''), nullif(btrim(r.contact_name), '')),
      title           = coalesce(nullif(btrim(l.title), ''), nullif(btrim(r.title), '')),
      email           = coalesce(l.email, r.email),
      phone           = coalesce(nullif(btrim(l.phone), ''), nullif(btrim(r.phone), '')),
      website         = coalesce(nullif(btrim(l.website), ''), nullif(btrim(r.website), '')),
      address         = coalesce(nullif(btrim(l.address), ''), nullif(btrim(r.address), '')),
      city            = coalesce(nullif(btrim(l.city), ''), nullif(btrim(r.city), '')),
      state           = coalesce(nullif(btrim(l.state), ''), nullif(btrim(r.state), '')),
      industry        = coalesce(nullif(btrim(l.industry), ''), nullif(btrim(r.industry), '')),
      category        = coalesce(nullif(btrim(l.category), ''), nullif(btrim(r.category), '')),
      source_detail   = coalesce(nullif(btrim(l.source_detail), ''), nullif(btrim(r.source_detail), '')),
      maps_url        = coalesce(nullif(btrim(l.maps_url), ''), nullif(btrim(r.maps_url), '')),
      website_status  = coalesce(nullif(btrim(l.website_status), ''), nullif(btrim(r.website_status), '')),
      contact_info    = coalesce(nullif(btrim(l.contact_info), ''), nullif(btrim(r.contact_info), '')),
      notes           = coalesce(nullif(btrim(l.notes), ''), nullif(btrim(r.notes), '')),
      next_action     = coalesce(nullif(btrim(l.next_action), ''), nullif(btrim(r.next_action), '')),
      next_action_at  = coalesce(l.next_action_at, r.next_action_at),
      google_place_id = coalesce(l.google_place_id, r.google_place_id),
      rating          = coalesce(l.rating, r.rating),
      review_count    = coalesce(l.review_count, r.review_count),
      scan_tags       = coalesce(l.scan_tags, r.scan_tags),
      lead_score      = coalesce(l.lead_score, r.lead_score),
      priority_score  = coalesce(l.priority_score, r.priority_score),
      audit           = coalesce(l.audit, r.audit),
      audit_at        = case when l.audit is null then r.audit_at else l.audit_at end,
      uses_servicetitan = l.uses_servicetitan or coalesce(r.uses_servicetitan, false),
      wheaton_alum    = l.wheaton_alum or coalesce(r.wheaton_alum, false),
      branch_fit      = l.branch_fit || array(
                          select distinct b from unnest(coalesce(r.branch_fit, '{}')) b
                          where b <> all (l.branch_fit)),
      external_ids    = coalesce(r.external_ids, '{}'::jsonb) || l.external_ids
    where l.id = v_id
    returning l.id into v_upd;
  exception
    when unique_violation or check_violation or invalid_text_representation then
      return jsonb_build_object('lead_id', v_id, 'action', 'skipped', 'matched_on', v_on, 'reason', sqlerrm);
  end;

  if v_upd is null then
    return jsonb_build_object('lead_id', v_id, 'action', 'skipped', 'matched_on', v_on,
                              'reason', 'Owned by someone else');
  end if;
  return jsonb_build_object('lead_id', v_id, 'action', 'merged', 'matched_on', v_on, 'reason', null);
end;
$$;

-- p = {"mode": "skip" | "merge", "leads": [{...}, ...]} (at most 500; send
-- bigger lists in chunks). Leads run in order in one transaction, so a later
-- row matches an earlier one from the same batch.
-- Returns {inserted, merged, skipped, results: [{index, lead_id, action,
-- matched_on, reason}]}.
create or replace function public.upsert_leads(p jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_mode    text := coalesce(p ->> 'mode', 'skip');
  v_results jsonb := '[]'::jsonb;
  v_el      jsonb;
  v_i       bigint;
  v_res     jsonb;
  v_ins     int := 0;
  v_mer     int := 0;
  v_skip    int := 0;
begin
  if jsonb_typeof(p -> 'leads') is distinct from 'array' then
    raise exception 'upsert_leads: "leads" must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p -> 'leads') > 500 then
    raise exception 'upsert_leads: at most 500 leads per call' using errcode = '22023';
  end if;

  for v_el, v_i in select e, n - 1 from jsonb_array_elements(p -> 'leads') with ordinality as t(e, n) loop
    begin
      v_res := public.upsert_lead(jsonb_build_object('mode', v_mode, 'lead', v_el));
    exception when others then
      v_res := jsonb_build_object('lead_id', null, 'action', 'skipped', 'matched_on', null, 'reason', sqlerrm);
    end;
    case v_res ->> 'action'
      when 'inserted' then v_ins := v_ins + 1;
      when 'merged'   then v_mer := v_mer + 1;
      else                 v_skip := v_skip + 1;
    end case;
    v_results := v_results || jsonb_build_array(jsonb_build_object('index', v_i) || v_res);
  end loop;

  return jsonb_build_object('inserted', v_ins, 'merged', v_mer, 'skipped', v_skip, 'results', v_results);
end;
$$;

-- ===========================================================================
-- e) Grants. The app (authenticated) calls these over RPC; anon and public
-- get nothing. The helpers need execute too because invoker functions run
-- them as the caller. The trigger function keeps no grants (016 pattern).

revoke all on function public.lead_norm_email(text) from public, anon;
revoke all on function public.lead_norm_domain(text) from public, anon;
revoke all on function public.lead_norm_phone(text) from public, anon;
revoke all on function public.find_lead_match(jsonb) from public, anon;
revoke all on function public.find_lead_matches(jsonb) from public, anon;
revoke all on function public.upsert_lead(jsonb) from public, anon;
revoke all on function public.upsert_leads(jsonb) from public, anon;

grant execute on function public.lead_norm_email(text) to authenticated;
grant execute on function public.lead_norm_domain(text) to authenticated;
grant execute on function public.lead_norm_phone(text) to authenticated;
grant execute on function public.find_lead_match(jsonb) to authenticated;
grant execute on function public.find_lead_matches(jsonb) to authenticated;
grant execute on function public.upsert_lead(jsonb) to authenticated;
grant execute on function public.upsert_leads(jsonb) to authenticated;

revoke all on function public.leads_normalize() from public, anon, authenticated;

commit;
