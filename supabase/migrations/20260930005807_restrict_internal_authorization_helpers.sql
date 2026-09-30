-- Phase 3: authorization helpers are internal dependencies for RLS/RPCs.
-- They do not need to be callable directly through PostgREST.
REVOKE EXECUTE ON FUNCTION public.current_user_role() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_user_store_role(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_store_access(uuid) FROM anon, authenticated;
