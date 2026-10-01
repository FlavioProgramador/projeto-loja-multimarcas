create table if not exists public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  request_type text not null check (request_type in ('ACCESS','CORRECTION','ANONYMIZATION','DELETION')),
  status text not null default 'OPEN' check (status in ('OPEN','IN_REVIEW','COMPLETED','REJECTED')),
  notes text,
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  resolved_by uuid references auth.users(id) on delete restrict,
  resolved_at timestamptz
);

alter table public.privacy_requests enable row level security;

create index if not exists idx_privacy_requests_store_status
  on public.privacy_requests (store_id, status, requested_at desc);

create index if not exists idx_privacy_requests_customer
  on public.privacy_requests (customer_id, requested_at desc);

create or replace function public.create_privacy_request(
  p_store_id uuid,
  p_customer_id uuid,
  p_request_type text,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  if not public.has_store_access(p_store_id) then
    raise exception 'store access denied';
  end if;

  v_role := public.get_user_store_role(p_store_id);
  if v_role not in ('ADMIN', 'MANAGER') then
    raise exception 'privacy request management requires ADMIN or MANAGER role';
  end if;

  if upper(coalesce(p_request_type, '')) not in ('ACCESS','CORRECTION','ANONYMIZATION','DELETION') then
    raise exception 'invalid request type';
  end if;

  if not exists (
    select 1 from public.customers c
    where c.id = p_customer_id and c.store_id = p_store_id
  ) then
    raise exception 'customer not found in store';
  end if;

  insert into public.privacy_requests (
    store_id, customer_id, request_type, notes, requested_by
  )
  values (
    p_store_id, p_customer_id, upper(p_request_type), nullif(btrim(p_notes), ''), v_user_id
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.check_customer_anonymization_eligibility(
  p_store_id uuid,
  p_customer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_pending_sales integer;
  v_pending_returns integer;
  v_open_requests integer;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  if not public.has_store_access(p_store_id) then
    raise exception 'store access denied';
  end if;

  v_role := public.get_user_store_role(p_store_id);
  if v_role not in ('ADMIN', 'MANAGER') then
    raise exception 'eligibility check requires ADMIN or MANAGER role';
  end if;

  if not exists (
    select 1 from public.customers c
    where c.id = p_customer_id and c.store_id = p_store_id
  ) then
    raise exception 'customer not found in store';
  end if;

  select count(*) into v_pending_sales
  from public.sales
  where store_id = p_store_id
    and customer_id = p_customer_id
    and status = 'PENDING';

  select count(*) into v_pending_returns
  from public.returns
  where store_id = p_store_id
    and customer_id = p_customer_id
    and status not in ('COMPLETED','CANCELLED');

  select count(*) into v_open_requests
  from public.privacy_requests
  where store_id = p_store_id
    and customer_id = p_customer_id
    and status in ('OPEN','IN_REVIEW');

  return jsonb_build_object(
    'eligible_operationally', v_pending_sales = 0 and v_pending_returns = 0,
    'pending_sales', v_pending_sales,
    'pending_returns', v_pending_returns,
    'open_privacy_requests', v_open_requests,
    'requires_retention_policy_review', true
  );
end;
$$;

revoke all on table public.privacy_requests from public, anon, authenticated;
grant select on table public.privacy_requests to service_role;

revoke all on function public.create_privacy_request(uuid,uuid,text,text) from public, anon;
grant execute on function public.create_privacy_request(uuid,uuid,text,text) to authenticated, service_role;

revoke all on function public.check_customer_anonymization_eligibility(uuid,uuid) from public, anon;
grant execute on function public.check_customer_anonymization_eligibility(uuid,uuid) to authenticated, service_role;
