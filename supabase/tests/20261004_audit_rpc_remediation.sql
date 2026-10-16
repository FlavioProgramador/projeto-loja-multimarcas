-- Database test for 20261004000000_coresys_audit_remediation migration
BEGIN;

SELECT plan(3);

DO $$
DECLARE
  v_admin uuid := '00000000-0000-0000-0000-00000000a001';
  v_unauth_user uuid := '00000000-0000-0000-0000-00000000a099';
  v_store uuid;
BEGIN
  SELECT s.id INTO v_store
  FROM public.stores s
  WHERE s.is_active
  ORDER BY coalesce(s.is_main, false) DESC, s.created_at, s.id
  LIMIT 1;

  IF v_store IS NULL THEN
    RAISE EXCEPTION 'Store fixture missing for DB test.';
  END IF;

  -- 1. Test unauthenticated call rejection for report_stock_status
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated')::text, true);
  BEGIN
    PERFORM * FROM public.report_stock_status(v_store);
    RAISE EXCEPTION 'Expected unauthenticated failure for report_stock_status, but succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Acesso não autenticado%' AND SQLERRM NOT LIKE '%Perfil autenticado inexistente%' THEN
      RAISE;
    END IF;
  END;

  -- 2. Test unauthenticated call rejection for report_top_selling_products
  BEGIN
    PERFORM * FROM public.report_top_selling_products(v_store, 10, NULL, NULL);
    RAISE EXCEPTION 'Expected unauthenticated failure for report_top_selling_products, but succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Acesso não autenticado%' AND SQLERRM NOT LIKE '%Perfil autenticado inexistente%' THEN
      RAISE;
    END IF;
  END;

  -- 3. Test approve_physical_inventory user mismatch rejection
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.approve_physical_inventory('00000000-0000-0000-0000-000000000001'::uuid, v_unauth_user);
    RAISE EXCEPTION 'Expected user mismatch failure for approve_physical_inventory, but succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Usuário de aprovação inválido%' THEN
      RAISE;
    END IF;
  END;
END $$;

SELECT pass('report_stock_status unauthenticated rejection verified');
SELECT pass('report_top_selling_products unauthenticated rejection verified');
SELECT pass('approve_physical_inventory identity check verified');

SELECT * FROM finish();
ROLLBACK;
