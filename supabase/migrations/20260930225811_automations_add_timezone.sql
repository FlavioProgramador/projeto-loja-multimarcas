alter table public.automation_rules
    add column if not exists timezone text not null default 'America/Sao_Paulo'
    check (timezone = any (array['America/Sao_Paulo','America/Manaus','America/Belem','America/Fortaleza']));

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
declare v_id uuid;
begin
  if public.get_user_store_role(p_store_id) not in ('ADMIN','MANAGER') then
    raise exception 'Acesso negado.';
  end if;

  if p_schedule is not null and p_schedule !~ '^[0-2][0-9]:[0-5][0-9]$' then
    raise exception 'Horário inválido. Use HH:MM.';
  end if;
  if p_schedule is not null and split_part(p_schedule, ':', 1)::integer > 23 then
    raise exception 'Horário inválido. Use HH:MM.';
  end if;

  insert into public.automation_rules
    (store_id,name,description,category,trigger_type,conditions,actions,status,priority,
     cooldown_minutes,schedule,timezone,created_by,updated_by)
  values
    (p_store_id,btrim(p_name),coalesce(p_description,''),p_category,p_trigger,
     coalesce(p_conditions,'[]'::jsonb),coalesce(p_actions,'[]'::jsonb),'PAUSED',
     p_priority,p_cooldown_minutes,p_schedule,p_timezone,(select auth.uid()),(select auth.uid()))
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
  p_schedule text,
  p_timezone text default 'America/Sao_Paulo'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
begin
  if public.get_user_store_role(p_store_id) not in ('ADMIN','MANAGER') then
    raise exception 'Acesso negado.';
  end if;

  if p_schedule is not null and p_schedule !~ '^[0-2][0-9]:[0-5][0-9]$' then
    raise exception 'Horário inválido. Use HH:MM.';
  end if;
  if p_schedule is not null and split_part(p_schedule, ':', 1)::integer > 23 then
    raise exception 'Horário inválido. Use HH:MM.';
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
         timezone=p_timezone,
         updated_by=(select auth.uid()),
         updated_at=timezone('utc',now())
   where id=p_automation_id
     and store_id=p_store_id;

  if not found then
    raise exception 'Automação não encontrada.';
  end if;

  return jsonb_build_object('success',true,'id',p_automation_id);
end;
$$;

revoke all on function public.create_automation_rule(uuid,text,text,text,text,jsonb,jsonb,integer,integer,text) from public, anon;
revoke all on function public.create_automation_rule(uuid,text,text,text,text,jsonb,jsonb,integer,integer,text,text) from public, anon;
grant execute on function public.create_automation_rule(uuid,text,text,text,text,jsonb,jsonb,integer,integer,text,text) to authenticated;

revoke all on function public.update_automation_rule(uuid,uuid,text,text,text,text,jsonb,jsonb,integer,integer,text) from public, anon;
revoke all on function public.update_automation_rule(uuid,uuid,text,text,text,text,jsonb,jsonb,integer,integer,text,text) from public, anon;
grant execute on function public.update_automation_rule(uuid,uuid,text,text,text,text,jsonb,jsonb,integer,integer,text,text) to authenticated;