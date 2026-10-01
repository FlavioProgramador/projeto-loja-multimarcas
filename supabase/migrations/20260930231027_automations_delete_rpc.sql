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
    raise exception 'Apenas administradores podem excluir automações.';
  end if;

  delete from public.automation_rules
   where id = p_automation_id
     and store_id = p_store_id;

  if not found then
    raise exception 'Automação não encontrada.';
  end if;

  return jsonb_build_object(
    'success', true,
    'id', p_automation_id
  );
end;
$$;

revoke all on function public.delete_automation_rule(uuid, uuid) from public, anon;
grant execute on function public.delete_automation_rule(uuid, uuid) to authenticated;