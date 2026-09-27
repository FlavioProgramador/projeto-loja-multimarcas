CREATE OR REPLACE FUNCTION public.admin_set_user_role(p_target_user_id uuid, p_new_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_caller_role text;
  v_target_id uuid;
BEGIN
  v_caller_role := (SELECT role FROM public.profiles WHERE id=auth.uid() AND is_active=true);
  IF v_caller_role <> 'ADMIN' THEN
    RAISE EXCEPTION 'Permissão negada: apenas ADMIN pode alterar papéis de usuário.';
  END IF;
  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário alvo é obrigatório.';
  END IF;
  IF p_new_role NOT IN ('ADMIN','MANAGER','CASHIER','EMPLOYEE') THEN
    RAISE EXCEPTION 'Role inválida: %', p_new_role;
  END IF;
  IF p_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Administrador não pode alterar o próprio papel.';
  END IF;
  UPDATE public.profiles
  SET role=p_new_role, updated_at=now()
  WHERE id=p_target_user_id AND is_active=true
  RETURNING id INTO v_target_id;
  IF v_target_id IS NULL THEN
    RAISE EXCEPTION 'Usuário alvo não encontrado ou inativo.';
  END IF;
  RETURN jsonb_build_object('success',true,'user_id',v_target_id,'new_role',p_new_role);
END;
$function$;