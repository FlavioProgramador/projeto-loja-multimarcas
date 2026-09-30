-- CoreSys automation foundation.
-- No existing business data is modified or deleted.
create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 120),
  description text not null default '',
  category text not null check (category in ('ESTOQUE','VENDAS','FINANCEIRO','CLIENTES','PRODUTOS','SISTEMA','RELATORIOS')),
  trigger_type text not null,
  conditions jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  status text not null default 'PAUSED' check (status in ('ACTIVE','PAUSED')),
  priority integer not null default 100 check (priority between 0 and 1000),
  cooldown_minutes integer not null default 0 check (cooldown_minutes >= 0),
  schedule text null,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_run_at timestamptz null,
  next_run_at timestamptz null,
  execution_count bigint not null default 0 check (execution_count >= 0),
  failure_count bigint not null default 0 check (failure_count >= 0)
);

create index if not exists idx_automation_rules_store_status
  on public.automation_rules(store_id, status, priority desc);
create index if not exists idx_automation_rules_store_trigger
  on public.automation_rules(store_id, trigger_type);

alter table public.automation_rules enable row level security;

create policy automation_rules_select
on public.automation_rules
for select to authenticated
using (public.has_store_access(store_id));

create policy automation_rules_insert
on public.automation_rules
for insert to authenticated
with check (
  public.get_user_store_role(store_id) in ('ADMIN','MANAGER')
  and created_by = (select auth.uid())
  and updated_by = (select auth.uid())
);

create policy automation_rules_update
on public.automation_rules
for update to authenticated
using (public.get_user_store_role(store_id) in ('ADMIN','MANAGER'))
with check (
  public.get_user_store_role(store_id) in ('ADMIN','MANAGER')
  and updated_by = (select auth.uid())
);

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automation_rules(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  event_type text not null,
  event_id text null,
  reference_id uuid null,
  idempotency_key text not null,
  status text not null default 'RUNNING' check (status in ('RUNNING','COMPLETED','FAILED','SKIPPED')),
  result jsonb null,
  error_message text null,
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz null,
  duration_ms bigint null check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  constraint automation_runs_idempotency_unique unique (automation_id, store_id, idempotency_key)
);

create index if not exists idx_automation_runs_store_started
  on public.automation_runs(store_id, started_at desc);
create index if not exists idx_automation_runs_automation_started
  on public.automation_runs(automation_id, started_at desc);

alter table public.automation_runs enable row level security;

create policy automation_runs_select
on public.automation_runs
for select to authenticated
using (public.has_store_access(store_id));

create table if not exists public.automation_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  event_type text not null,
  reference_id uuid null,
  idempotency_key text null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint automation_events_unique unique (store_id, event_type, reference_id)
);
create unique index if not exists uq_automation_events_idempotency
  on public.automation_events(store_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_automation_events_store_created
  on public.automation_events(store_id, created_at desc);

alter table public.automation_events enable row level security;

create policy automation_events_select
on public.automation_events
for select to authenticated
using (public.has_store_access(store_id));

create policy automation_rules_delete
on public.automation_rules
for delete to authenticated
using (public.get_user_store_role(store_id) = 'ADMIN');

revoke all on public.automation_rules from anon;
revoke all on public.automation_runs from anon;
revoke all on public.automation_events from anon;
