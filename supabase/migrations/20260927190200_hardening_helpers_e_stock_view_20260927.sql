CREATE OR REPLACE FUNCTION public.get_variant_stock_by_store(p_variant_id uuid)
RETURNS TABLE(store_id uuid, store_name text, stock_quantity bigint)
LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$ SELECT s.id,s.name,COALESCE(si.quantity,0)::bigint FROM public.stores s LEFT JOIN public.store_inventory si ON si.store_id=s.id AND si.product_variant_id=p_variant_id WHERE EXISTS (SELECT 1 FROM public.user_store_access usa WHERE usa.user_id=auth.uid() AND usa.store_id=s.id AND usa.is_active=true) OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.role='ADMIN') ORDER BY s.name; $$;
REVOKE ALL ON FUNCTION public.get_variant_stock_by_store(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_variant_stock_by_store(uuid) TO authenticated;
ALTER FUNCTION public.get_user_store_role(uuid) SET search_path=public;
ALTER FUNCTION public.has_store_access(uuid) SET search_path=public;
ALTER FUNCTION public.current_user_role() SET search_path=public;
ALTER FUNCTION public.handle_new_user() SET search_path=public;
ALTER FUNCTION public.rls_auto_enable() SET search_path=pg_catalog;