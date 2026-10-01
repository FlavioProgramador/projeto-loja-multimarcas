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

CREATE INDEX IF NOT EXISTS idx_inventory_movements_user_id ON public.inventory_movements(user_id);
CREATE INDEX IF NOT EXISTS idx_physical_inventories_approved_by ON public.physical_inventories(approved_by);
CREATE INDEX IF NOT EXISTS idx_physical_inventories_created_by ON public.physical_inventories(created_by);
CREATE INDEX IF NOT EXISTS idx_physical_inventories_store_id ON public.physical_inventories(store_id);
CREATE INDEX IF NOT EXISTS idx_physical_inventory_items_inventory_id ON public.physical_inventory_items(inventory_id);
CREATE INDEX IF NOT EXISTS idx_physical_inventory_items_product_variant_id ON public.physical_inventory_items(product_variant_id);
CREATE INDEX IF NOT EXISTS idx_return_items_product_id ON public.return_items(product_id);
CREATE INDEX IF NOT EXISTS idx_returns_created_by ON public.returns(created_by);
CREATE INDEX IF NOT EXISTS idx_returns_customer_id ON public.returns(customer_id);
CREATE INDEX IF NOT EXISTS idx_sale_idempotency_sale_id ON public.sale_idempotency(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON public.sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_sales_user_id ON public.sales(user_id);
CREATE INDEX IF NOT EXISTS idx_store_inventory_product_variant_id ON public.store_inventory(product_variant_id);
CREATE INDEX IF NOT EXISTS idx_customer_credit_movements_customer_id ON public.customer_credit_movements(customer_id);
CREATE INDEX IF NOT EXISTS idx_user_store_access_store_id ON public.user_store_access(store_id);

ALTER EXTENSION unaccent SET SCHEMA extensions;
COMMIT;