-- ============================================================================
-- VESTRA ERP - SCHEMA CONSOLIDADO SUPABASE / POSTGRESQL
-- Multi-Brand Retail Management & POS
-- ============================================================================

-- Habilitar extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. PROFILES & ROLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'MANAGER', 'CASHIER', 'EMPLOYEE')) DEFAULT 'EMPLOYEE',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc', NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Trigger para criar profile automaticamente quando novo usuário se cadastrar
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(NEW.email, '@', 1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'EMPLOYEE') -- Padrão EMPLOYEE; defina 'ADMIN' via metadados no cadastro
  )
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      email = EXCLUDED.email;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- 2. BRANDS & CATEGORIES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  logo_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TRIGGER update_brands_updated_at
  BEFORE UPDATE ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE IF NOT EXISTS public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TRIGGER update_categories_updated_at
  BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================================
-- 3. PRODUCTS & PRODUCT VARIANTS (SKUs)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID REFERENCES public.brands(id) ON DELETE SET NULL,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  cost_price NUMERIC(12,2) DEFAULT 0,
  sale_price NUMERIC(12,2) NOT NULL CHECK (sale_price >= 0),
  minimum_stock INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_products_name ON public.products(name);
CREATE INDEX IF NOT EXISTS idx_products_brand ON public.products(brand_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category_id);

CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE IF NOT EXISTS public.product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sku TEXT UNIQUE NOT NULL,
  barcode TEXT UNIQUE,
  size TEXT NOT NULL DEFAULT 'Único',
  color TEXT NOT NULL DEFAULT 'Padrão',
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_variants_product_id ON public.product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_variants_sku ON public.product_variants(sku);
CREATE INDEX IF NOT EXISTS idx_variants_barcode ON public.product_variants(barcode);

CREATE TRIGGER update_product_variants_updated_at
  BEFORE UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================================
-- 4. CUSTOMERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  cpf TEXT UNIQUE,
  phone TEXT,
  email TEXT,
  address TEXT,
  birth_date DATE,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_customers_name ON public.customers(name);
CREATE INDEX IF NOT EXISTS idx_customers_cpf ON public.customers(cpf);

CREATE TRIGGER update_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================================
-- 5. SUPPLIERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  contact_name TEXT,
  document TEXT UNIQUE, -- CNPJ ou CPF
  email TEXT,
  phone TEXT,
  address TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_suppliers_name ON public.suppliers(company_name);
CREATE INDEX IF NOT EXISTS idx_suppliers_document ON public.suppliers(document);

CREATE TRIGGER update_suppliers_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================================
-- 6. INVENTORY MOVEMENTS (Auditoria e rastreio de estoque)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_variant_id UUID NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('ENTRY', 'SALE', 'RETURN', 'ADJUSTMENT', 'CANCELLATION')),
  quantity INTEGER NOT NULL,
  quantity_before INTEGER NOT NULL,
  quantity_after INTEGER NOT NULL,
  reference_type TEXT, -- 'SALE', 'PURCHASE', 'MANUAL_ADJUSTMENT'
  reference_id UUID,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_inventory_mov_variant ON public.inventory_movements(product_variant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_mov_created ON public.inventory_movements(created_at);

-- ============================================================================
-- 7. COUPONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('percentual', 'fixo')),
  value NUMERIC(12,2) NOT NULL CHECK (value > 0),
  expires_at DATE NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 100,
  uses_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TRIGGER update_coupons_updated_at
  BEFORE UPDATE ON public.coupons
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================================
-- 8. SALES & SALE ITEMS
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS sale_number_seq START WITH 1001;

CREATE TABLE IF NOT EXISTS public.sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_number TEXT UNIQUE NOT NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  customer_name TEXT,
  customer_cpf TEXT,
  subtotal NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
  discount NUMERIC(12,2) DEFAULT 0 CHECK (discount >= 0),
  total NUMERIC(12,2) NOT NULL CHECK (total >= 0),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'CANCELLED', 'REFUNDED')) DEFAULT 'COMPLETED',
  coupon_code TEXT,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  completed_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_sales_number ON public.sales(sale_number);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON public.sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON public.sales(created_at);

CREATE TABLE IF NOT EXISTS public.sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  variant_description TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  discount NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) NOT NULL CHECK (total >= 0),
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON public.sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_variant ON public.sale_items(product_variant_id);

-- ============================================================================
-- 9. PAYMENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH', 'VOUCHER')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'APPROVED', 'DECLINED', 'CANCELLED', 'REFUNDED')) DEFAULT 'APPROVED',
  installments INTEGER DEFAULT 1 CHECK (installments >= 1),
  provider TEXT,
  provider_transaction_id TEXT,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_payments_sale_id ON public.payments(sale_id);

CREATE TRIGGER update_payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================================
-- 10. FINANCIAL TRANSACTIONS & FIXED EXPENSES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.financial_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('INCOME', 'EXPENSE')),
  category TEXT,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PAID', 'CANCELLED')) DEFAULT 'PAID',
  reference_type TEXT, -- 'SALE', 'STOCK_ENTRY', 'FIXED_EXPENSE', etc.
  reference_id UUID,
  due_date DATE,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_financial_created_at ON public.financial_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_financial_type ON public.financial_transactions(type);

CREATE TRIGGER update_financial_transactions_updated_at
  BEFORE UPDATE ON public.financial_transactions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE IF NOT EXISTS public.fixed_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  due_date DATE NOT NULL,
  category TEXT,
  recurring BOOLEAN DEFAULT true,
  paid BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TRIGGER update_fixed_expenses_updated_at
  BEFORE UPDATE ON public.fixed_expenses
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================================
-- 11. RPC: complete_sale (TRANSAÇÃO ATÔMICA CRÍTICA DE VENDA NO PDV)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.complete_sale(
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
  v_variant RECORD;
  v_item_total NUMERIC(12,2);
  v_current_stock INT;
  -- v_coupon RECORD removido (cupons descontinuados)
  v_resolved_customer_id UUID := p_customer_id;
  v_normalized_method TEXT;
BEGIN
  -- 1. Obter usuário autenticado (ou NULL)
  v_user_id := auth.uid();

  -- 2. Validar se há itens
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Carrinho vazio. Adicione ao menos um item.';
  END IF;

  -- 3. Normalizar método de pagamento
  v_normalized_method := CASE
    WHEN UPPER(p_payment_method) LIKE '%PIX%'    THEN 'PIX'
    WHEN UPPER(p_payment_method) LIKE '%DEBIT%'  THEN 'DEBIT_CARD'
    WHEN UPPER(p_payment_method) LIKE '%CART%'   THEN 'CREDIT_CARD'
    WHEN UPPER(p_payment_method) LIKE '%CASH%'
      OR UPPER(p_payment_method) LIKE '%DINHEIRO%' THEN 'CASH'
    ELSE 'CASH'  -- fallback seguro
  END;

  -- 4. Tratar / Vincular Cliente por CPF se não fornecido id
  IF v_resolved_customer_id IS NULL AND p_customer_cpf IS NOT NULL AND p_customer_cpf NOT IN ('', 'Não informado') THEN
    SELECT id INTO v_resolved_customer_id FROM public.customers WHERE cpf = p_customer_cpf LIMIT 1;
    
    IF v_resolved_customer_id IS NULL AND p_customer_name IS NOT NULL AND p_customer_name != 'Cliente não identificado' THEN
      INSERT INTO public.customers (name, cpf)
      VALUES (p_customer_name, p_customer_cpf)
      RETURNING id INTO v_resolved_customer_id;
    END IF;
  END IF;

  -- 5. Calcular Subtotal e Validar Estoque com Lock Concorrente (FOR UPDATE)
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS (
    variant_id UUID,
    quantity INT,
    unit_price NUMERIC,
    product_id UUID,
    product_name TEXT,
    variant_description TEXT
  ) LOOP
    IF v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'Quantidade do item deve ser maior que zero.';
    END IF;

    -- Bloquear a linha da variante para leitura/escrita atômica
    SELECT id, stock_quantity, product_id, size, color
    INTO v_variant
    FROM public.product_variants
    WHERE id = v_item.variant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variação do produto % não encontrada (ID: %).', v_item.product_name, v_item.variant_id;
    END IF;

    IF v_variant.stock_quantity < v_item.quantity THEN
      RAISE EXCEPTION 'Estoque insuficiente para "%" (% / %). Disponível: %, Solicitado: %',
        v_item.product_name, v_variant.size, v_variant.color, v_variant.stock_quantity, v_item.quantity;
    END IF;

    v_subtotal := v_subtotal + (COALESCE(v_item.unit_price, 0) * v_item.quantity);
  END LOOP;

  -- 7. Calcular Total Final
  v_total_discount := COALESCE(p_discount_value, 0) + (v_subtotal * (COALESCE(p_discount_percent, 0) / 100.0));
  v_final_total := GREATEST(0, v_subtotal - v_total_discount);

  -- 8. Gerar Número da Venda
  v_sale_number := 'PDV #' || nextval('sale_number_seq')::TEXT;

  -- 9. Inserir Registro em SALES
  INSERT INTO public.sales (
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
  ) VALUES (
    v_sale_number,
    v_resolved_customer_id,
    v_user_id,
    COALESCE(p_customer_name, 'Cliente não identificado'),
    COALESCE(p_customer_cpf, 'Não informado'),
    v_subtotal,
    v_total_discount,
    v_final_total,
    'COMPLETED',
    NOW()
  ) RETURNING id INTO v_sale_id;

  -- 10. Inserir SALE_ITEMS e Atualizar Estoque + Registrar MOVIMENTAÇÃO
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS (
    variant_id UUID,
    quantity INT,
    unit_price NUMERIC,
    product_id UUID,
    product_name TEXT,
    variant_description TEXT
  ) LOOP
    v_item_total := COALESCE(v_item.unit_price, 0) * v_item.quantity;

    -- Inserir item da venda
    INSERT INTO public.sale_items (
      sale_id,
      product_id,
      product_variant_id,
      product_name,
      variant_description,
      quantity,
      unit_price,
      total
    ) VALUES (
      v_sale_id,
      v_item.product_id,
      v_item.variant_id,
      v_item.product_name,
      COALESCE(v_item.variant_description, 'Padrão'),
      v_item.quantity,
      v_item.unit_price,
      v_item_total
    );

    -- Baixar estoque na variante
    SELECT stock_quantity INTO v_current_stock
    FROM public.product_variants
    WHERE id = v_item.variant_id;

    UPDATE public.product_variants
    SET stock_quantity = stock_quantity - v_item.quantity
    WHERE id = v_item.variant_id;

    -- Registrar histórico de movimentação
    INSERT INTO public.inventory_movements (
      product_variant_id,
      type,
      quantity,
      quantity_before,
      quantity_after,
      reference_type,
      reference_id,
      user_id,
      notes
    ) VALUES (
      v_item.variant_id,
      'SALE',
      v_item.quantity,
      v_current_stock,
      v_current_stock - v_item.quantity,
      'SALE',
      v_sale_id,
      v_user_id,
      'Venda finalizada ' || v_sale_number
    );
  END LOOP;

  -- 11. Registrar Pagamento
  INSERT INTO public.payments (
    sale_id,
    method,
    amount,
    status,
    installments
  ) VALUES (
    v_sale_id,
    v_normalized_method,
    v_final_total,
    'APPROVED',
    GREATEST(1, COALESCE(p_installments, 1))
  );

  -- 12. Criar Transação Financeira de Receita (INCOME)
  INSERT INTO public.financial_transactions (
    type,
    category,
    description,
    amount,
    status,
    reference_type,
    reference_id,
    paid_at
  ) VALUES (
    'INCOME',
    'Vendas PDV',
    'Venda ' || v_sale_number || ' - ' || COALESCE(p_customer_name, 'Consumidor Final'),
    v_final_total,
    'PAID',
    'SALE',
    v_sale_id,
    NOW()
  );

  -- 13. Retornar payload consolidado
  RETURN jsonb_build_object(
    'success', true,
    'sale_id', v_sale_id,
    'sale_number', v_sale_number,
    'subtotal', v_subtotal,
    'discount', v_total_discount,
    'total', v_final_total,
    'customer_name', COALESCE(p_customer_name, 'Cliente não identificado'),
    'payment_method', v_normalized_method,
    'completed_at', NOW()
  );
END;
$$;

-- ============================================================================
-- RPC: cancel_mp_pix_sale (Rollback de estoque para PIX não pago)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cancel_mp_pix_sale(
  p_sale_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sale RECORD;
  v_item RECORD;
BEGIN
  -- 1. Verificar se a venda existe e está PENDING ou COMPLETED (evitar double-cancel)
  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Venda não encontrada');
  END IF;

  IF v_sale.status = 'CANCELLED' THEN
    RETURN jsonb_build_object('success', true, 'message', 'Venda já cancelada (idempotente)');
  END IF;

  -- 2. Restaurar estoque de cada item da venda
  FOR v_item IN
    SELECT si.product_variant_id, si.quantity, pv.stock_quantity
    FROM public.sale_items si
    JOIN public.product_variants pv ON pv.id = si.product_variant_id
    WHERE si.sale_id = p_sale_id
  LOOP
    -- Incrementar estoque atomicamente
    UPDATE public.product_variants
      SET stock_quantity = stock_quantity + v_item.quantity
    WHERE id = v_item.product_variant_id;

    -- Registrar movimentação de devolução
    INSERT INTO public.inventory_movements (
      product_variant_id, type, quantity,
      quantity_before, quantity_after,
      reference_type, reference_id, notes
    ) VALUES (
      v_item.product_variant_id, 'CANCELLATION', v_item.quantity,
      v_item.stock_quantity, v_item.stock_quantity + v_item.quantity,
      'SALE', p_sale_id, 'Estorno: PIX cancelado/expirado'
    );
  END LOOP;

  -- 3. Marcar venda como CANCELADA
  UPDATE public.sales SET status = 'CANCELLED' WHERE id = p_sale_id;

  -- 4. Cancelar pagamento associado
  UPDATE public.payments SET status = 'CANCELLED' WHERE sale_id = p_sale_id;

  -- 5. Estornar transação financeira (registrar saída de estorno)
  INSERT INTO public.financial_transactions (
    type, category, description, amount, status, reference_type, reference_id
  )
  SELECT 'EXPENSE', 'Estornos', 'Estorno PIX cancelado - venda ' || v_sale.sale_number,
         v_sale.total, 'PAID', 'SALE', p_sale_id;

  RETURN jsonb_build_object('success', true, 'sale_id', p_sale_id, 'message', 'Venda cancelada e estoque restaurado');
END;
$$;


-- ============================================================================
-- RPC: increment_variant_stock (Incremento atômico de estoque — sem race condition)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.increment_variant_stock(
  p_variant_id UUID,
  p_amount INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.product_variants
    SET stock_quantity = stock_quantity + p_amount
  WHERE id = p_variant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variante % não encontrada', p_variant_id;
  END IF;
END;
$$;

-- Índices de performance adicionais
CREATE INDEX IF NOT EXISTS idx_sales_status ON public.sales(status);
CREATE INDEX IF NOT EXISTS idx_financial_status ON public.financial_transactions(status);
CREATE INDEX IF NOT EXISTS idx_financial_type ON public.financial_transactions(type);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(status);

-- ============================================================================
-- 12. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixed_expenses ENABLE ROW LEVEL SECURITY;

-- Helper function para checar role do usuário
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Policies para PROFILES
CREATE POLICY "Profiles are viewable by authenticated users"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update own profile or Admins can update any"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid() OR public.current_user_role() = 'ADMIN');

-- Policies para BRANDS & CATEGORIES (Leitura pública/autenticada, escrita staff)
CREATE POLICY "Brands viewable by authenticated"
  ON public.brands FOR SELECT TO authenticated USING (true);
CREATE POLICY "Brands manageable by Admin and Manager"
  ON public.brands FOR ALL TO authenticated USING (public.current_user_role() IN ('ADMIN', 'MANAGER'));

CREATE POLICY "Categories viewable by authenticated"
  ON public.categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Categories manageable by Admin and Manager"
  ON public.categories FOR ALL TO authenticated USING (public.current_user_role() IN ('ADMIN', 'MANAGER'));

-- Policies para PRODUCTS & VARIANTS
CREATE POLICY "Products viewable by authenticated"
  ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "Products manageable by Admin and Manager"
  ON public.products FOR ALL TO authenticated USING (public.current_user_role() IN ('ADMIN', 'MANAGER'));

CREATE POLICY "Variants viewable by authenticated"
  ON public.product_variants FOR SELECT TO authenticated USING (true);
CREATE POLICY "Variants manageable by Admin and Manager"
  ON public.product_variants FOR ALL TO authenticated USING (public.current_user_role() IN ('ADMIN', 'MANAGER'));

-- Policies para CUSTOMERS (Visualização e criação por todos autenticados)
CREATE POLICY "Customers viewable by authenticated"
  ON public.customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Customers manageable by authenticated"
  ON public.customers FOR ALL TO authenticated USING (true);

-- Policies para SUPPLIERS
CREATE POLICY "Suppliers viewable by authenticated"
  ON public.suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Suppliers manageable by Admin and Manager"
  ON public.suppliers FOR ALL TO authenticated USING (public.current_user_role() IN ('ADMIN', 'MANAGER'));

-- Policies para INVENTORY MOVEMENTS
CREATE POLICY "Movements viewable by authenticated"
  ON public.inventory_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "Movements insertable by authenticated"
  ON public.inventory_movements FOR INSERT TO authenticated WITH CHECK (true);

-- Policies para SALES, SALE_ITEMS, PAYMENTS
CREATE POLICY "Sales viewable by authenticated"
  ON public.sales FOR SELECT TO authenticated USING (true);
CREATE POLICY "Sales insertable by authenticated"
  ON public.sales FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Sale items viewable by authenticated"
  ON public.sale_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Sale items insertable by authenticated"
  ON public.sale_items FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Payments viewable by authenticated"
  ON public.payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Payments insertable by authenticated"
  ON public.payments FOR INSERT TO authenticated WITH CHECK (true);

-- Policies para FINANCIAL & EXPENSES
CREATE POLICY "Finance viewable by authenticated"
  ON public.financial_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Finance manageable by Admin and Manager"
  ON public.financial_transactions FOR ALL TO authenticated USING (public.current_user_role() IN ('ADMIN', 'MANAGER', 'CASHIER'));

CREATE POLICY "Fixed expenses viewable by authenticated"
  ON public.fixed_expenses FOR SELECT TO authenticated USING (true);
CREATE POLICY "Fixed expenses manageable by Admin and Manager"
  ON public.fixed_expenses FOR ALL TO authenticated USING (public.current_user_role() IN ('ADMIN', 'MANAGER'));

-- Policies para COUPONS
CREATE POLICY "Coupons viewable by authenticated"
  ON public.coupons FOR SELECT TO authenticated USING (true);
CREATE POLICY "Coupons manageable by Admin and Manager"
  ON public.coupons FOR ALL TO authenticated USING (public.current_user_role() IN ('ADMIN', 'MANAGER'));

-- ============================================================================
-- 13. STORAGE BUCKETS CONFIGURATION
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES 
  ('product-images', 'product-images', true),
  ('brand-logos', 'brand-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Políticas de Storage para leitura pública e upload autenticado
CREATE POLICY "Public Read Product Images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'product-images');

CREATE POLICY "Authenticated Upload Product Images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "Public Read Brand Logos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'brand-logos');

CREATE POLICY "Authenticated Upload Brand Logos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'brand-logos');

-- ============================================================================
-- 14. SEED DATA INICIAL
-- ============================================================================

-- Inserir Marcas
INSERT INTO public.brands (id, name, description)
VALUES
  ('a1b2c3d4-0001-0000-0000-000000000001', 'Cyclone', 'Moda street wear e surf wear'),
  ('a1b2c3d4-0002-0000-0000-000000000002', 'Oakley', 'Vestuário e acessórios esportivos premium'),
  ('a1b2c3d4-0003-0000-0000-000000000003', 'Kenner', 'Calçados e sandálias de alta durabilidade'),
  ('a1b2c3d4-0004-0000-0000-000000000004', 'High', 'Moda urbana e skate wear'),
  ('a1b2c3d4-0005-0000-0000-000000000005', 'Nike', 'Vestuário esportivo e lifestyle')
ON CONFLICT (name) DO NOTHING;

-- Inserir Categorias
INSERT INTO public.categories (id, name, description)
VALUES
  ('c1b2c3d4-0001-0000-0000-000000000001', 'Camisas', 'Camisetas e regatas'),
  ('c1b2c3d4-0002-0000-0000-000000000002', 'Jaquetas', 'Casacos e corta-ventos'),
  ('c1b2c3d4-0003-0000-0000-000000000003', 'Calçados', 'Tênis e sandálias'),
  ('c1b2c3d4-0004-0000-0000-000000000004', 'Acessórios', 'Bonés, mochilas e carteiras'),
  ('c1b2c3d4-0005-0000-0000-000000000005', 'Moletons', 'Moletons canguru e gola careca'),
  ('c1b2c3d4-0006-0000-0000-000000000006', 'Calças', 'Calças e bermudas')
ON CONFLICT (name) DO NOTHING;

-- Inserir Produtos
INSERT INTO public.products (id, brand_id, category_id, name, cost_price, sale_price, minimum_stock)
VALUES
  ('d1000000-0000-0000-0000-000000000001', 'a1b2c3d4-0001-0000-0000-000000000001', 'c1b2c3d4-0001-0000-0000-000000000001', 'Camisa Cyclone', 45.00, 89.90, 5),
  ('d1000000-0000-0000-0000-000000000002', 'a1b2c3d4-0002-0000-0000-000000000002', 'c1b2c3d4-0002-0000-0000-000000000002', 'Jaqueta Oakley', 120.00, 229.90, 2),
  ('d1000000-0000-0000-0000-000000000003', 'a1b2c3d4-0003-0000-0000-000000000003', 'c1b2c3d4-0003-0000-0000-000000000003', 'Tênis Kenner', 85.00, 159.90, 3),
  ('d1000000-0000-0000-0000-000000000004', 'a1b2c3d4-0004-0000-0000-000000000004', 'c1b2c3d4-0004-0000-0000-000000000004', 'Boné High', 22.00, 49.90, 5),
  ('d1000000-0000-0000-0000-000000000005', 'a1b2c3d4-0005-0000-0000-000000000005', 'c1b2c3d4-0001-0000-0000-000000000001', 'Regata Nike', 32.00, 69.90, 4),
  ('d1000000-0000-0000-0000-000000000006', 'a1b2c3d4-0001-0000-0000-000000000001', 'c1b2c3d4-0005-0000-0000-000000000005', 'Moletom Cyclone', 75.00, 149.90, 3),
  ('d1000000-0000-0000-0000-000000000007', 'a1b2c3d4-0002-0000-0000-000000000002', 'c1b2c3d4-0006-0000-0000-000000000006', 'Short Oakley', 48.00, 99.90, 2),
  ('d1000000-0000-0000-0000-000000000008', 'a1b2c3d4-0003-0000-0000-000000000003', 'c1b2c3d4-0001-0000-0000-000000000001', 'Camisa Kenner', 38.00, 79.90, 3),
  ('d1000000-0000-0000-0000-000000000009', 'a1b2c3d4-0004-0000-0000-000000000004', 'c1b2c3d4-0003-0000-0000-000000000003', 'Tênis High', 65.00, 129.90, 2),
  ('d1000000-0000-0000-0000-000000000010', 'a1b2c3d4-0005-0000-0000-000000000005', 'c1b2c3d4-0001-0000-0000-000000000001', 'Camiseta Nike', 28.00, 59.90, 4)
ON CONFLICT (id) DO NOTHING;

-- Inserir Variantes / SKUs dos Produtos
INSERT INTO public.product_variants (product_id, sku, size, color, stock_quantity)
VALUES
  ('d1000000-0000-0000-0000-000000000001', 'CYC-CAM-P-BLK', 'P', 'Preto', 12),
  ('d1000000-0000-0000-0000-000000000001', 'CYC-CAM-M-BLK', 'M', 'Preto', 8),
  ('d1000000-0000-0000-0000-000000000001', 'CYC-CAM-G-BLK', 'G', 'Preto', 3),
  ('d1000000-0000-0000-0000-000000000002', 'OAK-JAQ-M-BLU', 'M', 'Azul', 5),
  ('d1000000-0000-0000-0000-000000000002', 'OAK-JAQ-G-BLU', 'G', 'Azul', 2),
  ('d1000000-0000-0000-0000-000000000003', 'KEN-TEN-P-WHT', 'P', 'Branco', 0),
  ('d1000000-0000-0000-0000-000000000003', 'KEN-TEN-M-WHT', 'M', 'Branco', 4),
  ('d1000000-0000-0000-0000-000000000003', 'KEN-TEN-G-WHT', 'G', 'Branco', 6),
  ('d1000000-0000-0000-0000-000000000004', 'HGH-BON-U-BLK', 'Único', 'Preto', 15),
  ('d1000000-0000-0000-0000-000000000005', 'NIK-REG-P-RED', 'P', 'Vermelho', 7),
  ('d1000000-0000-0000-0000-000000000005', 'NIK-REG-M-RED', 'M', 'Vermelho', 3),
  ('d1000000-0000-0000-0000-000000000006', 'CYC-MOL-M-GRY', 'M', 'Cinza', 10),
  ('d1000000-0000-0000-0000-000000000006', 'CYC-MOL-G-GRY', 'G', 'Cinza', 4),
  ('d1000000-0000-0000-0000-000000000007', 'OAK-SHO-P-BLK', 'P', 'Preto', 2),
  ('d1000000-0000-0000-0000-000000000007', 'OAK-SHO-M-BLK', 'M', 'Preto', 0),
  ('d1000000-0000-0000-0000-000000000008', 'KEN-CAM-G-WHT', 'G', 'Branco', 1),
  ('d1000000-0000-0000-0000-000000000008', 'KEN-CAM-M-WHT', 'M', 'Branco', 9),
  ('d1000000-0000-0000-0000-000000000009', 'HGH-TEN-P-BLK', 'P', 'Preto', 0),
  ('d1000000-0000-0000-0000-000000000009', 'HGH-TEN-M-BLK', 'M', 'Preto', 0),
  ('d1000000-0000-0000-0000-000000000010', 'NIK-CAM-G-BLU', 'G', 'Azul', 6)
ON CONFLICT (sku) DO NOTHING;

-- Inserir Clientes
INSERT INTO public.customers (name, cpf, phone, email, address)
VALUES
  ('João Silva', '123.456.789-00', '(11) 99999-9999', 'joao@email.com', 'Rua das Flores, 123'),
  ('Maria Santos', '987.654.321-00', '(11) 88888-8888', 'maria@email.com', 'Av. Principal, 456')
ON CONFLICT (cpf) DO NOTHING;

-- Inserir Fornecedores
INSERT INTO public.suppliers (company_name, contact_name, document, email, phone, address)
VALUES
  ('Distribuidora XYZ Ltda', 'Carlos Gerente', '12.345.678/0001-99', 'contato@xyz.com', '(11) 3333-4444', 'Rua Comercial, 789')
ON CONFLICT (document) DO NOTHING;

-- Inserir Despesas Fixas
INSERT INTO public.fixed_expenses (description, amount, due_date, category, paid)
VALUES
  ('Aluguel Comercial', 1500.00, '2026-08-25', 'Aluguel', false),
  ('Folha de Salários', 5000.00, '2026-08-30', 'Pessoal', false)
ON CONFLICT DO NOTHING;

-- Inserir Cupons
INSERT INTO public.coupons (code, type, value, expires_at, max_uses, uses_count)
VALUES
  ('BLACK20', 'percentual', 20.00, '2026-12-31', 100, 0)
ON CONFLICT (code) DO NOTHING;

-- Inserir Transações Financeiras Iniciais
INSERT INTO public.financial_transactions (type, category, description, amount, status, created_at)
VALUES
  ('entrada', 'Vendas PDV', 'Venda PDV #1001', 189.90, 'PAID', NOW() - INTERVAL '30 days'),
  ('entrada', 'Vendas PDV', 'Venda PDV #1002', 279.80, 'PAID', NOW() - INTERVAL '25 days'),
  ('saida', 'Operacional', 'Pagamento de Luz', 120.00, 'PAID', NOW() - INTERVAL '20 days'),
  ('entrada', 'Vendas PDV', 'Venda PDV #1003', 459.70, 'PAID', NOW() - INTERVAL '5 days')
ON CONFLICT DO NOTHING;
