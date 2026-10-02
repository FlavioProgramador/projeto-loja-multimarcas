create index if not exists idx_automation_rules_created_by on public.automation_rules(created_by);
create index if not exists idx_automation_rules_updated_by on public.automation_rules(updated_by);

alter table public.automation_events
  add column if not exists idempotency_key text;

create unique index if not exists uq_automation_events_idempotency
  on public.automation_events(store_id, idempotency_key)
  where idempotency_key is not null;