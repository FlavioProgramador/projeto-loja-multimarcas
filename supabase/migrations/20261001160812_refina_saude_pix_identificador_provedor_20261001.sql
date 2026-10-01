create or replace function public.get_pix_operational_health(p_window_minutes integer default 60)
returns jsonb
language sql
stable
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
        where p.method ilike '%PIX%' and p.status in ('PENDING','PENDING_PAYMENT')
      ) as pending_all,
      count(*) filter (
        where p.provider = 'MERCADO_PAGO'
          and p.status = 'PENDING'
          and nullif(btrim(p.provider_transaction_id), '') is not null
      ) as pending_reconcilable,
      count(*) filter (
        where p.method ilike '%PIX%'
          and p.status in ('PENDING','PENDING_PAYMENT')
          and nullif(btrim(p.provider_transaction_id), '') is null
      ) as pending_without_provider_id,
      count(*) filter (
        where p.provider = 'MERCADO_PAGO'
          and p.status = 'PENDING'
          and nullif(btrim(p.provider_transaction_id), '') is not null
          and p.updated_at < now() - interval '60 minutes'
      ) as stale_60m,
      count(*) filter (
        where p.provider = 'MERCADO_PAGO'
          and p.status = 'PENDING'
          and nullif(btrim(p.provider_transaction_id), '') is not null
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
    'pix_pending_total', pix.pending_all,
    'pix_pending_reconcilable', pix.pending_reconcilable,
    'pix_pending_without_provider_id', pix.pending_without_provider_id,
    'pix_stale_60m', pix.stale_60m,
    'pix_stale_24h', pix.stale_24h,
    'status',
      case
        when webhook.failed_total > 0 or webhook.stuck_total > 0 or pix.stale_24h > 0 then 'critical'
        when pix.stale_60m > 0 or pix.pending_without_provider_id > 0 then 'warning'
        else 'ok'
      end
  )
  from webhook, pix;
$$;

revoke all on function public.get_pix_operational_health(integer) from public, anon, authenticated;
grant execute on function public.get_pix_operational_health(integer) to service_role;
