create or replace function public.list_stale_pix_reconciliation_candidates(p_older_than_minutes integer default 60)
returns table(sale_id uuid, payment_id uuid, store_id uuid, provider text, provider_transaction_id text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select s.id, p.id, s.store_id, p.provider, p.provider_transaction_id, s.created_at
  from public.sales s
  join public.payments p on p.sale_id = s.id
  where s.status = 'PENDING'
    and p.method = 'PIX'
    and p.status = 'PENDING'
    and s.created_at <= now() - make_interval(mins => greatest(1, p_older_than_minutes))
  order by s.created_at asc;
$$;

revoke all on function public.list_stale_pix_reconciliation_candidates(integer) from public, anon, authenticated;
grant execute on function public.list_stale_pix_reconciliation_candidates(integer) to service_role;

comment on function public.list_stale_pix_reconciliation_candidates(integer) is
'Lists stale pending PIX payments for trusted reconciliation workers. It does not mutate sales, payments, inventory, or financial data. External provider status must be checked before approval/cancellation.';
