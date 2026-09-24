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
  p_store_id UUID,
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
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
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
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autorizado.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store_id AND is_active = true) THEN
    RAISE EXCEPTION 'Loja inválida ou inativa.';
  END IF;

  IF NOT public.has_store_access(p_store_id) THEN
    RAISE EXCEPTION 'Acesso negado à loja especificada.';
  END IF;

  IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
    SELECT sale_id INTO v_sale_id
    FROM public.sale_idempotency
    WHERE idempotency_key = p_idempotency_key
    FOR SHARE;

    IF FOUND THEN
      RETURN (
        SELECT jsonb_build_object(
          'success', true,
          'sale_id', s.id,
          'sale_number', s.sale_number,
          'total', s.total,
          'message', 'Venda já processada anteriormente (idempotência).'
        )
        FROM public.sales s
        WHERE s.id = v_sale_id
      );
    END IF;
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Carrinho vazio.';
  END IF;

  IF COALESCE(p_discount_value, 0) < 0
     OR COALESCE(p_discount_percent, 0) < 0
     OR COALESCE(p_discount_percent, 0) > 100 THEN
    RAISE EXCEPTION 'Desconto inválido.';
  END IF;

  IF COALESCE(p_installments, 1) < 1 OR COALESCE(p_installments, 1) > 24 THEN
    RAISE EXCEPTION 'Número de parcelas inválido.';
  END IF;

  v_normalized_method := CASE
    WHEN UPPER(COALESCE(p_payment_method, '')) LIKE '%PIX%' THEN 'PIX'
    WHEN UPPER(COALESCE(p_payment_method, '')) LIKE '%DEBIT%' THEN 'DEBIT_CARD'
    WHEN UPPER(COALESCE(p_payment_method, '')) LIKE '%CART%' THEN 'CREDIT_CARD'
    WHEN UPPER(COALESCE(p_payment_method, '')) LIKE '%CASH%'
      OR UPPER(COALESCE(p_payment_method, '')) LIKE '%DINHEIRO%' THEN 'CASH'
    WHEN UPPER(COALESCE(p_payment_method, '')) LIKE '%VOUCH%' THEN 'VOUCHER'
    ELSE 'CASH'
  END;

  IF v_resolved_customer_id IS NULL
     AND p_customer_cpf IS NOT NULL
     AND p_customer_cpf NOT IN ('', 'Não informado') THEN
    SELECT id INTO v_resolved_customer_id
    FROM public.customers
    WHERE cpf = trim(p_customer_cpf)
    LIMIT 1;

    IF v_resolved_customer_id IS NULL
       AND p_customer_name IS NOT NULL
       AND p_customer_name <> 'Cliente não identificado' THEN
      INSERT INTO public.customers (name, cpf)
      VALUES (trim(p_customer_name), trim(p_customer_cpf))
      RETURNING id INTO v_resolved_customer_id;
    END IF;
  END IF;

  FOR v_item IN
    SELECT *
    FROM jsonb_to_recordset(p_items) AS (
      variant_id UUID,
      quantity INT,
      unit_price NUMERIC,
      product_name TEXT,
      variant_description TEXT
    )
  LOOP
    IF v_item.variant_id IS NULL OR v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'Item de venda inválido.';
    END IF;

    SELECT si.id, si.quantity
      INTO v_inventory
    FROM public.store_inventory si
    JOIN public.product_variants pv ON pv.id = si.product_variant_id
    JOIN public.products p ON p.id = pv.product_id
    WHERE si.store_id = p_store_id
      AND si.product_variant_id = v_item.variant_id
      AND pv.is_active = true
      AND p.is_active = true
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto não está disponível nesta loja.';
    END IF;

    IF v_inventory.quantity < v_item.quantity THEN
      RAISE EXCEPTION 'Estoque insuficiente para o produto informado.';
    END IF;

    SELECT p.sale_price INTO v_real_price
    FROM public.product_variants pv
    JOIN public.products p ON p.id = pv.product_id
    WHERE pv.id = v_item.variant_id
      AND pv.is_active = true
      AND p.is_active = true;

    IF v_real_price IS NULL OR v_real_price < 0 THEN
      RAISE EXCEPTION 'Preço do produto inválido.';
    END IF;

    v_subtotal := v_subtotal + (v_real_price * v_item.quantity);
  END LOOP;

  v_total_discount := LEAST(
    v_subtotal,
    COALESCE(p_discount_value, 0)
      + (v_subtotal * COALESCE(p_discount_percent, 0) / 100.0)
  );
  v_final_total := ROUND(GREATEST(0, v_subtotal - v_total_discount), 2);
  v_sale_number := 'PDV #' || nextval('sale_number_seq')::TEXT;

  INSERT INTO public.sales (
    store_id,
    sale_number,
    customer_id,
    user_id,
    customer_name,
    customer_cpf,
    subtotal,
    discount,
    total,
    status,
    completed_at
  )
  VALUES (
    p_store_id,
    v_sale_number,
    v_resolved_customer_id,
    v_user_id,
    COALESCE(NULLIF(trim(p_customer_name), ''), 'Cliente não identificado'),
    COALESCE(NULLIF(trim(p_customer_cpf), ''), 'Não informado'),
    ROUND(v_subtotal, 2),
    ROUND(v_total_discount, 2),
    v_final_total,
    'COMPLETED',
    NOW()
  )
  RETURNING id INTO v_sale_id;

  BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
      INSERT INTO public.sale_idempotency (idempotency_key, sale_id)
      VALUES (p_idempotency_key, v_sale_id);
    END IF;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT sale_id INTO v_sale_id
      FROM public.sale_idempotency
      WHERE idempotency_key = p_idempotency_key
      FOR SHARE;

      IF v_sale_id IS NULL THEN
        RAISE;
      END IF;

      RETURN (
        SELECT jsonb_build_object(
          'success', true,
          'sale_id', s.id,
          'sale_number', s.sale_number,
          'total', s.total,
          'message', 'Venda já processada anteriormente (idempotência).'
        )
        FROM public.sales s
        WHERE s.id = v_sale_id
      );
    END;
  END;

  FOR v_item IN
    SELECT *
    FROM jsonb_to_recordset(p_items) AS (
      variant_id UUID,
      quantity INT,
      unit_price NUMERIC,
      product_name TEXT,
      variant_description TEXT
    )
  LOOP
    SELECT p.sale_price INTO v_real_price
    FROM public.product_variants pv
    JOIN public.products p ON p.id = pv.product_id
    WHERE pv.id = v_item.variant_id
      AND pv.is_active = true
      AND p.is_active = true;

    v_item_total := ROUND(v_real_price * v_item.quantity, 2);

    INSERT INTO public.sale_items (
      sale_id,
      product_id,
      product_variant_id,
      product_name,
      variant_description,
      quantity,
      unit_price,
      total
    )
    SELECT
      v_sale_id,
      pv.product_id,
      v_item.variant_id,
      COALESCE(v_item.product_name, p.name),
      COALESCE(v_item.variant_description, pv.size || ' / ' || pv.color),
      v_item.quantity,
      v_real_price,
      v_item_total
    FROM public.product_variants pv
    JOIN public.products p ON p.id = pv.product_id
    WHERE pv.id = v_item.variant_id;

    UPDATE public.store_inventory
    SET quantity = quantity - v_item.quantity
    WHERE store_id = p_store_id
      AND product_variant_id = v_item.variant_id;

    INSERT INTO public.inventory_movements (
      store_id,
      product_variant_id,
      type,
      quantity,
      quantity_before,
      quantity_after,
      reference_type,
      reference_id,
      user_id,
      notes
    )
    SELECT
      p_store_id,
      v_item.variant_id,
      'SALE',
      v_item.quantity,
      si.quantity + v_item.quantity,
      si.quantity,
      'SALE',
      v_sale_id,
      v_user_id,
      'Venda ' || v_sale_number
    FROM public.store_inventory si
    WHERE si.store_id = p_store_id
      AND si.product_variant_id = v_item.variant_id;
  END LOOP;

  INSERT INTO public.payments (
    sale_id, method, amount, status, installments
  )
  VALUES (
    v_sale_id,
    v_normalized_method,
    v_final_total,
    'APPROVED',
    GREATEST(1, COALESCE(p_installments, 1))
  );

  INSERT INTO public.financial_transactions (
    store_id, type, category, description, amount, status, reference_type, reference_id, paid_at
  )
  VALUES (
    p_store_id,
    'INCOME',
    'Vendas PDV',
    'Venda ' || v_sale_number,
    v_final_total,
    'PAID',
    'SALE',
    v_sale_id,
    NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', v_sale_id,
    'sale_number', v_sale_number,
    'total', v_final_total
  );
END;
$$;

-- REGISTER_STOCK_ENTRY
CREATE OR REPLACE FUNCTION public.register_stock_entry(
  p_store_id UUID,
  p_variant_id UUID DEFAULT NULL,
  p_quantity INTEGER DEFAULT NULL,
  p_unit_cost NUMERIC DEFAULT NULL,
  p_product_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_stock INTEGER;
  v_new_stock INTEGER;
  v_total_expense NUMERIC(12,2);
  v_user_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autorizado.';
  END IF;

  v_user_role := public.get_user_store_role(p_store_id);
  IF v_user_role NOT IN ('ADMIN', 'MANAGER') THEN
    RAISE EXCEPTION 'Permissão negada para dar entrada de estoque nesta loja.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store_id AND is_active = true) THEN
    RAISE EXCEPTION 'Loja inválida ou inativa.';
  END IF;

  IF p_variant_id IS NULL THEN
    RAISE EXCEPTION 'Variação do produto é obrigatória.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero.';
  END IF;

  IF p_unit_cost IS NULL OR p_unit_cost < 0 OR NOT isfinite(p_unit_cost) THEN
    RAISE EXCEPTION 'Custo unitário inválido.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.product_variants pv
    JOIN public.products p ON p.id = pv.product_id
    WHERE pv.id = p_variant_id AND pv.is_active = true AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'Produto ou variação inválida.';
  END IF;

  SELECT quantity
    INTO v_current_stock
  FROM public.store_inventory
  WHERE store_id = p_store_id AND product_variant_id = p_variant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.store_inventory (store_id, product_variant_id, quantity)
    VALUES (p_store_id, p_variant_id, 0)
    RETURNING quantity INTO v_current_stock;
  END IF;

  v_new_stock := v_current_stock + p_quantity;

  UPDATE public.store_inventory
  SET quantity = v_new_stock
  WHERE store_id = p_store_id AND product_variant_id = p_variant_id;

  INSERT INTO public.inventory_movements (
    store_id, product_variant_id, type, quantity,
    quantity_before, quantity_after,
    reference_type, user_id, notes
  )
  VALUES (
    p_store_id, p_variant_id, 'ENTRY', p_quantity,
    v_current_stock, v_new_stock,
    'PURCHASE', auth.uid(),
    'Entrada de estoque: ' || COALESCE(p_product_name, '')
  );

  v_total_expense := ROUND(p_quantity * p_unit_cost, 2);

  IF v_total_expense > 0 THEN
    INSERT INTO public.financial_transactions (
      store_id, type, category, description,
      amount, status, reference_type, paid_at
    )
    VALUES (
      p_store_id,
      'EXPENSE',
      'Estoque / Compras',
      'Entrada: ' || COALESCE(p_product_name, ''),
      v_total_expense,
      'PAID',
      'STOCK_ENTRY',
      NOW()
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'quantity', v_new_stock
  );
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
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
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
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Não autorizado.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store_id AND is_active = true) THEN
    RAISE EXCEPTION 'Loja inválida ou inativa.';
  END IF;
  IF NOT public.has_store_access(p_store_id) THEN RAISE EXCEPTION 'Acesso negado à loja.'; END IF;

  IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
    SELECT sale_id INTO v_sale_id FROM public.sale_idempotency
    WHERE idempotency_key = p_idempotency_key
    FOR SHARE;
    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'message', 'Venda PIX já criada (idempotência).');
    END IF;
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Carrinho vazio.'; END IF;
  IF COALESCE(p_discount_value, 0) < 0
     OR COALESCE(p_discount_percent, 0) < 0
     OR COALESCE(p_discount_percent, 0) > 100 THEN
    RAISE EXCEPTION 'Desconto inválido.';
  END IF;

  IF v_resolved_customer_id IS NULL
     AND p_customer_cpf IS NOT NULL
     AND p_customer_cpf NOT IN ('', 'Não informado') THEN
    SELECT id INTO v_resolved_customer_id
    FROM public.customers
    WHERE cpf = trim(p_customer_cpf)
    LIMIT 1;

    IF v_resolved_customer_id IS NULL
       AND p_customer_name IS NOT NULL
       AND p_customer_name <> 'Cliente não identificado' THEN
      INSERT INTO public.customers (name, cpf)
      VALUES (trim(p_customer_name), trim(p_customer_cpf))
      RETURNING id INTO v_resolved_customer_id;
    END IF;
  END IF;

  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(p_items) AS (
      variant_id UUID, quantity INT, unit_price NUMERIC, product_name TEXT, variant_description TEXT
    )
  LOOP
    IF v_item.variant_id IS NULL OR v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'Item de venda inválido.';
    END IF;

    SELECT si.id, si.quantity
      INTO v_inventory
    FROM public.store_inventory si
    JOIN public.product_variants pv ON pv.id = si.product_variant_id
    JOIN public.products p ON p.id = pv.product_id
    WHERE si.store_id = p_store_id
      AND si.product_variant_id = v_item.variant_id
      AND pv.is_active = true
      AND p.is_active = true
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Produto não está disponível nesta loja.'; END IF;
    IF v_inventory.quantity < v_item.quantity THEN RAISE EXCEPTION 'Estoque insuficiente.'; END IF;

    SELECT p.sale_price INTO v_real_price
    FROM public.product_variants pv
    JOIN public.products p ON p.id = pv.product_id
    WHERE pv.id = v_item.variant_id
      AND pv.is_active = true
      AND p.is_active = true;

    IF v_real_price IS NULL OR v_real_price < 0 THEN RAISE EXCEPTION 'Preço do produto inválido.'; END IF;
    v_subtotal := v_subtotal + (v_real_price * v_item.quantity);
  END LOOP;

  v_total_discount := LEAST(
    v_subtotal,
    COALESCE(p_discount_value, 0)
      + (v_subtotal * COALESCE(p_discount_percent, 0) / 100.0)
  );
  v_final_total := ROUND(GREATEST(0, v_subtotal - v_total_discount), 2);
  v_sale_number := 'PDV #' || nextval('sale_number_seq')::TEXT;

  INSERT INTO public.sales (
    store_id, sale_number, customer_id, user_id, customer_name, customer_cpf,
    subtotal, discount, total, status
  )
  VALUES (
    p_store_id,
    v_sale_number,
    v_resolved_customer_id,
    v_user_id,
    COALESCE(NULLIF(trim(p_customer_name), ''), 'Cliente não identificado'),
    COALESCE(NULLIF(trim(p_customer_cpf), ''), 'Não informado'),
    ROUND(v_subtotal, 2),
    ROUND(v_total_discount, 2),
    v_final_total,
    'PENDING'
  )
  RETURNING id INTO v_sale_id;

  BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
      INSERT INTO public.sale_idempotency (idempotency_key, sale_id)
      VALUES (p_idempotency_key, v_sale_id);
    END IF;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT sale_id INTO v_sale_id
      FROM public.sale_idempotency
      WHERE idempotency_key = p_idempotency_key
      FOR SHARE;
      RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'message', 'Venda PIX já criada (idempotência).');
  END;

  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(p_items) AS (
      variant_id UUID, quantity INT, unit_price NUMERIC, product_name TEXT, variant_description TEXT
    )
  LOOP
    SELECT p.sale_price INTO v_real_price
    FROM public.product_variants pv
    JOIN public.products p ON p.id = pv.product_id
    WHERE pv.id = v_item.variant_id
      AND pv.is_active = true
      AND p.is_active = true;

    v_item_total := ROUND(v_real_price * v_item.quantity, 2);

    INSERT INTO public.sale_items (
      sale_id, product_id, product_variant_id, product_name, variant_description,
      quantity, unit_price, total
    )
    SELECT
      v_sale_id, pv.product_id, v_item.variant_id,
      COALESCE(v_item.product_name, p.name),
      COALESCE(v_item.variant_description, pv.size || ' / ' || pv.color),
      v_item.quantity, v_real_price, v_item_total
    FROM public.product_variants pv
    JOIN public.products p ON p.id = pv.product_id
    WHERE pv.id = v_item.variant_id;

    UPDATE public.store_inventory
    SET quantity = quantity - v_item.quantity
    WHERE store_id = p_store_id
      AND product_variant_id = v_item.variant_id;

    INSERT INTO public.inventory_movements (
      store_id, product_variant_id, type, quantity, quantity_before,
      quantity_after, reference_type, reference_id, user_id, notes
    )
    SELECT
      p_store_id, v_item.variant_id, 'SALE', v_item.quantity,
      si.quantity + v_item.quantity, si.quantity,
      'SALE', v_sale_id, v_user_id, 'Venda PIX PENDING ' || v_sale_number
    FROM public.store_inventory si
    WHERE si.store_id = p_store_id
      AND si.product_variant_id = v_item.variant_id;
  END LOOP;

  INSERT INTO public.payments (sale_id, method, amount, status, installments)
  VALUES (v_sale_id, 'PIX', v_final_total, 'PENDING', 1);

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', v_sale_id,
    'sale_number', v_sale_number,
    'total', v_final_total
  );
END;
$$;

-- APPROVE_MP_PIX_SALE
CREATE OR REPLACE FUNCTION public.approve_mp_pix_sale(
  p_sale_id UUID DEFAULT NULL,
  p_provider_transaction_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sale RECORD;
  v_payment RECORD;
BEGIN
  IF current_setting('request.jwt.claims', true)::json->>'role' <> 'service_role' THEN
    RAISE EXCEPTION 'Não autorizado. Apenas service_role pode aprovar.';
  END IF;

  SELECT * INTO v_sale
  FROM public.sales
  WHERE id = p_sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Venda não encontrada');
  END IF;

  IF v_sale.status = 'COMPLETED' THEN
    RETURN jsonb_build_object('success', true, 'sale_id', p_sale_id, 'message', 'Idempotente: venda já aprovada.');
  END IF;

  IF v_sale.status = 'CANCELLED' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Venda cancelada.');
  END IF;

  SELECT * INTO v_payment
  FROM public.payments
  WHERE sale_id = p_sale_id AND method = 'PIX'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND OR v_payment.status = 'APPROVED' THEN
    IF v_payment.status = 'APPROVED' THEN
      RETURN jsonb_build_object('success', true, 'sale_id', p_sale_id, 'message', 'Pagamento já aprovado.');
    END IF;
    RETURN jsonb_build_object('success', false, 'message', 'Pagamento PIX não encontrado.');
  END IF;

  UPDATE public.sales SET status = 'COMPLETED', completed_at = NOW() WHERE id = p_sale_id;
  UPDATE public.payments
  SET status = 'APPROVED', provider = 'MERCADO_PAGO', provider_transaction_id = p_provider_transaction_id
  WHERE id = v_payment.id;

  IF NOT EXISTS (
    SELECT 1
    FROM public.financial_transactions
    WHERE reference_type = 'SALE' AND reference_id = p_sale_id
  ) THEN
    INSERT INTO public.financial_transactions (
      store_id, type, category, description, amount, status, reference_type, reference_id, paid_at
    )
    VALUES (
      v_sale.store_id, 'INCOME', 'Vendas PDV', 'Venda PIX ' || v_sale.sale_number,
      v_sale.total, 'PAID', 'SALE', p_sale_id, NOW()
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'sale_id', p_sale_id, 'message', 'Venda PIX aprovada.');
END;
$$;

-- CANCEL_MP_PIX_SALE
CREATE OR REPLACE FUNCTION public.cancel_mp_pix_sale(p_sale_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sale RECORD;
  v_item RECORD;
  v_is_service_role BOOLEAN;
BEGIN
  v_is_service_role := current_setting('request.jwt.claims', true)::json->>'role' = 'service_role';

  IF auth.uid() IS NULL AND NOT v_is_service_role THEN
    RAISE EXCEPTION 'Não autorizado.';
  END IF;

  SELECT * INTO v_sale
  FROM public.sales
  WHERE id = p_sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Venda não encontrada');
  END IF;

  IF NOT v_is_service_role
     AND (v_sale.user_id IS NULL OR v_sale.user_id <> auth.uid())
     AND public.get_user_store_role(v_sale.store_id) NOT IN ('ADMIN', 'MANAGER') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Permissão negada');
  END IF;

  IF v_sale.status = 'CANCELLED' THEN
    RETURN jsonb_build_object('success', true, 'sale_id', p_sale_id, 'message', 'Venda já cancelada (idempotente).');
  END IF;

  FOR v_item IN
    SELECT si.product_variant_id, si.quantity, inv.quantity AS stock_quantity
    FROM public.sale_items si
    JOIN public.store_inventory inv
      ON inv.product_variant_id = si.product_variant_id
     AND inv.store_id = v_sale.store_id
    WHERE si.sale_id = p_sale_id
  LOOP
    UPDATE public.store_inventory
    SET quantity = quantity + v_item.quantity
    WHERE store_id = v_sale.store_id
      AND product_variant_id = v_item.product_variant_id;

    INSERT INTO public.inventory_movements (
      store_id, product_variant_id, type, quantity, quantity_before,
      quantity_after, reference_type, reference_id, user_id, notes
    )
    VALUES (
      v_sale.store_id,
      v_item.product_variant_id,
      'CANCELLATION',
      v_item.quantity,
      v_item.stock_quantity,
      v_item.stock_quantity + v_item.quantity,
      'SALE',
      p_sale_id,
      auth.uid(),
      'Cancelamento PIX'
    );
  END LOOP;

  UPDATE public.sales SET status = 'CANCELLED' WHERE id = p_sale_id;
  UPDATE public.payments SET status = 'CANCELLED' WHERE sale_id = p_sale_id;

  IF v_sale.status = 'COMPLETED'
     AND NOT EXISTS (
       SELECT 1 FROM public.financial_transactions
       WHERE reference_type = 'SALE'
         AND reference_id = p_sale_id
         AND type = 'EXPENSE'
     ) THEN
    INSERT INTO public.financial_transactions (
      store_id, type, category, description, amount, status, reference_type, reference_id
    )
    VALUES (
      v_sale.store_id, 'EXPENSE', 'Estornos', 'Estorno PIX cancelado',
      v_sale.total, 'PAID', 'SALE', p_sale_id
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', p_sale_id,
    'message', 'Venda cancelada e estoque restaurado.'
  );
END;
$$;


