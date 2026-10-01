create or replace function public.run_automation_cycle(
  p_store_id uuid default null,
  p_mode text default 'scheduled'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.automation_rules%rowtype;
  v_due integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_run_id uuid;
  v_run_started timestamptz;
  v_idempotency_key text;
  v_local_hm text;
  v_local_date text;
  v_next_day date;
  v_message text;
begin
  for r in
    select *
    from public.automation_rules
    where status = 'ACTIVE'
      and (p_store_id is null or store_id = p_store_id)
      and schedule is not null
      and regexp_like(schedule, '^[0-2][0-9]:[0-5][0-9]$')
      and (
        to_char(now() at time zone coalesce(nullif(timezone, ''), 'America/Sao_Paulo'), 'HH24:MI') = schedule
      )
      and (
        last_run_at is null
        or last_run_at < date_trunc('minute', now())
      )
    order by priority desc, created_at
  loop
    v_local_hm := to_char(now() at time zone coalesce(nullif(r.timezone, ''), 'America/Sao_Paulo'), 'HH24:MI');
    v_local_date := to_char(now() at time zone coalesce(nullif(r.timezone, ''), 'America/Sao_Paulo'), 'YYYY-MM-DD');
    v_idempotency_key := format('schedule:%s:%s:%s', r.id, v_local_date, v_local_hm);
    v_run_started := clock_timestamp();
    v_run_id := null;

    begin
      insert into public.automation_runs (
        automation_id,
        store_id,
        event_type,
        idempotency_key,
        status,
        result,
        started_at
      )
      values (
        r.id,
        r.store_id,
        r.trigger_type,
        v_idempotency_key,
        'RUNNING',
        jsonb_build_object(
          'mode', p_mode,
          'scheduled_at', v_local_hm,
          'timezone', r.timezone
        ),
        v_run_started
      )
      on conflict (automation_id, store_id, idempotency_key) do nothing
      returning id into v_run_id;

      if v_run_id is null then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      begin
        if r.trigger_type in ('LOW_STOCK', 'OUT_OF_STOCK') then
          insert into public.automation_events (
            store_id,
            event_type,
            idempotency_key,
            payload
          )
          values (
            r.store_id,
            'NOTIFICATION',
            v_idempotency_key,
            jsonb_build_object(
              'automation_id', r.id,
              'automation_name', r.name,
              'title', r.name,
              'message', case
                when r.trigger_type = 'OUT_OF_STOCK'
                  then 'Existem itens sem estoque que precisam de reposição.'
                else 'Existem itens abaixo do estoque mínimo.'
              end,
              'trigger', r.trigger_type,
              'scheduled_at', v_local_hm,
              'timezone', r.timezone
            )
          )
          on conflict (store_id, event_type, reference_id) do nothing;
        elsif r.trigger_type in ('EXPENSE_DUE', 'EXPENSE_OVERDUE') then
          insert into public.automation_events (
            store_id,
            event_type,
            idempotency_key,
            payload
          )
          values (
            r.store_id,
            'NOTIFICATION',
            v_idempotency_key,
            jsonb_build_object(
              'automation_id', r.id,
              'automation_name', r.name,
              'title', r.name,
              'message', case
                when r.trigger_type = 'EXPENSE_OVERDUE'
                  then 'Existem despesas vencidas que precisam de atenção.'
                else 'Existem despesas próximas do vencimento.'
              end,
              'trigger', r.trigger_type,
              'scheduled_at', v_local_hm,
              'timezone', r.timezone
            )
          )
          on conflict (store_id, event_type, reference_id) do nothing;
        elsif r.trigger_type in ('REPORT_DAILY', 'REPORT_WEEKLY', 'REPORT_MONTHLY') then
          insert into public.automation_events (
            store_id,
            event_type,
            idempotency_key,
            payload
          )
          values (
            r.store_id,
            'NOTIFICATION',
            v_idempotency_key,
            jsonb_build_object(
              'automation_id', r.id,
              'automation_name', r.name,
              'title', r.name,
              'message', 'Automação de relatório executada.',
              'trigger', r.trigger_type,
              'scheduled_at', v_local_hm,
              'timezone', r.timezone
            )
          )
          on conflict (store_id, event_type, reference_id) do nothing;
        else
          insert into public.automation_events (
            store_id,
            event_type,
            idempotency_key,
            payload
          )
          values (
            r.store_id,
            'AUDIT',
            v_idempotency_key,
            jsonb_build_object(
              'automation_id', r.id,
              'automation_name', r.name,
              'message', 'Automação executada.',
              'trigger', r.trigger_type,
              'scheduled_at', v_local_hm,
              'timezone', r.timezone
            )
          )
          on conflict (store_id, event_type, reference_id) do nothing;
        end if;

        v_message := format('Automação "%s" executada com sucesso.', r.name);

        update public.automation_runs
        set status = 'COMPLETED',
            result = jsonb_build_object(
              'success', true,
              'message', v_message,
              'scheduled_at', v_local_hm,
              'timezone', r.timezone
            ),
            finished_at = clock_timestamp(),
            duration_ms = round(
              extract(epoch from (clock_timestamp() - v_run_started)) * 1000
            )::bigint
        where id = v_run_id;

        v_next_day := (
          (now() at time zone coalesce(nullif(r.timezone, ''), 'America/Sao_Paulo'))::date
          + case
              when r.trigger_type = 'REPORT_WEEKLY' then 7
              when r.trigger_type = 'REPORT_MONTHLY' then
                extract(day from (date_trunc('month',
                  (now() at time zone coalesce(nullif(r.timezone, ''), 'America/Sao_Paulo'))
                  + interval '1 month'
                ) + interval '1 month - 1 day'))::integer + 1
              else 1
            end
        );

        update public.automation_rules
        set last_run_at = now(),
            next_run_at = make_timestamptz(
              extract(year from v_next_day)::int,
              extract(month from v_next_day)::int,
              extract(day from v_next_day)::int,
              split_part(r.schedule, ':', 1)::int,
              split_part(r.schedule, ':', 2)::int,
              0,
              coalesce(nullif(r.timezone, ''), 'America/Sao_Paulo')
            ),
            execution_count = execution_count + 1,
            updated_at = now()
        where id = r.id;
      exception
        when others then
          v_failed := v_failed + 1;
          update public.automation_runs
          set status = 'FAILED',
              error_message = sqlerrm,
              finished_at = clock_timestamp(),
              duration_ms = round(
                extract(epoch from (clock_timestamp() - v_run_started)) * 1000
              )::bigint
          where id = v_run_id;

          update public.automation_rules
          set failure_count = failure_count + 1,
              last_run_at = now(),
              updated_at = now()
          where id = r.id;
      end;
    exception
      when others then
        v_failed := v_failed + 1;
        update public.automation_rules
        set failure_count = failure_count + 1,
            last_run_at = now(),
            updated_at = now()
        where id = r.id;
    end;

    v_due := v_due + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'mode', p_mode,
    'due_rules', v_due,
    'skipped', v_skipped,
    'failed', v_failed
  );
end;
$$;