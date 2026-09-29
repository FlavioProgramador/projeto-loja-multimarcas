-- Garante que o cadastro pelo Supabase Auth tambem receba acesso inicial a loja.
-- O papel sempre nasce como EMPLOYEE; elevacao de privilegio continua exclusiva de ADMIN.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id uuid;
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    'EMPLOYEE'
  )
  ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        email = EXCLUDED.email,
        updated_at = now();

  SELECT s.id
    INTO v_store_id
    FROM public.stores s
   WHERE s.is_active = true
   ORDER BY s.created_at ASC, s.id ASC
   LIMIT 1;

  IF v_store_id IS NOT NULL THEN
    INSERT INTO public.user_store_access (user_id, store_id, role, is_active)
    VALUES (NEW.id, v_store_id, 'EMPLOYEE', true)
    ON CONFLICT (user_id, store_id) DO UPDATE
      SET is_active = true;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Regulariza usuarios ativos que ja possuem perfil, mas ficaram sem loja
-- antes desta correcao.
DO $$
DECLARE
  v_store_id uuid;
BEGIN
  SELECT s.id
    INTO v_store_id
    FROM public.stores s
   WHERE s.is_active = true
   ORDER BY s.created_at ASC, s.id ASC
   LIMIT 1;

  IF v_store_id IS NOT NULL THEN
    INSERT INTO public.user_store_access (user_id, store_id, role, is_active)
    SELECT p.id, v_store_id, p.role, true
      FROM public.profiles p
     WHERE p.is_active = true
       AND NOT EXISTS (
         SELECT 1
           FROM public.user_store_access usa
          WHERE usa.user_id = p.id
            AND usa.is_active = true
       )
    ON CONFLICT (user_id, store_id) DO UPDATE
      SET is_active = true;
  END IF;
END;
$$;
