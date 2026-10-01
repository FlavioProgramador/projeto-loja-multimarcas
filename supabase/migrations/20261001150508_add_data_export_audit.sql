create table if not exists public.data_export_audit (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  export_type text not null,
  resource text not null,
  record_count integer not null default 0 check (record_count >= 0),
  contains_pii boolean not null default false,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.data_export_audit enable row level security;

create index if not exists idx_data_export_audit_store_created
  on public.data_export_audit (store_id, created_at desc);

create index if not exists idx_data_export_audit_user_created
  on public.data_export_audit (user_id, created_at desc);

create or replace function public.log_data_export(
  p_store_id uuid,
  p_export_type text,
  p_resource text,
  p_record_count integer default 0,
  p_contains_pii boolean default false,
  p_filters jsonb default '{}'::jsonb
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

  if coalesce(p_contains_pii, false) and v_role not in ('ADMIN', 'MANAGER') then
    raise exception 'PII export requires ADMIN or MANAGER role';
  end if;

  if nullif(btrim(p_export_type), '') is null or nullif(btrim(p_resource), '') is null then
    raise exception 'export type and resource are required';
  end if;

  insert into public.data_export_audit (
    store_id, user_id, export_type, resource, record_count, contains_pii, filters
  )
  values (
    p_store_id,
    v_user_id,
    btrim(p_export_type),
    btrim(p_resource),
    greatest(coalesce(p_record_count, 0), 0),
    coalesce(p_contains_pii, false),
    coalesce(p_filters, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on table public.data_export_audit from public, anon, authenticated;
grant select on table public.data_export_audit to service_role;

revoke all on function public.log_data_export(uuid,text,text,integer,boolean,jsonb) from public;
revoke all on function public.log_data_export(uuid,text,text,integer,boolean,jsonb) from anon;
grant execute on function public.log_data_export(uuid,text,text,integer,boolean,jsonb) to authenticated;
grant execute on function public.log_data_export(uuid,text,text,integer,boolean,jsonb) to service_role;
