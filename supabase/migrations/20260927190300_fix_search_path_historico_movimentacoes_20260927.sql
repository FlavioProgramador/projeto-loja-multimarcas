ALTER FUNCTION public.prevent_inventory_movement_delete() SET search_path=pg_catalog;
ALTER FUNCTION public.prevent_inventory_movement_update() SET search_path=pg_catalog;
REVOKE EXECUTE ON FUNCTION public.handle_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_inventory_movement_delete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_inventory_movement_update() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_updated_at() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.prevent_inventory_movement_delete() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.prevent_inventory_movement_update() TO postgres, service_role;