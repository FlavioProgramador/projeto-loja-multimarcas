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
    v_count integer := 0;
  begin
    for r in
      select * from public.automation_rules
       where status='ACTIVE'
         and (p_store_id is null or store_id=p_store_id)
       order by priority desc, created_at
    loop
      v_count := v_count + 1;
      -- A execução de ações será adicionada somente após validação do catálogo de ações.
      -- Este ciclo mantém o scheduler seguro e não toca em dados operacionais.
    end loop;
    return jsonb_build_object('success',true,'mode',p_mode,'active_rules',v_count);
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
