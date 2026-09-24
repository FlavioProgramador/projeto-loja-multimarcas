-- ============================================================================
-- VESTRA ERP - Hardening adicional de segurança
-- Prioridade: P0
-- Objetivo: impedir escritas diretas em tabelas transacionais.
-- As operações críticas devem passar pelas RPCs transacionais.
-- ============================================================================

-- Remover policies permissivas de INSERT direto criadas em migrations anteriores.
DROP POLICY IF EXISTS "Sales insertable by authenticated" ON public.sales;
DROP POLICY IF EXISTS "Sale items insertable by authenticated" ON public.sale_items;
DROP POLICY IF EXISTS "Payments insertable by authenticated" ON public.payments;
DROP POLICY IF EXISTS "Movements insertable by authenticated" ON public.inventory_movements;

-- Clientes continuam podendo ser cadastrados pelo fluxo de clientes.
-- A policy existente será substituída por uma regra mínima de autenticação.
DROP POLICY IF EXISTS "Customers insertable by authenticated" ON public.customers;
CREATE POLICY "Customers insertable by authenticated"
  ON public.customers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active IS DISTINCT FROM false
  );

-- Vendas, itens, pagamentos e movimentações não aceitam INSERT direto
-- pelo cliente autenticado. As RPCs SECURITY DEFINER são o caminho oficial.
-- UPDATE/DELETE também continuam bloqueados onde não houver policy explícita.

-- Garantir search_path fixo nas helpers de autorização.
ALTER FUNCTION public.has_store_access(UUID) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_user_store_role(UUID) SET search_path = public, pg_temp;

-- Evitar execução anônima das helpers.
REVOKE EXECUTE ON FUNCTION public.has_store_access(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_store_role(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_store_access(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_store_role(UUID) TO authenticated;
