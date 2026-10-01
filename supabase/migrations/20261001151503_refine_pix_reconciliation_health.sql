create or replace function public.list_stale_pix_reconciliation_candidates(
  p_older_than_minutes integer default 60
)
returns table(
  sale_id uuid,
  payment_id uuid,
  store_id uuid,
  provider text,
  provider_transaction_id text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select s.id, p.id, s.store_id, p.provider, p.provider_transaction_id, s.created_at
  from public.sales s
  join public.payments p on p.sale_id = s.id
  where s.status = 'PENDING'
    and p.method = 'PIX'
    and p.provider = 'MERCADO_PAGO'
    and p.status = 'PENDING'
    and nullif(btrim(p.provider_transaction_id), '') is not null
    and s.created_at <= now() - make_interval(mins => greatest(1, p_older_than_minutes))
  order by s.created_at asc;
$$;

revoke all on function public.list_stale_pix_reconciliation_candidates(integer) from public, anon, authenticated;
grant execute on function public.list_stale_pix_reconciliation_candidates(integer) to service_role;

create or replace function public.get_pix_operational_health(p_window_minutes integer default 60)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with bounds as (
    select now() - make_interval(mins => greatest(coalesce(p_window_minutes, 60), 1)) as since
  ),
  webhook as (
    select
      count(*) filter (where received_at >= bounds.since) as received_window,
      count(*) filter (where processed_at is null) as unprocessed_total,
      count(*) filter (where processed_at is null and last_error is not null) as failed_total,
      count(*) filter (
        where processed_at is null
          and processing_started_at is not null
          and processing_started_at < now() - interval '5 minutes'
      ) as stuck_total,
      coalesce(max(attempts), 0) as max_attempts
    from public.mp_webhook_events, bounds
  ),
  pix as (
    select
      count(*) filter (
        where p.provider = 'MERCADO_PAGO' and p.status = 'PENDING'
      ) as pending_total,
      count(*) filter (
        where p.provider = 'MERCADO_PAGO'
          and p.status = 'PENDING'
          and p.updated_at < now() - interval '60 minutes'
      ) as stale_60m,
      count(*) filter (
        where p.provider = 'MERCADO_PAGO'
          and p.status = 'PENDING'
          and p.updated_at < now() - interval '24 hours'
      ) as stale_24h
    from public.payments p
  )
  select jsonb_build_object(
    'checked_at', now(),
    'window_minutes', greatest(coalesce(p_window_minutes, 60), 1),
    'webhooks_received_window', webhook.received_window,
    'webhooks_unprocessed_total', webhook.unprocessed_total,
    'webhooks_failed_total', webhook.failed_total,
    'webhooks_stuck_total', webhook.stuck_total,
    'webhook_max_attempts', webhook.max_attempts,
    'pix_pending_total', pix.pending_total,
    'pix_stale_60m', pix.stale_60m,
    'pix_stale_24h', pix.stale_24h,
    'status',
      case
        when webhook.failed_total > 0 or webhook.stuck_total > 0 or pix.stale_24h > 0 then 'critical'
        when pix.stale_60m > 0 then 'warning'
        else 'ok'
      end
  )
  from webhook, pix;
$$;

revoke all on function public.get_pix_operational_health(integer) from public, anon, authenticated;
grant execute on function public.get_pix_operational_health(integer) to service_role;
