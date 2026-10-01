BEGIN;

-- Esta migration consolida hardening de um banco já evoluído. Em rebuild limpo,
-- algumas assinaturas e tabelas podem surgir somente em migrations posteriores.
DO $functions$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.approve_mp_pix_sale(uuid,text)',
    'public.cancel_mp_pix_sale(uuid)'
  ]
  LOOP
    IF to_regprocedure(v_sig) IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON FUNCTION ' || v_sig || ' FROM PUBLIC, anon, authenticated';
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || v_sig || ' TO service_role';
    END IF;
  END LOOP;

  FOREACH v_sig IN ARRAY ARRAY[
    'public.get_profitability_by_category(date,date)',
    'public.get_profitability_by_product(date,date)',
    'public.report_inventory_movements_summary(timestamptz,timestamptz)',
    'public.report_stock_status()',
    'public.report_top_selling_products(integer)'
  ]
  LOOP
    IF to_regprocedure(v_sig) IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON FUNCTION ' || v_sig || ' FROM PUBLIC, anon, authenticated';
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || v_sig || ' TO authenticated';
    END IF;
  END LOOP;

  FOREACH v_sig IN ARRAY ARRAY[
    'public.get_user_store_role(uuid)',
    'public.has_store_access(uuid)',
    'public.manage_product(uuid,text,text,text,numeric,numeric,jsonb)',
    'public.approve_physical_inventory(uuid,uuid)'
  ]
  LOOP
    IF to_regprocedure(v_sig) IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON FUNCTION ' || v_sig || ' FROM PUBLIC, anon';
    END IF;
  END LOOP;

  FOREACH v_sig IN ARRAY ARRAY[
    'public.handle_new_user()',
    'public.rls_auto_enable()'
  ]
  LOOP
    IF to_regprocedure(v_sig) IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON FUNCTION ' || v_sig || ' FROM PUBLIC, anon, authenticated';
    END IF;
  END LOOP;
END
$functions$;

DO $indexes$
DECLARE
  v_index text;
  v_table text;
  v_column text;
BEGIN
  FOR v_index, v_table, v_column IN
    SELECT *
    FROM (VALUES
      ('idx_inventory_movements_user_id', 'inventory_movements', 'user_id'),
      ('idx_physical_inventories_approved_by', 'physical_inventories', 'approved_by'),
      ('idx_physical_inventories_created_by', 'physical_inventories', 'created_by'),
      ('idx_physical_inventories_store_id', 'physical_inventories', 'store_id'),
      ('idx_physical_inventory_items_inventory_id', 'physical_inventory_items', 'inventory_id'),
      ('idx_physical_inventory_items_product_variant_id', 'physical_inventory_items', 'product_variant_id'),
      ('idx_return_items_product_id', 'return_items', 'product_id'),
      ('idx_returns_created_by', 'returns', 'created_by'),
      ('idx_returns_customer_id', 'returns', 'customer_id'),
      ('idx_sale_idempotency_sale_id', 'sale_idempotency', 'sale_id'),
      ('idx_sale_items_product_id', 'sale_items', 'product_id'),
      ('idx_sales_user_id', 'sales', 'user_id')
    ) AS indexes(index_name, table_name, column_name)
  LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema='public'
           AND table_name=v_table
           AND column_name=v_column
       ) THEN
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON public.%I(%I)',
        v_index, v_table, v_column
      );
    END IF;
  END LOOP;
END
$indexes$;

COMMIT;