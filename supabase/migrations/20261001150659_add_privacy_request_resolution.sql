create or replace function public.resolve_privacy_request(
  p_store_id uuid,
  p_request_id uuid,
  p_status text,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_status text := upper(coalesce(p_status, ''));
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  if not public.has_store_access(p_store_id) then
    raise exception 'store access denied';
  end if;

  v_role := public.get_user_store_role(p_store_id);
  if v_role not in ('ADMIN', 'MANAGER') then
    raise exception 'privacy request resolution requires ADMIN or MANAGER role';
  end if;

  if v_status not in ('IN_REVIEW','COMPLETED','REJECTED') then
    raise exception 'invalid privacy request status';
  end if;

  update public.privacy_requests
  set
    status = v_status,
    notes = coalesce(nullif(btrim(p_notes), ''), notes),
    resolved_by = case when v_status in ('COMPLETED','REJECTED') then v_user_id else null end,
    resolved_at = case when v_status in ('COMPLETED','REJECTED') then now() else null end
  where id = p_request_id
    and store_id = p_store_id;

  if not found then
    raise exception 'privacy request not found in store';
  end if;
end;
$$;

revoke all on function public.resolve_privacy_request(uuid,uuid,text,text) from public, anon;
grant execute on function public.resolve_privacy_request(uuid,uuid,text,text) to authenticated, service_role;
