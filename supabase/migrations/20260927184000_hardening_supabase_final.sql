-- Consolidação do hardening aplicado no Supabase CoreSys em 2026-09-27.
-- Inclui: privilégios RPC, search_path seguro, índices públicos e localização segura do unaccent.
-- Não altera o schema stripe e não remove índices por baixa utilização.
BEGIN;

-- Algumas assinaturas abaixo são legadas e podem não existir em uma reconstrução
-- limpa do schema. O hardening é aplicado somente às funções presentes.
DO $hardening$
DECLARE
  v_sig text;
  v_path text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.approve_mp_pix_sale(uuid,text)',
    'public.cancel_mp_pix_sale(uuid)',
    'public.create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric)',
    'public.create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric,uuid,text)'
  ]
  LOOP
    IF to_regprocedure(v_sig) IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON FUNCTION ' || v_sig || ' FROM PUBLIC, anon, authenticated';
    END IF;
  END LOOP;

  IF to_regprocedure('public.approve_mp_pix_sale(uuid,text)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.approve_mp_pix_sale(uuid,text) TO service_role';
  END IF;

  IF to_regprocedure('public.cancel_mp_pix_sale(uuid)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.cancel_mp_pix_sale(uuid) TO service_role';
  END IF;

  IF to_regprocedure('public.create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric,uuid,text)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric,uuid,text) TO authenticated';
  END IF;

  FOREACH v_sig IN ARRAY ARRAY[
    'public.get_user_store_role(uuid)',
    'public.has_store_access(uuid)'
  ]
  LOOP
    IF to_regprocedure(v_sig) IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON FUNCTION ' || v_sig || ' FROM PUBLIC, anon';
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || v_sig || ' TO authenticated';
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

  FOR v_sig, v_path IN
    SELECT *
    FROM (VALUES
      ('public.admin_set_user_role(uuid,text)', 'public'),
      ('public.cancel_sale(uuid)', 'public'),
      ('public.complete_sale(uuid,text,text,jsonb,text,integer,numeric,numeric,text)', 'public'),
      ('public.complete_sale(uuid,uuid,text,text,jsonb,text,integer,numeric,numeric,text)', 'public'),
      ('public.current_user_role()', 'public'),
      ('public.get_profitability_by_product(date,date)', 'public'),
      ('public.get_profitability_by_category(date,date)', 'public'),
      ('public.report_inventory_movements_summary(timestamptz,timestamptz)', 'public'),
      ('public.report_stock_status()', 'public'),
      ('public.report_top_selling_products(integer)', 'public'),
      ('public.get_variant_stock_by_store(uuid)', 'public'),
      ('public.manage_product(uuid,text,text,text,numeric,numeric,jsonb)', 'public,extensions'),
      ('public.process_return(uuid,uuid,uuid,text,text,jsonb,text,text)', 'public'),
      ('public.register_stock_entry(uuid,integer,numeric,text,uuid,text,text)', 'public'),
      ('public.approve_physical_inventory(uuid,uuid)', 'public'),
      ('public.approve_mp_pix_sale(uuid,text)', 'public'),
      ('public.cancel_mp_pix_sale(uuid)', 'public'),
      ('public.create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric,uuid,text)', 'public'),
      ('public.handle_new_user()', 'public'),
      ('public.rls_auto_enable()', 'pg_catalog'),
      ('public.prevent_inventory_movement_delete()', 'pg_catalog'),
      ('public.prevent_inventory_movement_update()', 'pg_catalog')
    ) AS functions(signature, search_path)
  LOOP
    IF to_regprocedure(v_sig) IS NOT NULL THEN
      EXECUTE 'ALTER FUNCTION ' || v_sig || ' SET search_path=' || v_path;
    END IF;
  END LOOP;
END
$hardening$;

-- Índices consolidados podem apontar para objetos criados por migrations posteriores.
-- Em rebuild limpo, aplique cada índice somente quando tabela e coluna já existirem.
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
      ('idx_sales_user_id', 'sales', 'user_id'),
      ('idx_store_inventory_product_variant_id', 'store_inventory', 'product_variant_id'),
      ('idx_customer_credit_movements_customer_id', 'customer_credit_movements', 'customer_id'),
      ('idx_user_store_access_store_id', 'user_store_access', 'store_id')
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

DO $extension$
DECLARE
  v_schema text;
BEGIN
  SELECT n.nspname
    INTO v_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid=e.extnamespace
  WHERE e.extname='unaccent';

  IF v_schema IS NOT NULL AND v_schema <> 'extensions' THEN
    ALTER EXTENSION unaccent SET SCHEMA extensions;
  END IF;
END
$extension$;
COMMIT;