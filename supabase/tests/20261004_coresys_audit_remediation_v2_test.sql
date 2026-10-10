-- CoreSys audit remediation v2 regression test
-- Tests approve_physical_inventory actor validation, role restriction, and status checks.

BEGIN;

SELECT plan(1);

DO $$
DECLARE
  v_admin uuid := '00000000-0000-0000-0000-00000000d001';
  v_employee uuid := '00000000-0000-0000-0000-00000000d002';
  v_store uuid := '00000000-0000-0000-0000-00000000d003';
  v_inventory_id uuid := '00000000-0000-0000-0000-00000000d004';
  v_variant_id uuid := '00000000-0000-0000-0000-00000000d005';
  v_product_id uuid := '00000000-0000-0000-0000-00000000d006';
BEGIN
  -- Insert Fixtures
  INSERT INTO public.stores(id, name, is_active)
  VALUES(v_store, 'TEST-REMEDIATION-STORE', true)
  ON CONFLICT (id) DO UPDATE SET is_active = true;

  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_admin, 'remediation-admin@coresys.test', '{"full_name":"Remediation Admin"}'::jsonb, now(), now()),
    (v_employee, 'remediation-employee@coresys.test', '{"full_name":"Remediation Employee"}'::jsonb, now(), now())
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.profiles SET role = 'ADMIN', is_active = true WHERE id = v_admin;
  UPDATE public.profiles SET role = 'EMPLOYEE', is_active = true WHERE id = v_employee;

  INSERT INTO public.user_store_access(user_id, store_id, role, is_active)
  VALUES
    (v_admin, v_store, 'ADMIN', true),
    (v_employee, v_store, 'EMPLOYEE', true)
  ON CONFLICT (user_id, store_id) DO UPDATE SET role = excluded.role, is_active = true;

  INSERT INTO public.products (id, name, cost_price, sale_price, minimum_stock, is_active)
  VALUES (v_product_id, 'REMEDIATION-PRODUCT', 10, 20, 2, true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.product_variants (id, product_id, sku, size, color, stock_quantity, is_active)
  VALUES (v_variant_id, v_product_id, 'REMEDIATION-SKU', 'M', 'Azul', 10, true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.store_inventory (store_id, product_variant_id, quantity, minimum_stock)
  VALUES (v_store, v_variant_id, 10, 2)
  ON CONFLICT (store_id, product_variant_id) DO UPDATE SET quantity = 10;

  INSERT INTO public.physical_inventories (id, store_id, status, created_by)
  VALUES (v_inventory_id, v_store, 'IN_PROGRESS', v_admin)
  ON CONFLICT (id) DO UPDATE SET status = 'IN_PROGRESS';

  INSERT INTO public.physical_inventory_items (inventory_id, product_variant_id, expected_quantity, counted_quantity)
  VALUES (v_inventory_id, v_variant_id, 10, 12)
  ON CONFLICT DO NOTHING;
END $$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_admin uuid := '00000000-0000-0000-0000-00000000d001';
  v_employee uuid := '00000000-0000-0000-0000-00000000d002';
  v_inventory_id uuid := '00000000-0000-0000-0000-00000000d004';
  v_res boolean;
BEGIN
  -- 1) Test actor mismatch: auth.uid() = admin, but passed p_user_id = employee -> MUST FAIL
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_admin::text, 'role', 'authenticated')::text,
    true
  );

  BEGIN
    PERFORM public.approve_physical_inventory(v_inventory_id, v_employee);
    RAISE EXCEPTION 'Expected actor mismatch failure not raised';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Usuário de aprovação inválido%' THEN RAISE; END IF;
  END;

  -- 2) Test employee role: auth.uid() = employee, passed p_user_id = employee -> MUST FAIL
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_employee::text, 'role', 'authenticated')::text,
    true
  );

  BEGIN
    PERFORM public.approve_physical_inventory(v_inventory_id, v_employee);
    RAISE EXCEPTION 'Expected permission denied failure not raised';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Permissão negada%' THEN RAISE; END IF;
  END;

  -- 3) Test valid admin approval: auth.uid() = admin, passed p_user_id = admin -> MUST SUCCEED
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_admin::text, 'role', 'authenticated')::text,
    true
  );

  v_res := public.approve_physical_inventory(v_inventory_id, v_admin);
  IF v_res IS NOT TRUE THEN
    RAISE EXCEPTION 'Physical inventory approval returned false';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.physical_inventories WHERE id = v_inventory_id AND status = 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'Physical inventory status was not updated to APPROVED';
  END IF;

  RAISE NOTICE 'AUDIT_REMEDIATION_V2_TEST_PASS';
END $$;

RESET ROLE;
SELECT pass('audit remediation v2 tests completed successfully');
SELECT * FROM finish();
ROLLBACK;
