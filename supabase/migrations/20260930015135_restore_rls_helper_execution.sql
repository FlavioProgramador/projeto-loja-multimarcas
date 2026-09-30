
-- CoreSys: restaura execução dos helpers de autorização usados pelas RLS.
-- Estes helpers permanecem SECURITY DEFINER e são usados internamente pelas
-- policies para resolver o acesso da sessão autenticada à loja.
BEGIN;
REVOKE ALL ON FUNCTION public.has_store_access(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_store_access(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_user_store_role(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_store_role(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
COMMIT;
