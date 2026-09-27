-- Hardening Supabase/CoreSys aplicado e consolidado em 2026-09-27.
-- Mantém EXECUTE restrito por assinatura, search_path fixado e índices de FK necessários.
-- Não altera objetos gerenciados do schema stripe nem remove índices apenas por baixa utilização.
BEGIN;

REVOKE ALL ON FUNCTION public.approve_mp_pix_sale(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_mp_pix_sale(uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.cancel_mp_pix_sale(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_mp_pix_sale(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric,uuid,text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.process_return(uuid,uuid,uuid,text,text,jsonb,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_stock_entry(uuid,integer,numeric,text,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_physical_inventory(uuid,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_user_store_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_store_role(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.has_store_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_store_access(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.admin_set_user_role(uuid,text) SET search_path=public;
ALTER FUNCTION public.cancel_sale(uuid) SET search_path=public;
ALTER FUNCTION public.complete_sale(uuid,text,text,jsonb,text,integer,numeric,numeric,text) SET search_path=public;
ALTER FUNCTION public.complete_sale(uuid,uuid,text,text,jsonb,text,integer,numeric,numeric,text) SET search_path=public;
ALTER FUNCTION public.current_user_role() SET search_path=public;
ALTER FUNCTION public.get_profitability_by_product(date,date) SET search_path=public;
ALTER FUNCTION public.get_profitability_by_category(date,date) SET search_path=public;
ALTER FUNCTION public.report_inventory_movements_summary(timestamptz,timestamptz) SET search_path=public;
ALTER FUNCTION public.report_stock_status() SET search_path=public;
ALTER FUNCTION public.report_top_selling_products(integer) SET search_path=public;
ALTER FUNCTION public.get_variant_stock_by_store(uuid) SET search_path=public;
ALTER FUNCTION public.manage_product(uuid,text,text,text,numeric,numeric,jsonb) SET search_path=public,extensions;
ALTER FUNCTION public.process_return(uuid,uuid,uuid,text,text,jsonb,text,text) SET search_path=public;
ALTER FUNCTION public.register_stock_entry(uuid,integer,numeric,text,uuid,text,text) SET search_path=public;
ALTER FUNCTION public.approve_physical_inventory(uuid,uuid) SET search_path=public;
ALTER FUNCTION public.approve_mp_pix_sale(uuid,text) SET search_path=public;
ALTER FUNCTION public.cancel_mp_pix_sale(uuid) SET search_path=public;
ALTER FUNCTION public.create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric,uuid,text) SET search_path=public;
ALTER FUNCTION public.handle_new_user() SET search_path=public;
ALTER FUNCTION public.rls_auto_enable() SET search_path=pg_catalog;
ALTER FUNCTION public.prevent_inventory_movement_delete() SET search_path=pg_catalog;
ALTER FUNCTION public.prevent_inventory_movement_update() SET search_path=pg_catalog;

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