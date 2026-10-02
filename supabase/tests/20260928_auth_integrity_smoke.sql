-- CoreSys auth/integrity smoke tests.
-- All business writes are wrapped in transactions and rolled back.
-- Requires at least one active ADMIN and the current active store.

BEGIN;

-- O banco local do CI não possui usuários de Auth por padrão. Criamos fixtures
-- transacionais e determinísticas; todo o bloco é revertido no ROLLBACK final.
DO $$
DECLARE
  v_admin uuid := '00000000-0000-0000-0000-00000000a001';
  v_employee uuid := '00000000-0000-0000-0000-00000000a002';
  v_store uuid;
BEGIN
  SELECT s.id INTO v_store
  FROM public.stores s
  WHERE s.is_active
  ORDER BY coalesce(s.is_main, false) DESC, s.created_at, s.id
  LIMIT 1;

  IF v_store IS NULL THEN
    RAISE EXCEPTION 'Fixture de loja ausente para smoke tests.';
  END IF;

  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_admin, 'smoke-admin@coresys.test', '{"full_name":"Smoke Admin"}'::jsonb, now(), now()),
    (v_employee, 'smoke-employee@coresys.test', '{"full_name":"Smoke Employee"}'::jsonb, now(), now())
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.profiles
     SET role='ADMIN', is_active=true
   WHERE id=v_admin;

  UPDATE public.profiles
     SET role='EMPLOYEE', is_active=true
   WHERE id=v_employee;

  INSERT INTO public.user_store_access(user_id, store_id, role, is_active)
  VALUES
    (v_admin, v_store, 'ADMIN', true),
    (v_employee, v_store, 'EMPLOYEE', true)
  ON CONFLICT (user_id, store_id)
  DO UPDATE SET role=excluded.role, is_active=true;
END $$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_admin uuid := '00000000-0000-0000-0000-00000000a001';
  v_employee uuid := '00000000-0000-0000-0000-00000000a002';
  v_store uuid;
  v_variant uuid;
  v_claims text;
  v_before_store integer;
  v_before_global integer;
  v_after_store integer;
  v_after_global integer;
  v_inventory_id uuid;
  v_other_store uuid := gen_random_uuid();
  v_err text;
BEGIN
  SELECT usa.store_id INTO v_store
  FROM public.user_store_access usa
  JOIN public.stores s ON s.id=usa.store_id AND s.is_active
  WHERE usa.user_id=v_admin AND usa.is_active
  LIMIT 1;

  SELECT pv.id INTO v_variant
  FROM public.product_variants pv
  JOIN public.products p ON p.id=pv.product_id
  JOIN public.store_inventory si ON si.product_variant_id=pv.id AND si.store_id=v_store
  WHERE pv.is_active AND p.is_active
  LIMIT 1;

  IF v_store IS NULL OR v_variant IS NULL THEN
    RAISE EXCEPTION 'Fixture de loja/estoque insuficiente para smoke tests.';
  END IF;

  -- Missing/invalid auth context.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role','authenticated')::text, true);
  BEGIN
    PERFORM public.complete_sale(v_store,NULL,'x','x','[]'::jsonb,'PIX',1,0,0,'smoke-no-sub');
    RAISE EXCEPTION 'expected auth failure not raised';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Autenticação%' THEN RAISE; END IF;
  END;

  -- ADMIN allowed boundary: should pass auth/store/role and fail only on empty cart.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',v_admin::text,'role','authenticated')::text, true);
  BEGIN
    PERFORM public.complete_sale(v_store,NULL,'x','x','[]'::jsonb,'PIX',1,0,0,'smoke-admin');
    RAISE EXCEPTION 'expected empty cart failure not raised';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Carrinho vazio%' THEN RAISE; END IF;
  END;

  -- EMPLOYEE must be denied before cart validation.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',v_employee::text,'role','authenticated')::text, true);
  BEGIN
    PERFORM public.complete_sale(v_store,NULL,'x','x','[]'::jsonb,'PIX',1,0,0,'smoke-employee');
    RAISE EXCEPTION 'expected employee denial not raised';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Permissão negada%' THEN RAISE; END IF;
  END;

  -- Cross-store / unlinked store denied for report.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',v_admin::text,'role','authenticated')::text, true);
  INSERT INTO public.stores(id,name,is_active) VALUES(v_other_store,'SMOKE-UNLINKED',true);
  BEGIN
    PERFORM * FROM public.report_stock_status(v_other_store);
    RAISE EXCEPTION 'expected store access denial not raised';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Acesso negado%' THEN RAISE; END IF;
  END;

  -- Stock mutation is transactional and synchronized.
  SELECT si.quantity,pv.stock_quantity INTO v_before_store,v_before_global
  FROM public.store_inventory si JOIN public.product_variants pv ON pv.id=si.product_variant_id
  WHERE si.store_id=v_store AND si.product_variant_id=v_variant
  FOR UPDATE;
  IF v_before_store IS NULL THEN RAISE EXCEPTION 'stock fixture missing'; END IF;

  PERFORM public.register_stock_entry(v_variant,1,0,'SMOKE',v_store,'Teste','ENTRY');
  SELECT si.quantity,pv.stock_quantity INTO v_after_store,v_after_global
  FROM public.store_inventory si JOIN public.product_variants pv ON pv.id=si.product_variant_id
  WHERE si.store_id=v_store AND si.product_variant_id=v_variant;
  IF v_after_store<>v_before_store+1 OR v_after_global<>v_before_global+1 THEN
    RAISE EXCEPTION 'stock sync failed';
  END IF;

  -- Physical inventory policy/approval round-trip in transaction.
  INSERT INTO public.physical_inventories(store_id,status,created_by)
  VALUES(v_store,'OPEN',v_admin)
  RETURNING id INTO v_inventory_id;
  INSERT INTO public.physical_inventory_items(inventory_id,product_variant_id,expected_quantity,counted_quantity)
  VALUES(v_inventory_id,v_variant,v_after_store,v_after_store);
  PERFORM public.approve_physical_inventory(v_inventory_id,v_admin);
  IF NOT EXISTS (SELECT 1 FROM public.physical_inventories WHERE id=v_inventory_id AND status='APPROVED') THEN
    RAISE EXCEPTION 'physical inventory approval failed';
  END IF;

  RAISE NOTICE 'CORE_SYS_SMOKE_TESTS_PASS';
END $$;

ROLLBACK;
