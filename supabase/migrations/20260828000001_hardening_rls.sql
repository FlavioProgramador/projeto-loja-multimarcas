-- ============================================================================
-- MIGRATION: 20260828000001_hardening_rls.sql
-- FASE 2: Hardening RLS Policies, Eliminating Redundancies, and RBAC
-- ============================================================================

-- ============================================================================
-- 1. CORREÇÃO DA TABELA PROFILES
-- ============================================================================
DROP POLICY IF EXISTS "Users can update own profile (except role)" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;

-- Usuários só podem atualizar os próprios dados (sem WITH CHECK em role aqui, usaremos trigger)
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = (select auth.uid()));

-- Trigger para proteger a coluna ROLE contra escalonamento de privilégios
CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS TRIGGER AS $$
BEGIN
  -- Se a role estiver sendo alterada
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    -- Apenas ADMIN pode alterar a role de alguém (incluindo a própria)
    IF public.current_user_role() != 'ADMIN' THEN
      RAISE EXCEPTION 'Acesso negado: Apenas administradores podem alterar papéis (roles).';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Revoke execute on trigger function from public just to be safe
REVOKE EXECUTE ON FUNCTION public.protect_profile_role FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_protect_profile_role ON public.profiles;
CREATE TRIGGER trg_protect_profile_role
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_role();

-- ============================================================================
-- 2. ELIMINAÇÃO DE POLÍTICAS "FOR ALL" REDUNDANTES
-- ============================================================================

-- Helper para recriar as políticas sem sobrepor SELECT
CREATE OR REPLACE FUNCTION public.harden_table_rls(p_table_name TEXT, p_policy_prefix TEXT, p_roles TEXT[])
RETURNS VOID AS $$
DECLARE
  v_roles_str TEXT;
BEGIN
  v_roles_str := array_to_string(p_roles, ''', ''');
  
  -- Dropar a policy genérica FOR ALL
  EXECUTE format('DROP POLICY IF EXISTS "%s manageable by Admin and Manager" ON public.%s', p_policy_prefix, p_table_name);
  EXECUTE format('DROP POLICY IF EXISTS "%s manageable by authenticated" ON public.%s', p_policy_prefix, p_table_name);
  
  -- Criar policies separadas para mutação
  EXECUTE format('
    CREATE POLICY "%s insertable by roles" ON public.%s FOR INSERT TO authenticated WITH CHECK (public.current_user_role() IN (''%s''));
    CREATE POLICY "%s updatable by roles" ON public.%s FOR UPDATE TO authenticated USING (public.current_user_role() IN (''%s''));
    CREATE POLICY "%s deletable by roles" ON public.%s FOR DELETE TO authenticated USING (public.current_user_role() IN (''%s''));
  ', p_policy_prefix, p_table_name, v_roles_str, p_policy_prefix, p_table_name, v_roles_str, p_policy_prefix, p_table_name, v_roles_str);
END;
$$ LANGUAGE plpgsql;

-- Brands
SELECT public.harden_table_rls('brands', 'Brands', ARRAY['ADMIN', 'MANAGER']);
-- Categories
SELECT public.harden_table_rls('categories', 'Categories', ARRAY['ADMIN', 'MANAGER']);
-- Products
SELECT public.harden_table_rls('products', 'Products', ARRAY['ADMIN', 'MANAGER']);
-- Product Variants
SELECT public.harden_table_rls('product_variants', 'Variants', ARRAY['ADMIN', 'MANAGER']);
-- Suppliers
SELECT public.harden_table_rls('suppliers', 'Suppliers', ARRAY['ADMIN', 'MANAGER']);
-- Coupons
SELECT public.harden_table_rls('coupons', 'Coupons', ARRAY['ADMIN', 'MANAGER']);
-- Fixed Expenses
SELECT public.harden_table_rls('fixed_expenses', 'Fixed expenses', ARRAY['ADMIN', 'MANAGER']);

-- Customers (Manageable by authenticated originally)
DROP POLICY IF EXISTS "Customers manageable by authenticated" ON public.customers;
CREATE POLICY "Customers insertable by authenticated" ON public.customers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Customers updatable by authenticated" ON public.customers FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Customers deletable by authenticated" ON public.customers FOR DELETE TO authenticated USING (public.current_user_role() IN ('ADMIN', 'MANAGER')); -- Restringindo delete para segurança

-- Financial Transactions (Manageable by Admin, Manager, Cashier)
DROP POLICY IF EXISTS "Finance manageable by Admin and Manager" ON public.financial_transactions;
CREATE POLICY "Finance insertable by roles" ON public.financial_transactions FOR INSERT TO authenticated WITH CHECK (public.current_user_role() IN ('ADMIN', 'MANAGER', 'CASHIER'));
CREATE POLICY "Finance updatable by roles" ON public.financial_transactions FOR UPDATE TO authenticated USING (public.current_user_role() IN ('ADMIN', 'MANAGER', 'CASHIER'));
CREATE POLICY "Finance deletable by roles" ON public.financial_transactions FOR DELETE TO authenticated USING (public.current_user_role() IN ('ADMIN'));

-- Remover função helper para não poluir o schema permanentemente
DROP FUNCTION public.harden_table_rls;

-- ============================================================================
-- 3. POLICIES PARA INVENTORY_MOVEMENTS (Apenas inserção)
-- ============================================================================
-- Originally: "Movements viewable by authenticated" (FOR SELECT)
-- Faltava regra para INSERT e estava liberado via bypass de RPC, mas é bom ter restrição.
CREATE POLICY "Movements insertable by authenticated"
  ON public.inventory_movements FOR INSERT
  TO authenticated
  WITH CHECK (true); -- Controle feito nas RPCs (register_stock_entry, complete_sale)

-- Inventory Movements NUNCA devem ser alterados ou deletados. (Imutabilidade)
-- Como não há policies para UPDATE ou DELETE, o default-deny já bloqueia, garantindo auditoria.

-- ============================================================================
-- 4. SALES, SALE_ITEMS, PAYMENTS (Imutabilidade após criação)
-- ============================================================================
-- INSERT permitido para autenticados (caixas podem vender)
CREATE POLICY "Sales insertable by authenticated"
  ON public.sales FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Sale items insertable by authenticated"
  ON public.sale_items FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Payments insertable by authenticated"
  ON public.payments FOR INSERT TO authenticated WITH CHECK (true);

-- UPDATE de status de venda apenas por ADMIN/MANAGER
CREATE POLICY "Sales updatable by Admin/Manager"
  ON public.sales FOR UPDATE TO authenticated USING (public.current_user_role() IN ('ADMIN', 'MANAGER'));

CREATE POLICY "Payments updatable by Admin/Manager"
  ON public.payments FOR UPDATE TO authenticated USING (public.current_user_role() IN ('ADMIN', 'MANAGER'));
