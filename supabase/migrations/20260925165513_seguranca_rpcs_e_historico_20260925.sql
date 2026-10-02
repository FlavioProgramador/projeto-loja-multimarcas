
REVOKE EXECUTE ON FUNCTION public.complete_sale(UUID,UUID,TEXT,TEXT,JSONB,TEXT,INT,NUMERIC,NUMERIC,TEXT) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_sale(UUID,UUID,TEXT,TEXT,JSONB,TEXT,INT,NUMERIC,NUMERIC,TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.process_return(UUID,UUID,UUID,TEXT,TEXT,JSONB,TEXT,TEXT) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_return(UUID,UUID,UUID,TEXT,TEXT,JSONB,TEXT,TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.register_stock_entry(UUID,INTEGER,NUMERIC,TEXT,UUID,TEXT,TEXT) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_stock_entry(UUID,INTEGER,NUMERIC,TEXT,UUID,TEXT,TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_sale(UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_sale(UUID) TO authenticated;

DROP POLICY IF EXISTS "Inventory movement legacy admin view" ON public.inventory_movements;
CREATE POLICY "Inventory movement legacy admin view" ON public.inventory_movements
FOR SELECT TO authenticated
USING (
  (store_id IS NULL AND public.current_user_role()='ADMIN')
  OR public.has_store_access(store_id)
);

DROP POLICY IF EXISTS "Inventory movement legacy insert" ON public.inventory_movements;
