-- Social production days are opt-in per social line item. Only when a social
-- item has it: the deal's production fields show, are required for approval,
-- and the SOW keeps [[social_production]] and [[social_travel]].
-- Changing it is a content change (deal_line_items_changed resets an approved
-- deal to draft, like any line item edit).
alter table public.deal_line_items
  add column includes_production_days boolean not null default false;

-- Earn-up: 10% of deal value (Nov 9).
alter table public.deal_settings alter column earn_up_pct set default 10;
update public.deal_settings set earn_up_pct = 10 where id;
