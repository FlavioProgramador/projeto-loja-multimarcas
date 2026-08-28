-- ============================================================================
-- MIGRATION: 20260828000003_multi_store.sql
-- FASE 1, 2 e 3: Arquitetura Multi-Loja, RLS Isolado e RPCs Seguras
-- ============================================================================

-- ============================================================================
-- 1. ESTRUTURA DE DADOS: MULTI-LOJA
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);
CREATE TRIGGER update_stores_updated_at BEFORE UPDATE ON public.stores FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE IF NOT EXISTS public.user_store_access (
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'MANAGER', 'CASHIER', 'EMPLOYEE')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  PRIMARY KEY (user_id, store_id)
);

CREATE TABLE IF NOT EXISTS public.store_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  product_variant_id UUID NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  minimum_stock INTEGER DEFAULT 0 CHECK (minimum_stock >= 0),
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(store_id, product_variant_id)
);
CREATE TRIGGER update_store_inventory_updated_at BEFORE UPDATE ON public.store_inventory FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- IDEMPOTÊNCIA DE VENDAS
CREATE TABLE IF NOT EXISTS public.sale_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- Adicionar colunas store_id nas tabelas operacionais
ALTER TABLE public.sales ADD COLUMN store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE;
ALTER TABLE public.inventory_movements ADD COLUMN store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE;
ALTER TABLE public.financial_transactions ADD COLUMN store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE;
ALTER TABLE public.fixed_expenses ADD COLUMN store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE;

-- ============================================================================
-- 2. MIGRAÇÃO DE DADOS (Preservação de Histórico)
-- ============================================================================

DO $$
DECLARE
  v_default_store_id UUID;
BEGIN
  -- Verificar se já existe a loja principal (para ser reentrante)
  SELECT id INTO v_default_store_id FROM public.stores WHERE name = 'Loja Principal' LIMIT 1;
  
  IF v_default_store_id IS NULL THEN
    -- Inserir loja padrão
    INSERT INTO public.stores (name) VALUES ('Loja Principal') RETURNING id INTO v_default_store_id;

    -- Inserir acesso para todos os usuários existentes
    INSERT INTO public.user_store_access (user_id, store_id, role)
    SELECT id, v_default_store_id, role FROM public.profiles
    ON CONFLICT DO NOTHING;

    -- Migrar o estoque para a nova tabela de inventário
    INSERT INTO public.store_inventory (store_id, product_variant_id, quantity)
    SELECT v_default_store_id, id, COALESCE(stock_quantity, 0) FROM public.product_variants
    ON CONFLICT DO NOTHING;

    -- Atualizar registros existentes com a loja padrão
    UPDATE public.sales SET store_id = v_default_store_id WHERE store_id IS NULL;
    UPDATE public.inventory_movements SET store_id = v_default_store_id WHERE store_id IS NULL;
    UPDATE public.financial_transactions SET store_id = v_default_store_id WHERE store_id IS NULL;
    UPDATE public.fixed_expenses SET store_id = v_default_store_id WHERE store_id IS NULL;
  END IF;
END $$;

-- Tornar store_id NOT NULL para garantir consistência daqui pra frente
ALTER TABLE public.sales ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE public.inventory_movements ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE public.financial_transactions ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE public.fixed_expenses ALTER COLUMN store_id SET NOT NULL;

-- NÃO REMOVER stock_quantity IMEDIATAMENTE (conforme regra do usuário)
-- A coluna será depreciada e removida em uma futura migration após validação completa.
-- ALTER TABLE public.product_variants DROP COLUMN IF EXISTS stock_quantity;

-- ============================================================================
-- 3. RLS PARA MULTI-LOJA
-- ============================================================================

-- Habilitar RLS
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_store_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_idempotency ENABLE ROW LEVEL SECURITY;

-- Helper Function para verificar acesso à loja
CREATE OR REPLACE FUNCTION public.has_store_access(p_store_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_store_access 
    WHERE user_id = auth.uid() 
      AND store_id = p_store_id 
      AND is_active = true
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_user_store_role(p_store_id UUID)
RETURNS TEXT AS $$
  SELECT role FROM public.user_store_access 
  WHERE user_id = auth.uid() 
    AND store_id = p_store_id 
    AND is_active = true;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Policies: STORES
CREATE POLICY "Stores viewable by accessed users" ON public.stores FOR SELECT TO authenticated USING (
  public.has_store_access(id) OR public.current_user_role() = 'ADMIN'
);

-- Policies: USER_STORE_ACCESS
CREATE POLICY "User store access viewable by self or admin" ON public.user_store_access FOR SELECT TO authenticated USING (
  user_id = auth.uid() OR public.current_user_role() = 'ADMIN'
);

-- Policies: STORE_INVENTORY
CREATE POLICY "Inventory viewable by accessed users" ON public.store_inventory FOR SELECT TO authenticated USING (
  public.has_store_access(store_id)
);
CREATE POLICY "Inventory manageable by Admin and Manager" ON public.store_inventory FOR ALL TO authenticated USING (
  public.has_store_access(store_id) AND public.get_user_store_role(store_id) IN ('ADMIN', 'MANAGER')
);

-- Atualizar Policies Existentes (Sales, Finance, Movements) para usar Multi-Loja
-- Nota: Deixando as policies genéricas 'FOR ALL' que foram separadas no hardening_rls.sql, mas adicionando store_id check.
DROP POLICY IF EXISTS "Sales viewable by authenticated" ON public.sales;
CREATE POLICY "Sales viewable by store access" ON public.sales FOR SELECT TO authenticated USING (public.has_store_access(store_id));

DROP POLICY IF EXISTS "Finance insertable by roles" ON public.financial_transactions;
DROP POLICY IF EXISTS "Finance updatable by roles" ON public.financial_transactions;
DROP POLICY IF EXISTS "Finance deletable by roles" ON public.financial_transactions;
CREATE POLICY "Finance insertable by roles" ON public.financial_transactions FOR INSERT TO authenticated WITH CHECK (public.has_store_access(store_id) AND public.get_user_store_role(store_id) IN ('ADMIN', 'MANAGER', 'CASHIER'));
CREATE POLICY "Finance updatable by roles" ON public.financial_transactions FOR UPDATE TO authenticated USING (public.has_store_access(store_id) AND public.get_user_store_role(store_id) IN ('ADMIN', 'MANAGER', 'CASHIER'));
CREATE POLICY "Finance deletable by roles" ON public.financial_transactions FOR DELETE TO authenticated USING (public.has_store_access(store_id) AND public.get_user_store_role(store_id) IN ('ADMIN'));

-- ============================================================================
-- 4. RPCS REESCRITAS PARA MULTI-LOJA & IDEMPOTÊNCIA
-- ============================================================================

-- COMPLETE_SALE
CREATE OR REPLACE FUNCTION public.complete_sale(
  p_store_id UUID, -- NOVO PARÂMETRO OBRIGATÓRIO
  p_customer_id UUID DEFAULT NULL,
  p_customer_name TEXT DEFAULT 'Cliente não identificado',
  p_customer_cpf TEXT DEFAULT 'Não informado',
  p_items JSONB DEFAULT '[]'::JSONB,
  p_payment_method TEXT DEFAULT 'PIX',
  p_installments INT DEFAULT 1,
  p_discount_value NUMERIC DEFAULT 0,
  p_discount_percent NUMERIC DEFAULT 0,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_sale_id UUID;
  v_sale_number TEXT;
  v_subtotal NUMERIC(12,2) := 0;
  v_total_discount NUMERIC(12,2) := 0;
  v_final_total NUMERIC(12,2) := 0;
  v_item RECORD;
  v_inventory RECORD;
  v_real_price NUMERIC(12,2);
  v_item_total NUMERIC(12,2);
  v_resolved_customer_id UUID := p_customer_id;
  v_normalized_method TEXT;
BEGIN
  -- Segurança Básica
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Não autorizado.'; END IF;

  -- RBAC por Loja
  IF NOT public.has_store_access(p_store_id) THEN
    RAISE EXCEPTION 'Acesso negado à loja especificada.';
  END IF;

  -- Check Idempotência (Se já existir a chave, retorna a venda anterior)
  IF p_idempotency_key IS NOT NULL THEN
    SELECT sale_id INTO v_sale_id FROM public.sale_idempotency WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'message', 'Venda já processada anteriormente (idempotência).');
    END IF;
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Carrinho vazio.'; END IF;

  v_normalized_method := CASE
    WHEN UPPER(p_payment_method) LIKE '%PIX%' THEN 'PIX'
    WHEN UPPER(p_payment_method) LIKE '%DEBIT%' THEN 'DEBIT_CARD'
    WHEN UPPER(p_payment_method) LIKE '%CART%' THEN 'CREDIT_CARD'
    WHEN UPPER(p_payment_method) LIKE '%CASH%' OR UPPER(p_payment_method) LIKE '%DINHEIRO%' THEN 'CASH'
    ELSE 'CASH'
  END;

  IF v_resolved_customer_id IS NULL AND p_customer_cpf IS NOT NULL AND p_customer_cpf NOT IN ('', 'Não informado') THEN
    SELECT id INTO v_resolved_customer_id FROM public.customers WHERE cpf = p_customer_cpf LIMIT 1;
    IF v_resolved_customer_id IS NULL AND p_customer_name IS NOT NULL AND p_customer_name != 'Cliente não identificado' THEN
      INSERT INTO public.customers (name, cpf) VALUES (p_customer_name, p_customer_cpf) RETURNING id INTO v_resolved_customer_id;
    END IF;
  END IF;

  -- BLOQUEIO ATÔMICO DE ESTOQUE (FOR UPDATE)
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS (variant_id UUID, quantity INT, unit_price NUMERIC, product_name TEXT) LOOP
    IF v_item.quantity <= 0 THEN RAISE EXCEPTION 'Quantidade inválida.'; END IF;

    -- Travar apenas o inventário desta loja
    SELECT id, quantity INTO v_inventory 
    FROM public.store_inventory 
    WHERE store_id = p_store_id AND product_variant_id = v_item.variant_id 
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto "%" não possui estoque registrado na loja atual.', v_item.product_name;
    END IF;

    IF v_inventory.quantity < v_item.quantity THEN
      RAISE EXCEPTION 'Estoque insuficiente na filial para "%".', v_item.product_name;
    END IF;

    SELECT p.sale_price INTO v_real_price 
    FROM public.product_variants pv 
    JOIN public.products p ON p.id = pv.product_id 
    WHERE pv.id = v_item.variant_id;
    IF v_real_price IS NULL THEN RAISE EXCEPTION 'Preço não encontrado.'; END IF;

    v_subtotal := v_subtotal + (v_real_price * v_item.quantity);
  END LOOP;

  v_total_discount := COALESCE(p_discount_value, 0) + (v_subtotal * (COALESCE(p_discount_percent, 0) / 100.0));
  v_final_total := GREATEST(0, v_subtotal - v_total_discount);
  v_sale_number := 'PDV #' || nextval('sale_number_seq')::TEXT;

  -- Criar Venda Associada à Loja
  INSERT INTO public.sales (store_id, sale_number, customer_id, user_id, customer_name, customer_cpf, subtotal, discount, total, status) 
  VALUES (p_store_id, v_sale_number, v_resolved_customer_id, v_user_id, COALESCE(p_customer_name, 'Não inf.'), COALESCE(p_customer_cpf, 'Não inf.'), v_subtotal, v_total_discount, v_final_total, 'COMPLETED') 
  RETURNING id INTO v_sale_id;

  -- Registrar Idempotência
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.sale_idempotency (idempotency_key, sale_id) VALUES (p_idempotency_key, v_sale_id);
  END IF;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS (variant_id UUID, quantity INT, unit_price NUMERIC, product_name TEXT, variant_description TEXT) LOOP
    SELECT p.sale_price INTO v_real_price 
    FROM public.product_variants pv 
    JOIN public.products p ON p.id = pv.product_id 
    WHERE pv.id = v_item.variant_id;

    v_item_total := v_real_price * v_item.quantity;

    INSERT INTO public.sale_items (sale_id, product_variant_id, product_name, variant_description, quantity, unit_price, total) 
    VALUES (v_sale_id, v_item.variant_id, v_item.product_name, COALESCE(v_item.variant_description, 'Padrão'), v_item.quantity, v_real_price, v_item_total);

    -- Atualizar Inventário da Loja
    UPDATE public.store_inventory SET quantity = quantity - v_item.quantity WHERE store_id = p_store_id AND product_variant_id = v_item.variant_id;

    -- Registrar Movimentação Isolada
    INSERT INTO public.inventory_movements (store_id, product_variant_id, type, quantity, quantity_before, quantity_after, reference_type, reference_id, user_id, notes) 
    VALUES (p_store_id, v_item.variant_id, 'SALE', v_item.quantity, 
            (SELECT quantity + v_item.quantity FROM public.store_inventory WHERE store_id = p_store_id AND product_variant_id = v_item.variant_id),
            (SELECT quantity FROM public.store_inventory WHERE store_id = p_store_id AND product_variant_id = v_item.variant_id),
            'SALE', v_sale_id, v_user_id, 'Venda ' || v_sale_number);
  END LOOP;

  INSERT INTO public.payments (sale_id, method, amount, status, installments) VALUES (v_sale_id, v_normalized_method, v_final_total, 'APPROVED', GREATEST(1, COALESCE(p_installments, 1)));
  INSERT INTO public.financial_transactions (store_id, type, category, description, amount, status, reference_type, reference_id, paid_at) 
  VALUES (p_store_id, 'INCOME', 'Vendas PDV', 'Venda ' || v_sale_number, v_final_total, 'PAID', 'SALE', v_sale_id, NOW());

  RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'total', v_final_total);
END;
$$;

-- REGISTER_STOCK_ENTRY
CREATE OR REPLACE FUNCTION public.register_stock_entry(
  p_store_id UUID, -- NOVO
  p_variant_id UUID DEFAULT NULL,
  p_quantity INTEGER DEFAULT NULL,
  p_unit_cost NUMERIC DEFAULT NULL,
  p_product_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_stock INTEGER;
  v_new_stock INTEGER;
  v_total_expense NUMERIC(12,2);
  v_user_role TEXT;
BEGIN
  v_user_role := public.get_user_store_role(p_store_id);
  IF v_user_role NOT IN ('ADMIN', 'MANAGER') THEN
    RAISE EXCEPTION 'Permissão negada para dar entrada de estoque nesta loja';
  END IF;

  -- Lock Pessimista
  SELECT quantity INTO v_current_stock FROM public.store_inventory WHERE store_id = p_store_id AND product_variant_id = p_variant_id FOR UPDATE;

  IF NOT FOUND THEN
    -- Se não existir registro de inventário para a loja e produto, inicializar com 0 e travar
    INSERT INTO public.store_inventory (store_id, product_variant_id, quantity) VALUES (p_store_id, p_variant_id, 0) RETURNING quantity INTO v_current_stock;
  END IF;

  v_new_stock := v_current_stock + p_quantity;
  UPDATE public.store_inventory SET quantity = v_new_stock WHERE store_id = p_store_id AND product_variant_id = p_variant_id;

  INSERT INTO public.inventory_movements (store_id, product_variant_id, type, quantity, quantity_before, quantity_after, notes, user_id) 
  VALUES (p_store_id, p_variant_id, 'ENTRY', p_quantity, v_current_stock, v_new_stock, 'Entrada de estoque: ' || p_product_name, auth.uid());

  v_total_expense := p_quantity * p_unit_cost;
  IF v_total_expense > 0 THEN
    INSERT INTO public.financial_transactions (store_id, type, category, description, amount, status, paid_at) 
    VALUES (p_store_id, 'EXPENSE', 'Estoque / Compras', 'Entrada: ' || p_product_name, v_total_expense, 'PAID', NOW());
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- CREATE_MP_PIX_SALE (Venda PENDING, aguardando pagamento)
CREATE OR REPLACE FUNCTION public.create_mp_pix_sale(
  p_store_id UUID,
  p_customer_id UUID DEFAULT NULL,
  p_customer_name TEXT DEFAULT 'Cliente não identificado',
  p_customer_cpf TEXT DEFAULT 'Não informado',
  p_items JSONB DEFAULT '[]'::JSONB,
  p_discount_value NUMERIC DEFAULT 0,
  p_discount_percent NUMERIC DEFAULT 0,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_sale_id UUID;
  v_sale_number TEXT;
  v_subtotal NUMERIC(12,2) := 0;
  v_total_discount NUMERIC(12,2) := 0;
  v_final_total NUMERIC(12,2) := 0;
  v_item RECORD;
  v_inventory RECORD;
  v_item_total NUMERIC(12,2);
  v_real_price NUMERIC(12,2);
  v_resolved_customer_id UUID := p_customer_id;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Não autorizado.'; END IF;
  IF NOT public.has_store_access(p_store_id) THEN RAISE EXCEPTION 'Acesso negado à loja.'; END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT sale_id INTO v_sale_id FROM public.sale_idempotency WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'message', 'Idempotente'); END IF;
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Carrinho vazio.'; END IF;

  IF v_resolved_customer_id IS NULL AND p_customer_cpf IS NOT NULL AND p_customer_cpf NOT IN ('', 'Não informado') THEN
    SELECT id INTO v_resolved_customer_id FROM public.customers WHERE cpf = p_customer_cpf LIMIT 1;
    IF v_resolved_customer_id IS NULL AND p_customer_name IS NOT NULL AND p_customer_name != 'Cliente não identificado' THEN
      INSERT INTO public.customers (name, cpf) VALUES (p_customer_name, p_customer_cpf) RETURNING id INTO v_resolved_customer_id;
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS (variant_id UUID, quantity INT, unit_price NUMERIC, product_name TEXT) LOOP
    IF v_item.quantity <= 0 THEN RAISE EXCEPTION 'Quantidade inválida.'; END IF;
    SELECT id, quantity INTO v_inventory FROM public.store_inventory WHERE store_id = p_store_id AND product_variant_id = v_item.variant_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Produto não possui estoque.'; END IF;
    IF v_inventory.quantity < v_item.quantity THEN RAISE EXCEPTION 'Estoque insuficiente.'; END IF;
    
    SELECT p.sale_price INTO v_real_price 
    FROM public.product_variants pv 
    JOIN public.products p ON p.id = pv.product_id 
    WHERE pv.id = v_item.variant_id;
    IF v_real_price IS NULL THEN RAISE EXCEPTION 'Preço não encontrado.'; END IF;

    v_subtotal := v_subtotal + (v_real_price * v_item.quantity);
  END LOOP;

  v_total_discount := COALESCE(p_discount_value, 0) + (v_subtotal * (COALESCE(p_discount_percent, 0) / 100.0));
  v_final_total := GREATEST(0, v_subtotal - v_total_discount);
  v_sale_number := 'PDV #' || nextval('sale_number_seq')::TEXT;

  INSERT INTO public.sales (store_id, sale_number, customer_id, user_id, customer_name, customer_cpf, subtotal, discount, total, status) 
  VALUES (p_store_id, v_sale_number, v_resolved_customer_id, v_user_id, COALESCE(p_customer_name, 'Não inf.'), COALESCE(p_customer_cpf, 'Não inf.'), v_subtotal, v_total_discount, v_final_total, 'PENDING') 
  RETURNING id INTO v_sale_id;

  IF p_idempotency_key IS NOT NULL THEN INSERT INTO public.sale_idempotency (idempotency_key, sale_id) VALUES (p_idempotency_key, v_sale_id); END IF;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS (variant_id UUID, quantity INT, unit_price NUMERIC, product_name TEXT, variant_description TEXT) LOOP
    SELECT p.sale_price INTO v_real_price 
    FROM public.product_variants pv 
    JOIN public.products p ON p.id = pv.product_id 
    WHERE pv.id = v_item.variant_id;

    v_item_total := v_real_price * v_item.quantity;
    INSERT INTO public.sale_items (sale_id, product_variant_id, product_name, variant_description, quantity, unit_price, total) 
    VALUES (v_sale_id, v_item.variant_id, v_item.product_name, COALESCE(v_item.variant_description, 'Padrão'), v_item.quantity, v_real_price, v_item_total);
    
    UPDATE public.store_inventory SET quantity = quantity - v_item.quantity WHERE store_id = p_store_id AND product_variant_id = v_item.variant_id;
    
    INSERT INTO public.inventory_movements (store_id, product_variant_id, type, quantity, quantity_before, quantity_after, reference_type, reference_id, user_id, notes) 
    VALUES (p_store_id, v_item.variant_id, 'SALE', v_item.quantity, 
            (SELECT quantity + v_item.quantity FROM public.store_inventory WHERE store_id = p_store_id AND product_variant_id = v_item.variant_id),
            (SELECT quantity FROM public.store_inventory WHERE store_id = p_store_id AND product_variant_id = v_item.variant_id),
            'SALE', v_sale_id, v_user_id, 'Venda PENDING ' || v_sale_number);
  END LOOP;

  INSERT INTO public.payments (sale_id, method, amount, status, installments) VALUES (v_sale_id, 'PIX', v_final_total, 'PENDING', 1);
  -- Não gera financeiro INCOME ainda, só na aprovação.

  RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'total', v_final_total);
END;
$$;

-- APPROVE_MP_PIX_SALE
CREATE OR REPLACE FUNCTION public.approve_mp_pix_sale(p_sale_id UUID DEFAULT NULL, p_provider_transaction_id TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sale RECORD;
BEGIN
  IF current_setting('request.jwt.claims', true)::json->>'role' != 'service_role' THEN
    RAISE EXCEPTION 'Não autorizado. Apenas service_role pode aprovar.';
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'message', 'Venda não encontrada'); END IF;
  
  IF v_sale.status = 'COMPLETED' THEN RETURN jsonb_build_object('success', true, 'sale_id', p_sale_id, 'message', 'Idempotente (já aprovada)'); END IF;
  IF v_sale.status = 'CANCELLED' THEN RETURN jsonb_build_object('success', false, 'message', 'Venda cancelada'); END IF;

  UPDATE public.sales SET status = 'COMPLETED', completed_at = NOW() WHERE id = p_sale_id;
  UPDATE public.payments SET status = 'APPROVED', provider_transaction_id = p_provider_transaction_id WHERE sale_id = p_sale_id;
  INSERT INTO public.financial_transactions (store_id, type, category, description, amount, status, reference_type, reference_id, paid_at) 
  VALUES (v_sale.store_id, 'INCOME', 'Vendas PDV', 'Venda PIX ' || v_sale.sale_number, v_sale.total, 'PAID', 'SALE', p_sale_id, NOW());

  RETURN jsonb_build_object('success', true, 'sale_id', p_sale_id);
END;
$$;

-- CANCEL_MP_PIX_SALE
CREATE OR REPLACE FUNCTION public.cancel_mp_pix_sale(p_sale_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sale RECORD;
  v_item RECORD;
BEGIN
  IF auth.uid() IS NULL AND current_setting('request.jwt.claims', true)::json->>'role' != 'service_role' THEN
    RAISE EXCEPTION 'Não autorizado.';
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'message', 'Venda não encontrada'); END IF;

  IF current_setting('request.jwt.claims', true)::json->>'role' != 'service_role' AND (v_sale.user_id IS NULL OR v_sale.user_id != auth.uid()) AND public.get_user_store_role(v_sale.store_id) NOT IN ('ADMIN', 'MANAGER') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Permissão negada');
  END IF;

  IF v_sale.status = 'CANCELLED' THEN RETURN jsonb_build_object('success', true, 'message', 'Venda já cancelada (idempotente)'); END IF;

  FOR v_item IN SELECT si.product_variant_id, si.quantity, inv.quantity AS stock_quantity FROM public.sale_items si
    JOIN public.store_inventory inv ON inv.product_variant_id = si.product_variant_id AND inv.store_id = v_sale.store_id
    WHERE si.sale_id = p_sale_id
  LOOP
    UPDATE public.store_inventory SET quantity = quantity + v_item.quantity WHERE store_id = v_sale.store_id AND product_variant_id = v_item.product_variant_id;
    INSERT INTO public.inventory_movements (store_id, product_variant_id, type, quantity, quantity_before, quantity_after, reference_type, reference_id, notes) 
    VALUES (v_sale.store_id, v_item.product_variant_id, 'CANCELLATION', v_item.quantity, v_item.stock_quantity, v_item.stock_quantity + v_item.quantity, 'SALE', p_sale_id, 'Estorno cancelado');
  END LOOP;

  UPDATE public.sales SET status = 'CANCELLED' WHERE id = p_sale_id;
  UPDATE public.payments SET status = 'CANCELLED' WHERE sale_id = p_sale_id;
  
  -- Estornar financeiro apenas se a venda estava COMPLETED (já havia gerado INCOME)
  IF v_sale.status = 'COMPLETED' THEN
    INSERT INTO public.financial_transactions (store_id, type, category, description, amount, status, reference_type, reference_id)
    SELECT store_id, 'EXPENSE', 'Estornos', 'Estorno PIX cancelado', total, 'PAID', 'SALE', p_sale_id FROM public.sales WHERE id = p_sale_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'sale_id', p_sale_id, 'message', 'Venda cancelada e estoque restaurado');
END;
$$;

-- ============================================================================
-- 5. SEGURANÇA E AUTHENTICATION (Correção Crítica de Cadastro)
-- ============================================================================

-- Remover a leitura do role diretamente dos metadados (prevenindo privilege escalation no cadastro)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(NEW.email, '@', 1)),
    NEW.email,
    'EMPLOYEE' -- Força EMPLOYEE no cadastro independente do metadata enviado
  )
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      email = EXCLUDED.email;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 6. HARDENING SECURITY DEFINER (Search Path e Permissões)
-- ============================================================================

-- Adicionando SET search_path = public para evitar ataques de resolução de nomes
ALTER FUNCTION public.handle_new_user() SET search_path = public;
ALTER FUNCTION public.complete_sale(UUID, UUID, TEXT, TEXT, JSONB, TEXT, INT, NUMERIC, NUMERIC, TEXT) SET search_path = public;
ALTER FUNCTION public.register_stock_entry(UUID, UUID, INTEGER, NUMERIC, TEXT) SET search_path = public;
ALTER FUNCTION public.create_mp_pix_sale(UUID, UUID, TEXT, TEXT, JSONB, NUMERIC, NUMERIC, TEXT) SET search_path = public;
ALTER FUNCTION public.approve_mp_pix_sale(UUID, TEXT) SET search_path = public;
ALTER FUNCTION public.cancel_mp_pix_sale(UUID) SET search_path = public;
ALTER FUNCTION public.current_user_role() SET search_path = public;
ALTER FUNCTION public.protect_profile_role() SET search_path = public;

-- Revogar acesso público geral para todas as RPCs sensíveis
REVOKE EXECUTE ON FUNCTION public.complete_sale(UUID, UUID, TEXT, TEXT, JSONB, TEXT, INT, NUMERIC, NUMERIC, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.register_stock_entry(UUID, UUID, INTEGER, NUMERIC, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_mp_pix_sale(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.manage_product(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, JSONB) FROM PUBLIC;

-- Conceder execução apenas para usuários autenticados
GRANT EXECUTE ON FUNCTION public.complete_sale(UUID, UUID, TEXT, TEXT, JSONB, TEXT, INT, NUMERIC, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_stock_entry(UUID, UUID, INTEGER, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_mp_pix_sale(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manage_product(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, JSONB) TO authenticated;

-- Importante: Webhooks podem usar service_role, que automaticamente tem acesso, mas explicitly we allow it just in case:
GRANT EXECUTE ON FUNCTION public.cancel_mp_pix_sale(UUID) TO service_role;
ALTER FUNCTION public.create_mp_pix_sale(UUID, UUID, TEXT, TEXT, JSONB, NUMERIC, NUMERIC, TEXT) SET search_path = public;
ALTER FUNCTION public.approve_mp_pix_sale(UUID, TEXT) SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.create_mp_pix_sale(UUID, UUID, TEXT, TEXT, JSONB, NUMERIC, NUMERIC, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_mp_pix_sale(UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_mp_pix_sale(UUID, UUID, TEXT, TEXT, JSONB, NUMERIC, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_mp_pix_sale(UUID, TEXT) TO service_role;
-- Webhooks may be authenticated or service_role depending on the setup. The code inside approve_mp_pix_sale enforces service_role via claims anyway.

-- 7. REESCRITA DE MANAGE_PRODUCT (P7 - Auditoria)
-- Garantir validação estrita de Auth/Role interna.
CREATE OR REPLACE FUNCTION public.manage_product(
  p_product_id UUID,
  p_name TEXT,
  p_brand_name TEXT,
  p_category_name TEXT,
  p_sale_price NUMERIC,
  p_cost_price NUMERIC,
  p_variants JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand_id UUID;
  v_category_id UUID;
  v_product_id UUID;
  v_variant RECORD;
  v_variant_ids UUID[] := '{}';
  v_generated_sku TEXT;
  v_idx INT := 1;
  v_user_id UUID;
  v_has_permission BOOLEAN := false;
BEGIN
  -- Segurança Básica Estrita
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Não autorizado (Não autenticado).'; END IF;

  -- Validação de Permissão Administrativa (Global Admin ou Manager de alguma loja)
  IF public.current_user_role() IN ('ADMIN', 'MANAGER') THEN
    v_has_permission := true;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.user_store_access 
      WHERE user_id = v_user_id AND role IN ('ADMIN', 'MANAGER') AND is_active = true
    ) INTO v_has_permission;
  END IF;

  IF NOT v_has_permission THEN
    RAISE EXCEPTION 'Permissão negada. Apenas administradores ou gerentes podem gerenciar produtos globais.';
  END IF;

  IF p_brand_name IS NOT NULL AND trim(p_brand_name) != '' THEN
    SELECT id INTO v_brand_id FROM public.brands WHERE name ILIKE trim(p_brand_name) LIMIT 1;
    IF v_brand_id IS NULL THEN INSERT INTO public.brands (name) VALUES (trim(p_brand_name)) RETURNING id INTO v_brand_id; END IF;
  END IF;

  IF p_category_name IS NOT NULL AND trim(p_category_name) != '' THEN
    SELECT id INTO v_category_id FROM public.categories WHERE name ILIKE trim(p_category_name) LIMIT 1;
    IF v_category_id IS NULL THEN INSERT INTO public.categories (name) VALUES (trim(p_category_name)) RETURNING id INTO v_category_id; END IF;
  END IF;

  IF p_product_id IS NOT NULL THEN
    v_product_id := p_product_id;
    UPDATE public.products SET name = p_name, brand_id = v_brand_id, category_id = v_category_id, sale_price = p_sale_price, cost_price = p_cost_price 
    WHERE id = v_product_id;
  ELSE
    INSERT INTO public.products (name, brand_id, category_id, sale_price, cost_price) 
    VALUES (p_name, v_brand_id, v_category_id, p_sale_price, p_cost_price) RETURNING id INTO v_product_id;
  END IF;

  FOR v_variant IN SELECT * FROM jsonb_to_recordset(p_variants) AS (id UUID, size TEXT, color TEXT, barcode TEXT) LOOP
    v_generated_sku := upper(regexp_replace(p_name, '\s+', '', 'g')) || '-' || upper(COALESCE(v_variant.color, 'P')) || '-' || upper(COALESCE(v_variant.size, 'U')) || '-' || LPAD(v_idx::TEXT, 3, '0');
    v_idx := v_idx + 1;

    IF v_variant.id IS NOT NULL THEN
      UPDATE public.product_variants SET barcode = NULLIF(trim(v_variant.barcode), ''), size = COALESCE(v_variant.size, 'Único'), color = COALESCE(v_variant.color, 'Padrão'), is_active = true WHERE id = v_variant.id;
      v_variant_ids := array_append(v_variant_ids, v_variant.id);
    ELSE
      INSERT INTO public.product_variants (product_id, sku, barcode, size, color, is_active) 
      VALUES (v_product_id, trim(v_generated_sku), NULLIF(trim(v_variant.barcode), ''), COALESCE(v_variant.size, 'Único'), COALESCE(v_variant.color, 'Padrão'), true) 
      RETURNING id INTO v_variant.id;
      v_variant_ids := array_append(v_variant_ids, v_variant.id);
      
      -- Para novos produtos, eles começam com quantidade 0 na loja principal automaticamente via trigger se necessário, 
      -- mas o frontend usará register_stock_entry para adicionar estoque real depois.
    END IF;
  END LOOP;

  UPDATE public.product_variants SET is_active = false WHERE product_id = v_product_id AND NOT (id = ANY(v_variant_ids));
  RETURN jsonb_build_object('success', true, 'product_id', v_product_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.manage_product(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manage_product(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, JSONB) TO authenticated;
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_sales_store_created_at ON public.sales (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_status ON public.sales (status);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_store_variant ON public.inventory_movements (store_id, product_variant_id);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_store_date ON public.financial_transactions (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON public.sale_items (sale_id);
CREATE INDEX IF NOT EXISTS idx_payments_sale_id ON public.payments (sale_id);
CREATE INDEX IF NOT EXISTS idx_user_store_access_user_id ON public.user_store_access (user_id);
CREATE INDEX IF NOT EXISTS idx_sale_idempotency_key ON public.sale_idempotency (idempotency_key);
