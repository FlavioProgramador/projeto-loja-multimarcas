create index if not exists idx_mp_webhook_events_unprocessed_received
  on public.mp_webhook_events (received_at desc)
  where processed_at is null;

create index if not exists idx_payments_provider_status_updated
  on public.payments (provider, status, updated_at desc);

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
          and p.updated_at < now() - interval '15 minutes'
      ) as stale_15m,
      count(*) filter (
        where p.provider = 'MERCADO_PAGO'
          and p.status = 'PENDING'
          and p.updated_at < now() - interval '60 minutes'
      ) as stale_60m
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
    'pix_stale_15m', pix.stale_15m,
    'pix_stale_60m', pix.stale_60m,
    'status',
      case
        when webhook.failed_total > 0 or webhook.stuck_total > 0 or pix.stale_60m > 0 then 'critical'
        when pix.stale_15m > 0 then 'warning'
        else 'ok'
      end
  )
  from webhook, pix;
$$;

revoke all on function public.get_pix_operational_health(integer) from public;
revoke all on function public.get_pix_operational_health(integer) from anon;
revoke all on function public.get_pix_operational_health(integer) from authenticated;
grant execute on function public.get_pix_operational_health(integer) to service_role;
