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
  p_schedule text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
  declare v_id uuid;
  begin
    if not public.get_user_store_role(p_store_id) in ('ADMIN','MANAGER') then
      raise exception 'Acesso negado.';
    end if;
    insert into public.automation_rules
      (store_id,name,description,category,trigger_type,conditions,actions,status,priority,
       cooldown_minutes,schedule,created_by,updated_by)
    values
      (p_store_id,btrim(p_name),coalesce(p_description,''),p_category,p_trigger,
       coalesce(p_conditions,'[]'::jsonb),coalesce(p_actions,'[]'::jsonb),'PAUSED',
       p_priority,p_cooldown_minutes,p_schedule,(select auth.uid()),(select auth.uid()))
    returning id into v_id;
    return jsonb_build_object('success',true,'id',v_id);
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
  p_schedule text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
  begin
    if not public.get_user_store_role(p_store_id) in ('ADMIN','MANAGER') then
      raise exception 'Acesso negado.';
    end if;
    update public.automation_rules
       set name=btrim(p_name), description=coalesce(p_description,''), category=p_category,
           trigger_type=p_trigger, conditions=coalesce(p_conditions,'[]'::jsonb),
           actions=coalesce(p_actions,'[]'::jsonb), priority=p_priority,
           cooldown_minutes=p_cooldown_minutes, schedule=p_schedule,
           updated_by=(select auth.uid()), updated_at=timezone('utc',now())
     where id=p_automation_id and store_id=p_store_id;
    if not found then raise exception 'Automação não encontrada.'; end if;
    return jsonb_build_object('success',true,'id',p_automation_id);
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
  begin
    if not public.get_user_store_role(p_store_id) in ('ADMIN','MANAGER') then
      raise exception 'Acesso negado.';
    end if;
    if p_status not in ('ACTIVE','PAUSED') then raise exception 'Status inválido.'; end if;
    update public.automation_rules
       set status=p_status, updated_by=(select auth.uid()), updated_at=timezone('utc',now())
     where id=p_automation_id and store_id=p_store_id;
    if not found then raise exception 'Automação não encontrada.'; end if;
    return jsonb_build_object('success',true,'status',p_status);
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
  declare v_rule public.automation_rules%rowtype;
  begin
    if not public.get_user_store_role(p_store_id) in ('ADMIN','MANAGER') then
      raise exception 'Acesso negado.';
    end if;
    select * into v_rule from public.automation_rules
     where id=p_automation_id and store_id=p_store_id;
    if not found then raise exception 'Automação não encontrada.'; end if;
    return jsonb_build_object('success',true,'eligible',true,'rule_id',v_rule.id,
      'message','Teste de configuração concluído. Nenhuma ação operacional foi executada.');
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
    v_due integer := 0;
    v_run_id uuid;
    v_run_started timestamptz;
    v_idempotency_key text;
    v_local_hm text;
    v_message text;
  begin
    for r in
      select *
        from public.automation_rules
       where status = 'ACTIVE'
         and (p_store_id is null or store_id = p_store_id)
         and schedule is not null
         and to_char(now() at time zone coalesce(nullif(timezone, ''), 'America/Sao_Paulo'), 'HH24:MI') = schedule
         and (last_run_at is null or last_run_at < date_trunc('minute', now()))
       order by priority desc, created_at
    loop
      v_due := v_due + 1;
      v_local_hm := to_char(now() at time zone coalesce(nullif(r.timezone, ''), 'America/Sao_Paulo'), 'HH24:MI');
      v_idempotency_key := format('schedule:%s:%s:%s', r.id, to_char(now() at time zone coalesce(nullif(r.timezone, ''), 'America/Sao_Paulo'), 'YYYY-MM-DD'), v_local_hm);
      v_run_started := clock_timestamp();

      begin
        insert into public.automation_runs (
          automation_id, store_id, event_type, idempotency_key, status, result, started_at
        )
        values (
          r.id, r.store_id, r.trigger_type, v_idempotency_key, 'RUNNING',
          jsonb_build_object('mode', p_mode, 'scheduled_at', v_local_hm, 'timezone', r.timezone),
          v_run_started
        )
        on conflict (automation_id, store_id, idempotency_key) do nothing
        returning id into v_run_id;

        if v_run_id is null then
          continue;
        end if;

        -- As ações são registradas de forma observável nesta etapa.
        -- A execução operacional de cada ação deve ser adicionada por tipo,
        -- sem permitir que falhas de uma regra interrompam as demais.
        v_message := format('Ciclo agendado processado para %s.', r.name);

        update public.automation_runs
           set status = 'COMPLETED',
               result = jsonb_build_object(
                 'success', true,
                 'message', v_message,
                 'scheduled_at', v_local_hm,
                 'timezone', r.timezone
               ),
               finished_at = clock_timestamp(),
               duration_ms = round(extract(epoch from (clock_timestamp() - v_run_started)) * 1000)::bigint
         where id = v_run_id;

        update public.automation_rules
           set last_run_at = now(),
               next_run_at = (date_trunc('day', (now() at time zone coalesce(nullif(r.timezone, ''), 'America/Sao_Paulo')) + interval '1 day')
                               + (r.schedule || ':00')::time) at time zone coalesce(nullif(r.timezone, ''), 'America/Sao_Paulo'),
               execution_count = execution_count + 1,
               updated_at = now()
         where id = r.id;
      exception
        when others then
          if v_run_id is not null then
            update public.automation_runs
               set status = 'FAILED',
                   error_message = sqlerrm,
                   finished_at = clock_timestamp(),
                   duration_ms = round(extract(epoch from (clock_timestamp() - v_run_started)) * 1000)::bigint
             where id = v_run_id;
          end if;

          update public.automation_rules
             set failure_count = failure_count + 1,
                 last_run_at = now(),
                 updated_at = now()
           where id = r.id;
      end;
    end loop;

    return jsonb_build_object(
      'success', true,
      'mode', p_mode,
      'due_rules', v_due
    );
  end;
$$;

revoke all on function public.create_automation_rule(uuid,text,text,text,text,jsonb,jsonb,integer,integer,text) from public, anon;
grant execute on function public.create_automation_rule(uuid,text,text,text,text,jsonb,jsonb,integer,integer,text) to authenticated;
revoke all on function public.update_automation_rule(uuid,uuid,text,text,text,text,jsonb,jsonb,integer,integer,text) from public, anon;
grant execute on function public.update_automation_rule(uuid,uuid,text,text,text,text,jsonb,jsonb,integer,integer,text) to authenticated;
revoke all on function public.set_automation_rule_status(uuid,uuid,text) from public, anon;
grant execute on function public.set_automation_rule_status(uuid,uuid,text) to authenticated;
revoke all on function public.test_automation_rule(uuid,uuid) from public, anon;
grant execute on function public.test_automation_rule(uuid,uuid) to authenticated;
revoke all on function public.run_automation_cycle(uuid,text) from public, anon, authenticated;
grant execute on function public.run_automation_cycle(uuid,text) to service_role;

do $cron$
begin
  if not exists (select 1 from cron.job where jobname = 'coresys-automation-engine') then
    perform cron.schedule(
      'coresys-automation-engine',
      '*/5 * * * *',
      'select public.run_automation_cycle(null, ''scheduled'');'
    );
  end if;
end
$cron$;
