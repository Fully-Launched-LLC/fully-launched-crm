-- 023: Sales call logging.
--   not_available: we reached someone, but not the decision maker (a
--     gatekeeper). Logged as cold_call / outbound / not_available. The 017
--     touch trigger needs no change: an outbound touch with this outcome
--     moves the status to contacted (rank-based), like a call with no answer.
--   lead_touches.details: structured extras the timeline reads back.
--     Not available: {"spoke_with": "Crystal", "role": "front desk", "email": "..."}
--     Emailed:       {"to": "hello@business.com"}
--
-- Applied with Supabase MCP apply_migration.

alter table public.lead_touches drop constraint lead_touches_outcome_check;
alter table public.lead_touches add constraint lead_touches_outcome_check
  check (outcome in ('sent', 'no_answer', 'no_reply', 'replied', 'interested', 'not_interested',
                     'bad_fit', 'bounced', 'meeting_booked', 'meeting_held', 'not_available'));

alter table public.lead_touches add column details jsonb;
