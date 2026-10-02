
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
    if v_role not in ('ADMIN','MANAGER') then
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

  if not exists (
    select 1
    from public.automation_rules ar
    where ar.store_id = new.store_id
      and ar.status = 'ACTIVE'
      and ar.archived_at is null
      and ar.trigger_type = v_type
  ) then
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

create or replace function public.enqueue_returns_automation_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'CONCLUIDO'
     or not (tg_op = 'INSERT' or old.status is distinct from new.status) then
    return new;
  end if;

  if not exists (
    select 1
    from public.automation_rules ar
    where ar.store_id = new.store_id
      and ar.status = 'ACTIVE'
      and ar.archived_at is null
      and ar.trigger_type = 'RETURN_COMPLETED'
  ) then
    return new;
  end if;

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

  return new;
end;
$$;

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

  if not exists (
    select 1
    from public.automation_rules ar
    where ar.store_id = new.store_id
      and ar.status = 'ACTIVE'
      and ar.archived_at is null
      and ar.trigger_type = v_type
  ) then
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
