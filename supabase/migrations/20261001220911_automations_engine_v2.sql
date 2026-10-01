
alter table public.automation_rules
  add column if not exists archived_at timestamptz null,
  add column if not exists archived_by uuid null references public.profiles(id) on delete set null;

alter table public.automation_events
  add column if not exists automation_id uuid null references public.automation_rules(id) on delete set null,
  add column if not exists processed_at timestamptz null,
  add column if not exists processing_error text null;

alter table public.automation_events
  drop constraint if exists automation_events_unique;

create index if not exists idx_automation_rules_due
  on public.automation_rules(status, next_run_at, priority desc)
  where archived_at is null and status = 'ACTIVE';

create index if not exists idx_automation_events_pending
  on public.automation_events(store_id, event_type, created_at)
  where processed_at is null and automation_id is null;

create index if not exists idx_automation_events_automation_created
  on public.automation_events(automation_id, created_at desc)
  where automation_id is not null;

revoke delete on public.automation_rules from authenticated;

create or replace function public.automation_next_run(
  p_trigger text,
  p_schedule text,
  p_timezone text,
  p_from timestamptz default now()
)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  v_tz text := coalesce(nullif(p_timezone, ''), 'America/Sao_Paulo');
  v_local timestamp;
  v_candidate timestamp;
  v_hour int;
  v_minute int;
begin
  if p_schedule is null then
    return null;
  end if;

  if p_schedule !~ '^[0-2][0-9]:[0-5][0-9]$'
     or split_part(p_schedule, ':', 1)::int > 23 then
    raise exception 'Horário inválido. Use HH:MM.';
  end if;

  v_hour := split_part(p_schedule, ':', 1)::int;
  v_minute := split_part(p_schedule, ':', 2)::int;
  v_local := p_from at time zone v_tz;
  v_candidate := date_trunc('day', v_local)
    + make_interval(hours => v_hour, mins => v_minute);

  if v_candidate <= v_local then
    if p_trigger = 'REPORT_WEEKLY' then
      v_candidate := v_candidate + interval '7 days';
    elsif p_trigger = 'REPORT_MONTHLY' then
      v_candidate := v_candidate + interval '1 month';
    else
      v_candidate := v_candidate + interval '1 day';
    end if;
  end if;

  return v_candidate at time zone v_tz;
end;
$$;

create or replace function public.evaluate_automation_rule(
  p_automation_id uuid,
  p_source_event jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  r public.automation_rules%rowtype;
  v_threshold int;
  v_matched bigint := 0;
  v_period_start timestamptz;
  v_period_end timestamptz := now();
  v_total numeric := 0;
  v_sales bigint := 0;
  v_summary jsonb := '{}'::jsonb;
  v_role text;
begin
  select * into r
  from public.automation_rules
  where id = p_automation_id
    and archived_at is null;

  if not found then
    raise exception 'Automação não encontrada.';
  end if;

  if auth.uid() is not null then
    v_role := public.get_user_store_role(r.store_id);
    if v_role is null then
      raise exception 'Acesso negado.';
    end if;
  end if;

  select case
           when (item->>'value') ~ '^[0-9]+$' then (item->>'value')::int
           else null
         end
    into v_threshold
  from jsonb_array_elements(coalesce(r.conditions, '[]'::jsonb)) item
  where item->>'field' in ('threshold','quantity','days_to_due','days_overdue','days_inactive')
  limit 1;

  if r.trigger_type = 'LOW_STOCK' then
    select count(*) into v_matched
    from public.store_inventory si
    join public.product_variants pv on pv.id = si.product_variant_id
    where si.store_id = r.store_id
      and si.quantity > 0
      and si.quantity <= coalesce(v_threshold, si.minimum_stock, pv.minimum_stock, 0);

    v_summary := jsonb_build_object(
      'message', 'Itens abaixo do estoque mínimo.',
      'threshold_override', v_threshold
    );

  elsif r.trigger_type = 'OUT_OF_STOCK' then
    select count(*) into v_matched
    from public.store_inventory si
    where si.store_id = r.store_id
      and si.quantity <= 0;

    v_summary := jsonb_build_object('message', 'Itens sem estoque.');

  elsif r.trigger_type = 'EXPENSE_DUE' then
    v_threshold := coalesce(v_threshold, 3);
    select count(*) into v_matched
    from public.fixed_expenses fe
    where fe.store_id = r.store_id
      and coalesce(fe.paid, false) = false
      and fe.due_date >= current_date
      and fe.due_date <= current_date + v_threshold;

    v_summary := jsonb_build_object(
      'message', 'Despesas próximas do vencimento.',
      'days', v_threshold
    );

  elsif r.trigger_type = 'EXPENSE_OVERDUE' then
    v_threshold := coalesce(v_threshold, 1);
    select count(*) into v_matched
    from public.fixed_expenses fe
    where fe.store_id = r.store_id
      and coalesce(fe.paid, false) = false
      and fe.due_date <= current_date - v_threshold;

    v_summary := jsonb_build_object(
      'message', 'Despesas vencidas.',
      'minimum_days_overdue', v_threshold
    );

  elsif r.trigger_type = 'CUSTOMER_INACTIVE' then
    v_threshold := coalesce(v_threshold, 90);
    select count(*) into v_matched
    from public.customers c
    where c.store_id = r.store_id
      and coalesce(c.is_active, true)
      and not exists (
        select 1
        from public.sales s
        where s.store_id = r.store_id
          and s.customer_id = c.id
          and s.status = 'COMPLETED'
          and s.completed_at >= now() - make_interval(days => v_threshold)
      );

    v_summary := jsonb_build_object(
      'message', 'Clientes sem compra no período.',
      'days', v_threshold
    );

  elsif r.trigger_type = 'PRODUCT_INACTIVE' then
    v_threshold := coalesce(v_threshold, 60);
    select count(distinct p.id) into v_matched
    from public.products p
    join public.product_variants pv on pv.product_id = p.id
    join public.store_inventory si
      on si.product_variant_id = pv.id and si.store_id = r.store_id
    where coalesce(p.is_active, true)
      and not exists (
        select 1
        from public.sale_items sii
        join public.sales s on s.id = sii.sale_id
        where sii.product_id = p.id
          and s.store_id = r.store_id
          and s.status = 'COMPLETED'
          and s.completed_at >= now() - make_interval(days => v_threshold)
      );

    v_summary := jsonb_build_object(
      'message', 'Produtos sem giro no período.',
      'days', v_threshold
    );

  elsif r.trigger_type in ('REPORT_DAILY','REPORT_WEEKLY','REPORT_MONTHLY') then
    if r.trigger_type = 'REPORT_WEEKLY' then
      v_period_start := now() - interval '7 days';
    elsif r.trigger_type = 'REPORT_MONTHLY' then
      v_period_start := date_trunc('month', now());
    else
      v_period_start := date_trunc('day', now());
    end if;

    select count(*), coalesce(sum(total), 0)
      into v_sales, v_total
    from public.sales
    where store_id = r.store_id
      and status = 'COMPLETED'
      and completed_at >= v_period_start
      and completed_at <= v_period_end;

    v_matched := 1;
    v_summary := jsonb_build_object(
      'message', 'Resumo de vendas preparado.',
      'period_start', v_period_start,
      'period_end', v_period_end,
      'sales_count', v_sales,
      'sales_total', v_total
    );

  elsif r.trigger_type in ('SALE_COMPLETED','SALE_CANCELLED','RETURN_COMPLETED') then
    if p_source_event is not null then
      v_matched := 1;
      v_summary := jsonb_build_object(
        'message', 'Evento de negócio disponível para processamento.',
        'source_event', p_source_event
      );
    else
      v_matched := 0;
      v_summary := jsonb_build_object(
        'message', 'Esta automação depende de um evento real de negócio.'
      );
    end if;

  else
    v_matched := 0;
    v_summary := jsonb_build_object(
      'message', 'Gatilho ainda não possui avaliador específico.'
    );
  end if;

  return jsonb_build_object(
    'eligible', v_matched > 0,
    'matched_count', v_matched,
    'trigger', r.trigger_type,
    'summary', v_summary
  );
end;
$$;

create or replace function public.execute_automation_rule(
  p_automation_id uuid,
  p_idempotency_key text,
  p_mode text default 'scheduled',
  p_source_event_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.automation_rules%rowtype;
  v_run_id uuid;
  v_started timestamptz := clock_timestamp();
  v_last_success timestamptz;
  v_eval jsonb;
  v_source jsonb;
  v_action jsonb;
  v_action_type text;
  v_action_index int := 0;
  v_event_type text;
  v_status text := 'COMPLETED';
  v_reason text;
begin
  select * into r
  from public.automation_rules
  where id = p_automation_id
    and status = 'ACTIVE'
    and archived_at is null;

  if not found then
    return jsonb_build_object('success', false, 'status', 'SKIPPED', 'reason', 'inactive_or_archived');
  end if;

  insert into public.automation_runs(
    automation_id, store_id, event_type, event_id, reference_id,
    idempotency_key, status, result, started_at
  )
  values (
    r.id, r.store_id, r.trigger_type,
    case when p_source_event_id is not null then p_source_event_id::text else null end,
    null, p_idempotency_key, 'RUNNING',
    jsonb_build_object('mode', p_mode), v_started
  )
  on conflict (automation_id, store_id, idempotency_key) do nothing
  returning id into v_run_id;

  if v_run_id is null then
    return jsonb_build_object('success', true, 'status', 'SKIPPED', 'reason', 'duplicate');
  end if;

  select max(finished_at) into v_last_success
  from public.automation_runs
  where automation_id = r.id
    and id <> v_run_id
    and status = 'COMPLETED';

  if r.cooldown_minutes > 0
     and v_last_success is not null
     and v_last_success > now() - make_interval(mins => r.cooldown_minutes) then
    v_status := 'SKIPPED';
    v_reason := 'cooldown';
  else
    if p_source_event_id is not null then
      select jsonb_build_object(
        'id', e.id,
        'event_type', e.event_type,
        'reference_id', e.reference_id,
        'payload', e.payload,
        'created_at', e.created_at
      )
      into v_source
      from public.automation_events e
      where e.id = p_source_event_id;
    end if;

    v_eval := public.evaluate_automation_rule(r.id, v_source);

    if not coalesce((v_eval->>'eligible')::boolean, false) then
      v_status := 'SKIPPED';
      v_reason := 'conditions_not_met';
    else
      for v_action in
        select value
        from jsonb_array_elements(coalesce(r.actions, '[]'::jsonb))
      loop
        v_action_index := v_action_index + 1;
        v_action_type := coalesce(v_action->>'type', 'AUDIT');

        v_event_type := case v_action_type
          when 'CREATE_ALERT' then 'ALERT'
          when 'CREATE_NOTIFICATION' then 'NOTIFICATION'
          when 'REQUEST_INTERVENTION' then 'INTERVENTION'
          when 'GENERATE_REPORT' then 'REPORT_READY'
          else 'AUDIT'
        end;

        insert into public.automation_events(
          store_id, automation_id, event_type, reference_id,
          idempotency_key, payload, processed_at
        )
        values (
          r.store_id,
          r.id,
          v_event_type,
          null,
          format('action:%s:%s', v_run_id, v_action_index),
          jsonb_build_object(
            'automation_id', r.id,
            'automation_name', r.name,
            'trigger', r.trigger_type,
            'action', v_action_type,
            'matched_count', coalesce((v_eval->>'matched_count')::bigint, 0),
            'summary', coalesce(v_eval->'summary', '{}'::jsonb),
            'source_event_id', p_source_event_id
          ),
          now()
        )
        on conflict do nothing;
      end loop;
    end if;
  end if;

  update public.automation_runs
  set status = v_status,
      result = jsonb_build_object(
        'success', v_status <> 'FAILED',
        'mode', p_mode,
        'reason', v_reason,
        'evaluation', coalesce(v_eval, '{}'::jsonb)
      ),
      finished_at = clock_timestamp(),
      duration_ms = round(extract(epoch from (clock_timestamp() - v_started)) * 1000)::bigint
  where id = v_run_id;

  update public.automation_rules
  set last_run_at = now(),
      next_run_at = case
        when schedule is null then null
        else public.automation_next_run(trigger_type, schedule, timezone, coalesce(next_run_at, now()))
      end,
      execution_count = execution_count + case when v_status = 'COMPLETED' then 1 else 0 end,
      updated_at = now()
  where id = r.id;

  return jsonb_build_object(
    'success', true,
    'status', v_status,
    'reason', v_reason,
    'run_id', v_run_id,
    'evaluation', coalesce(v_eval, '{}'::jsonb)
  );

exception
  when others then
    if v_run_id is not null then
      update public.automation_runs
      set status = 'FAILED',
          error_message = sqlerrm,
          finished_at = clock_timestamp(),
          duration_ms = round(extract(epoch from (clock_timestamp() - v_started)) * 1000)::bigint
      where id = v_run_id;
    end if;

    update public.automation_rules
    set failure_count = failure_count + 1,
        last_run_at = now(),
        next_run_at = case
          when schedule is null then null
          else public.automation_next_run(trigger_type, schedule, timezone, coalesce(next_run_at, now()))
        end,
        updated_at = now()
    where id = p_automation_id;

    return jsonb_build_object('success', false, 'status', 'FAILED', 'error', sqlerrm);
end;
$$;

drop function if exists public.create_automation_rule(uuid,text,text,text,text,jsonb,jsonb,integer,integer,text);
drop function if exists public.update_automation_rule(uuid,uuid,text,text,text,text,jsonb,jsonb,integer,integer,text);

create or replace function public.create_automation_rule(
  p_store_id uuid,
  p_name text,
  p_description text default '',
  p_category text default 'SISTEMA',
  p_trigger text default 'REPORT_DAILY',
  p_conditions jsonb default '[]'::jsonb,
  p_actions jsonb default '[]'::jsonb,
  p_priority integer default 100,
  p_cooldown_minutes integer default 0,
  p_schedule text default null,
  p_timezone text default 'America/Sao_Paulo'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_next timestamptz;
begin
  if public.get_user_store_role(p_store_id) not in ('ADMIN','MANAGER') then
    raise exception 'Acesso negado.';
  end if;

  if p_schedule is not null then
    v_next := public.automation_next_run(p_trigger, p_schedule, p_timezone, now());
  end if;

  insert into public.automation_rules(
    store_id,name,description,category,trigger_type,conditions,actions,status,priority,
    cooldown_minutes,schedule,timezone,created_by,updated_by,next_run_at
  )
  values (
    p_store_id,btrim(p_name),coalesce(p_description,''),p_category,p_trigger,
    coalesce(p_conditions,'[]'::jsonb),coalesce(p_actions,'[]'::jsonb),'PAUSED',
    p_priority,p_cooldown_minutes,p_schedule,coalesce(nullif(p_timezone,''),'America/Sao_Paulo'),
    (select auth.uid()),(select auth.uid()),v_next
  )
  returning id into v_id;

  return jsonb_build_object('success',true,'id',v_id,'next_run_at',v_next);
end;
$$;

create or replace function public.update_automation_rule(
  p_store_id uuid,
  p_automation_id uuid,
  p_name text,
  p_description text,
  p_category text,
  p_trigger text,
  p_conditions jsonb,
  p_actions jsonb,
  p_priority integer,
  p_cooldown_minutes integer,
  p_schedule text,
  p_timezone text default 'America/Sao_Paulo'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_next timestamptz;
begin
  if public.get_user_store_role(p_store_id) not in ('ADMIN','MANAGER') then
    raise exception 'Acesso negado.';
  end if;

  if p_schedule is not null then
    v_next := public.automation_next_run(p_trigger, p_schedule, p_timezone, now());
  end if;

  update public.automation_rules
  set name=btrim(p_name),
      description=coalesce(p_description,''),
      category=p_category,
      trigger_type=p_trigger,
      conditions=coalesce(p_conditions,'[]'::jsonb),
      actions=coalesce(p_actions,'[]'::jsonb),
      priority=p_priority,
      cooldown_minutes=p_cooldown_minutes,
      schedule=p_schedule,
      timezone=coalesce(nullif(p_timezone,''),'America/Sao_Paulo'),
      next_run_at=v_next,
      updated_by=(select auth.uid()),
      updated_at=now()
  where id=p_automation_id
    and store_id=p_store_id
    and archived_at is null;

  if not found then
    raise exception 'Automação não encontrada.';
  end if;

  return jsonb_build_object('success',true,'id',p_automation_id,'next_run_at',v_next);
end;
$$;

create or replace function public.set_automation_rule_status(
  p_store_id uuid,
  p_automation_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  r public.automation_rules%rowtype;
  v_next timestamptz;
begin
  if public.get_user_store_role(p_store_id) not in ('ADMIN','MANAGER') then
    raise exception 'Acesso negado.';
  end if;

  if p_status not in ('ACTIVE','PAUSED') then
    raise exception 'Status inválido.';
  end if;

  select * into r
  from public.automation_rules
  where id=p_automation_id and store_id=p_store_id and archived_at is null;

  if not found then
    raise exception 'Automação não encontrada.';
  end if;

  if p_status = 'ACTIVE' and r.schedule is not null then
    v_next := public.automation_next_run(r.trigger_type, r.schedule, r.timezone, now());
  end if;

  update public.automation_rules
  set status=p_status,
      next_run_at=case when p_status='ACTIVE' then v_next else null end,
      updated_by=(select auth.uid()),
      updated_at=now()
  where id=p_automation_id and store_id=p_store_id;

  return jsonb_build_object('success',true,'status',p_status,'next_run_at',v_next);
end;
$$;

create or replace function public.delete_automation_rule(
  p_store_id uuid,
  p_automation_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
begin
  if public.get_user_store_role(p_store_id) <> 'ADMIN' then
    raise exception 'Apenas administradores podem arquivar automações.';
  end if;

  update public.automation_rules
  set status='PAUSED',
      next_run_at=null,
      archived_at=now(),
      archived_by=(select auth.uid()),
      updated_by=(select auth.uid()),
      updated_at=now()
  where id=p_automation_id
    and store_id=p_store_id
    and archived_at is null;

  if not found then
    raise exception 'Automação não encontrada.';
  end if;

  return jsonb_build_object('success',true,'id',p_automation_id,'archived',true);
end;
$$;

create or replace function public.test_automation_rule(
  p_store_id uuid,
  p_automation_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  r public.automation_rules%rowtype;
  v_event jsonb;
  v_eval jsonb;
  v_last_success timestamptz;
  v_in_cooldown boolean := false;
begin
  if public.get_user_store_role(p_store_id) not in ('ADMIN','MANAGER') then
    raise exception 'Acesso negado.';
  end if;

  select * into r
  from public.automation_rules
  where id=p_automation_id
    and store_id=p_store_id
    and archived_at is null;

  if not found then
    raise exception 'Automação não encontrada.';
  end if;

  if r.trigger_type in ('SALE_COMPLETED','SALE_CANCELLED','RETURN_COMPLETED') then
    select jsonb_build_object(
      'id', e.id,
      'event_type', e.event_type,
      'reference_id', e.reference_id,
      'payload', e.payload,
      'created_at', e.created_at
    )
    into v_event
    from public.automation_events e
    where e.store_id = r.store_id
      and e.event_type = r.trigger_type
      and e.automation_id is null
    order by e.created_at desc
    limit 1;
  end if;

  v_eval := public.evaluate_automation_rule(r.id, v_event);

  select max(finished_at) into v_last_success
  from public.automation_runs
  where automation_id = r.id and status = 'COMPLETED';

  v_in_cooldown := r.cooldown_minutes > 0
    and v_last_success is not null
    and v_last_success > now() - make_interval(mins => r.cooldown_minutes);

  return jsonb_build_object(
    'success', true,
    'dry_run', true,
    'rule_id', r.id,
    'eligible', coalesce((v_eval->>'eligible')::boolean, false),
    'matched_count', coalesce((v_eval->>'matched_count')::bigint, 0),
    'evaluation', v_eval,
    'in_cooldown', v_in_cooldown,
    'next_run_at', r.next_run_at,
    'message', case
      when v_in_cooldown then 'A regra atende às condições, mas está no intervalo de cooldown.'
      when coalesce((v_eval->>'eligible')::boolean, false) then 'A regra seria executada. Nenhuma ação foi realizada.'
      else 'A regra não seria executada com os dados atuais.'
    end
  );
end;
$$;

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
  e public.automation_events%rowtype;
  v_result jsonb;
  v_scheduled int := 0;
  v_events int := 0;
  v_failed int := 0;
  v_event_failed boolean;
begin
  update public.automation_rules
  set next_run_at = public.automation_next_run(trigger_type, schedule, timezone, now())
  where status='ACTIVE'
    and archived_at is null
    and schedule is not null
    and next_run_at is null
    and (p_store_id is null or store_id=p_store_id);

  for r in
    select *
    from public.automation_rules
    where status='ACTIVE'
      and archived_at is null
      and schedule is not null
      and next_run_at <= now()
      and (p_store_id is null or store_id=p_store_id)
    order by priority desc, next_run_at, created_at
    limit 200
  loop
    v_result := public.execute_automation_rule(
      r.id,
      format('schedule:%s:%s', r.id, to_char(r.next_run_at at time zone 'UTC','YYYYMMDDHH24MISS')),
      p_mode,
      null
    );

    v_scheduled := v_scheduled + 1;
    if v_result->>'status' = 'FAILED' then
      v_failed := v_failed + 1;
    end if;
  end loop;

  for e in
    select *
    from public.automation_events
    where automation_id is null
      and processed_at is null
      and event_type in ('SALE_COMPLETED','SALE_CANCELLED','RETURN_COMPLETED','LOW_STOCK','OUT_OF_STOCK')
      and (p_store_id is null or store_id=p_store_id)
    order by created_at
    limit 200
  loop
    v_event_failed := false;

    for r in
      select *
      from public.automation_rules
      where store_id=e.store_id
        and status='ACTIVE'
        and archived_at is null
        and trigger_type=e.event_type
      order by priority desc, created_at
    loop
      v_result := public.execute_automation_rule(
        r.id,
        format('event:%s:%s', e.id, r.id),
        'event',
        e.id
      );

      if v_result->>'status' = 'FAILED' then
        v_event_failed := true;
        v_failed := v_failed + 1;
      end if;
    end loop;

    if v_event_failed then
      update public.automation_events
      set processing_error='Uma ou mais regras falharam no processamento.'
      where id=e.id;
    else
      update public.automation_events
      set processed_at=now(), processing_error=null
      where id=e.id;
    end if;

    v_events := v_events + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'mode', p_mode,
    'scheduled_processed', v_scheduled,
    'events_processed', v_events,
    'failed', v_failed
  );
end;
$$;

create or replace function public.enqueue_sales_automation_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
begin
  if new.status = 'COMPLETED'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    v_type := 'SALE_COMPLETED';
  elsif new.status = 'CANCELLED'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    v_type := 'SALE_CANCELLED';
  else
    return new;
  end if;

  insert into public.automation_events(
    store_id,event_type,reference_id,idempotency_key,payload
  )
  values (
    new.store_id,
    v_type,
    new.id,
    format('business:sale:%s:%s', new.id, new.status),
    jsonb_build_object(
      'sale_id', new.id,
      'sale_number', new.sale_number,
      'status', new.status,
      'total', new.total,
      'customer_id', new.customer_id,
      'completed_at', new.completed_at
    )
  )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists trg_sales_automation_event on public.sales;
create trigger trg_sales_automation_event
after insert or update of status on public.sales
for each row execute function public.enqueue_sales_automation_event();

create or replace function public.enqueue_returns_automation_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'CONCLUIDO'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into public.automation_events(
      store_id,event_type,reference_id,idempotency_key,payload
    )
    values (
      new.store_id,
      'RETURN_COMPLETED',
      new.id,
      format('business:return:%s:%s', new.id, new.status),
      jsonb_build_object(
        'return_id', new.id,
        'return_number', new.return_number,
        'original_sale_id', new.original_sale_id,
        'total_amount', new.total_amount,
        'resolution_type', new.resolution_type
      )
    )
    on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_returns_automation_event on public.returns;
create trigger trg_returns_automation_event
after insert or update of status on public.returns
for each row execute function public.enqueue_returns_automation_event();

create or replace function public.enqueue_inventory_automation_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min int;
  v_old_qty int;
  v_type text;
begin
  v_min := coalesce(new.minimum_stock, 0);
  v_old_qty := case when tg_op='UPDATE' then old.quantity else null end;

  if new.quantity <= 0
     and (tg_op='INSERT' or coalesce(v_old_qty, 1) > 0) then
    v_type := 'OUT_OF_STOCK';
  elsif new.quantity > 0
     and new.quantity <= v_min
     and (tg_op='INSERT' or coalesce(v_old_qty, v_min + 1) > v_min) then
    v_type := 'LOW_STOCK';
  else
    return new;
  end if;

  insert into public.automation_events(
    store_id,event_type,reference_id,idempotency_key,payload
  )
  values (
    new.store_id,
    v_type,
    new.id,
    format('inventory:%s:%s:%s', new.id, v_type, txid_current()),
    jsonb_build_object(
      'inventory_id', new.id,
      'product_variant_id', new.product_variant_id,
      'quantity', new.quantity,
      'minimum_stock', v_min
    )
  )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists trg_inventory_automation_event on public.store_inventory;
create trigger trg_inventory_automation_event
after insert or update of quantity, minimum_stock on public.store_inventory
for each row execute function public.enqueue_inventory_automation_event();

revoke all on function public.automation_next_run(text,text,text,timestamptz) from public, anon;
grant execute on function public.automation_next_run(text,text,text,timestamptz) to authenticated, service_role;

revoke all on function public.evaluate_automation_rule(uuid,jsonb) from public, anon;
grant execute on function public.evaluate_automation_rule(uuid,jsonb) to authenticated, service_role;

revoke all on function public.execute_automation_rule(uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.execute_automation_rule(uuid,text,text,uuid) to service_role;

revoke all on function public.create_automation_rule(uuid,text,text,text,text,jsonb,jsonb,integer,integer,text,text) from public, anon;
grant execute on function public.create_automation_rule(uuid,text,text,text,text,jsonb,jsonb,integer,integer,text,text) to authenticated;

revoke all on function public.update_automation_rule(uuid,uuid,text,text,text,text,jsonb,jsonb,integer,integer,text,text) from public, anon;
grant execute on function public.update_automation_rule(uuid,uuid,text,text,text,text,jsonb,jsonb,integer,integer,text,text) to authenticated;

revoke all on function public.set_automation_rule_status(uuid,uuid,text) from public, anon;
grant execute on function public.set_automation_rule_status(uuid,uuid,text) to authenticated;

revoke all on function public.delete_automation_rule(uuid,uuid) from public, anon;
grant execute on function public.delete_automation_rule(uuid,uuid) to authenticated;

revoke all on function public.test_automation_rule(uuid,uuid) from public, anon;
grant execute on function public.test_automation_rule(uuid,uuid) to authenticated;

revoke all on function public.run_automation_cycle(uuid,text) from public, anon, authenticated;
grant execute on function public.run_automation_cycle(uuid,text) to service_role;

revoke all on function public.enqueue_sales_automation_event() from public, anon, authenticated;
revoke all on function public.enqueue_returns_automation_event() from public, anon, authenticated;
revoke all on function public.enqueue_inventory_automation_event() from public, anon, authenticated;
