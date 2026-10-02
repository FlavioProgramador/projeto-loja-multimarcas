-- CoreSys administrative store-access mutation.
-- Authorization is server-side: only an active ADMIN can create/update a user's
-- active/inactive relationship with an active store.

CREATE OR REPLACE FUNCTION public.admin_set_user_store_access(
  p_target_user_id uuid,
  p_store_id uuid,
  p_role text,
  p_is_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_store_active boolean;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id=v_caller AND is_active=true AND role='ADMIN'
  ) THEN
    RAISE EXCEPTION 'Permissão negada.';
  END IF;

  IF p_target_user_id IS NULL OR p_store_id IS NULL THEN
    RAISE EXCEPTION 'Usuário e loja são obrigatórios.';
  END IF;

  IF p_role IS NULL OR p_role NOT IN ('ADMIN','MANAGER','CASHIER','EMPLOYEE') THEN
    RAISE EXCEPTION 'Role inválida.';
  END IF;

  SELECT is_active INTO v_store_active
  FROM public.stores
  WHERE id=p_store_id;

  IF COALESCE(v_store_active,false)=false THEN
    RAISE EXCEPTION 'Loja inválida ou inativa.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id=p_target_user_id AND is_active=true
  ) THEN
    RAISE EXCEPTION 'Usuário alvo inexistente ou inativo.';
  END IF;

  INSERT INTO public.user_store_access(user_id,store_id,role,is_active)
  VALUES(p_target_user_id,p_store_id,p_role,COALESCE(p_is_active,true))
  ON CONFLICT (user_id,store_id)
  DO UPDATE SET role=EXCLUDED.role,is_active=EXCLUDED.is_active;

  RETURN jsonb_build_object(
    'success',true,
    'user_id',p_target_user_id,
    'store_id',p_store_id,
    'role',p_role,
    'is_active',COALESCE(p_is_active,true)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_store_access(uuid,uuid,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_store_access(uuid,uuid,text,boolean) TO authenticated;
