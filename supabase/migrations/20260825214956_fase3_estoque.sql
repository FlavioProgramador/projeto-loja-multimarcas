-- FASE 3 - ESTOQUE PROFISSIONAL

-- ============================================================================
-- 1. LOJAS (STORES) E PREPARAÇÃO PARA TRANSFERÊNCIAS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  location TEXT,
  is_main BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- Inserir Loja Padrão se não existir
INSERT INTO public.stores (name, is_main)
SELECT 'Loja Principal (Padrão)', true
WHERE NOT EXISTS (SELECT 1 FROM public.stores LIMIT 1);

-- ============================================================================
-- 2. AJUSTES NO ESTOQUE (PRODUTOS E VARIANTES)
-- ============================================================================
-- Adicionar campos de controle de estoque e reservas
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS minimum_stock INTEGER DEFAULT 0;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS reserved_quantity INTEGER DEFAULT 0;

-- ============================================================================
-- 3. PADRONIZAÇÃO DE MOVIMENTAÇÕES DE ESTOQUE
-- ============================================================================
-- Adicionar coluna store_id e motivo/reason
ALTER TABLE public.inventory_movements ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES public.stores(id);
ALTER TABLE public.inventory_movements ADD COLUMN IF NOT EXISTS reason TEXT;

-- Atualizar CHECK constraint para incluir todos os tipos padronizados
ALTER TABLE public.inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_type_check;
ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_type_check 
  CHECK (type IN (
    'PURCHASE', 'SALE', 'RETURN', 'ADJUSTMENT', 'LOSS', 
    'TRANSFER_IN', 'TRANSFER_OUT', 'INITIAL', 'CORRECTION',
    'ENTRY', 'CANCELLATION' -- Mantidos por retrocompatibilidade
  ));

-- ============================================================================
-- 4. HISTÓRICO IMUTÁVEL DE MOVIMENTAÇÕES
-- ============================================================================
-- Bloquear DELETE
CREATE OR REPLACE FUNCTION public.prevent_inventory_movement_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Histórico imutável: Movimentações de estoque não podem ser excluídas.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_delete_movement ON public.inventory_movements;
CREATE TRIGGER prevent_delete_movement
  BEFORE DELETE ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_movement_delete();

-- Bloquear UPDATE
CREATE OR REPLACE FUNCTION public.prevent_inventory_movement_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Histórico imutável: Movimentações de estoque não podem ser alteradas. Faça um lançamento de CORRECTION ou ADJUSTMENT em vez de alterar o registro original.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_update_movement ON public.inventory_movements;
CREATE TRIGGER prevent_update_movement
  BEFORE UPDATE ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_movement_update();

-- ============================================================================
-- 5. INVENTÁRIO FÍSICO
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.physical_inventories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES public.stores(id),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'APPROVED', 'CANCELLED')) DEFAULT 'OPEN',
  created_by UUID REFERENCES public.profiles(id),
  approved_by UUID REFERENCES public.profiles(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.physical_inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id UUID REFERENCES public.physical_inventories(id) ON DELETE CASCADE,
  product_variant_id UUID REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  expected_quantity INTEGER NOT NULL,
  counted_quantity INTEGER NOT NULL,
  divergence INTEGER GENERATED ALWAYS AS (counted_quantity - expected_quantity) STORED,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- ============================================================================
-- 6. ATUALIZAÇÃO DA LÓGICA DE VENDA (RESERVA DE ESTOQUE)
-- ============================================================================
-- Modificar a RPC create_mp_pix_sale para usar reserved_quantity
DROP FUNCTION IF EXISTS public.create_mp_pix_sale(uuid, text, text, jsonb, numeric, numeric);

CREATE OR REPLACE FUNCTION public.create_mp_pix_sale(
  p_customer_id UUID DEFAULT NULL,
  p_customer_name TEXT DEFAULT 'Cliente não identificado',
  p_customer_cpf TEXT DEFAULT 'Não informado',
  p_items JSONB DEFAULT '[]'::JSONB,
  p_discount_value NUMERIC DEFAULT 0,
  p_discount_percent NUMERIC DEFAULT 0
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
  v_current_reserved INT;
  v_resolved_customer_id UUID := p_customer_id;
BEGIN
  v_user_id := auth.uid();
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Carrinho vazio.';
  END IF;

  IF v_resolved_customer_id IS NULL AND p_customer_cpf IS NOT NULL AND p_customer_cpf NOT IN ('', 'Não informado') THEN
    SELECT id INTO v_resolved_customer_id FROM public.customers WHERE cpf = p_customer_cpf LIMIT 1;
    IF v_resolved_customer_id IS NULL AND p_customer_name IS NOT NULL AND p_customer_name != 'Cliente não identificado' THEN
      INSERT INTO public.customers (name, cpf) VALUES (p_customer_name, p_customer_cpf) RETURNING id INTO v_resolved_customer_id;
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS (
    variant_id UUID, quantity INT, unit_price NUMERIC, product_id UUID, product_name TEXT, variant_description TEXT
  ) LOOP
    IF v_item.quantity <= 0 THEN RAISE EXCEPTION 'Quantidade deve ser maior que zero.'; END IF;
    SELECT id, stock_quantity, reserved_quantity, product_id, size, color INTO v_variant FROM public.product_variants WHERE id = v_item.variant_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Variação não encontrada.'; END IF;
    IF v_variant.stock_quantity < v_item.quantity THEN
      RAISE EXCEPTION 'Estoque insuficiente para "%".', v_item.product_name;
    END IF;
    v_subtotal := v_subtotal + (COALESCE(v_item.unit_price, 0) * v_item.quantity);
  END LOOP;

  v_total_discount := COALESCE(p_discount_value, 0) + (v_subtotal * (COALESCE(p_discount_percent, 0) / 100.0));
  v_final_total := GREATEST(0, v_subtotal - v_total_discount);
  v_sale_number := 'PDV #' || nextval('sale_number_seq')::TEXT;

  INSERT INTO public.sales (
    sale_number, customer_id, user_id, customer_name, customer_cpf,
    subtotal, discount, total, status
  ) VALUES (
    v_sale_number, v_resolved_customer_id, v_user_id, COALESCE(p_customer_name, 'Cliente não identificado'),
    COALESCE(p_customer_cpf, 'Não informado'), v_subtotal, v_total_discount, v_final_total, 'PENDING'
  ) RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS (
    variant_id UUID, quantity INT, unit_price NUMERIC, product_id UUID, product_name TEXT, variant_description TEXT
  ) LOOP
    v_item_total := COALESCE(v_item.unit_price, 0) * v_item.quantity;
    INSERT INTO public.sale_items (
      sale_id, product_id, product_variant_id, product_name, variant_description, quantity, unit_price, total
    ) VALUES (
      v_sale_id, v_item.product_id, v_item.variant_id, v_item.product_name, COALESCE(v_item.variant_description, 'Padrão'),
      v_item.quantity, v_item.unit_price, v_item_total
    );

    SELECT stock_quantity, reserved_quantity INTO v_current_stock, v_current_reserved FROM public.product_variants WHERE id = v_item.variant_id;
    
    -- Subtrai de stock_quantity (disponível) e adiciona a reserved_quantity
    UPDATE public.product_variants 
    SET stock_quantity = stock_quantity - v_item.quantity,
        reserved_quantity = reserved_quantity + v_item.quantity
    WHERE id = v_item.variant_id;

    -- Movimentação de reserva/venda pendente
    INSERT INTO public.inventory_movements (
      product_variant_id, type, quantity, quantity_before, quantity_after,
      reference_type, reference_id, user_id, notes, reason
    ) VALUES (
      v_item.variant_id, 'SALE', v_item.quantity, v_current_stock, v_current_stock - v_item.quantity,
      'SALE', v_sale_id, v_user_id, 'Venda PIX pendente ' || v_sale_number, 'Reserva de estoque PIX'
    );
  END LOOP;

  INSERT INTO public.payments (
    sale_id, method, amount, status, installments
  ) VALUES (
    v_sale_id, 'PIX', v_final_total, 'PENDING', 1
  );

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', v_sale_id,
    'sale_number', v_sale_number,
    'total', v_final_total
  );
END;
$$;


-- Modificar a aprovação do PIX (approve_mp_pix_sale) para efetivar a baixa do estoque reservado
DROP FUNCTION IF EXISTS public.approve_mp_pix_sale(uuid, text);

CREATE OR REPLACE FUNCTION public.approve_mp_pix_sale(
  p_sale_id UUID,
  p_provider_transaction_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sale RECORD;
  v_item RECORD;
BEGIN
  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'message', 'Venda não encontrada'); END IF;

  IF v_sale.status = 'COMPLETED' THEN
    RETURN jsonb_build_object('success', true, 'message', 'Venda já aprovada (idempotente)');
  END IF;

  IF v_sale.status = 'CANCELLED' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Venda já foi cancelada');
  END IF;

  -- Baixar a reserva de estoque
  FOR v_item IN
    SELECT product_variant_id, quantity FROM public.sale_items WHERE sale_id = p_sale_id
  LOOP
    UPDATE public.product_variants 
    SET reserved_quantity = reserved_quantity - v_item.quantity
    WHERE id = v_item.product_variant_id;
  END LOOP;

  UPDATE public.sales SET status = 'COMPLETED', completed_at = NOW() WHERE id = p_sale_id;
  UPDATE public.payments SET status = 'APPROVED', provider_transaction_id = p_provider_transaction_id WHERE sale_id = p_sale_id;

  INSERT INTO public.financial_transactions (
    type, category, description, amount, status, reference_type, reference_id, paid_at
  ) VALUES (
    'INCOME', 'Vendas PDV', 'Venda ' || v_sale.sale_number || ' - ' || v_sale.customer_name,
    v_sale.total, 'PAID', 'SALE', p_sale_id, NOW()
  );

  RETURN jsonb_build_object('success', true, 'sale_id', p_sale_id, 'message', 'Venda PIX aprovada e reserva de estoque baixada');
END;
$$;


-- Modificar o cancelamento para estornar a reserva caso fosse pendente
DROP FUNCTION IF EXISTS public.cancel_mp_pix_sale(uuid);

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
  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Venda não encontrada');
  END IF;

  IF public.current_user_role() NOT IN ('ADMIN', 'MANAGER') THEN
    IF v_sale.user_id IS NULL OR v_sale.user_id != auth.uid() OR v_sale.status != 'PENDING' THEN
      RETURN jsonb_build_object('success', false, 'message', 'Apenas gestores podem cancelar vendas concluídas ou de outros usuários');
    END IF;
  END IF;

  IF v_sale.status = 'CANCELLED' THEN
    RETURN jsonb_build_object('success', true, 'message', 'Venda já cancelada (idempotente)');
  END IF;

  FOR v_item IN
    SELECT si.product_variant_id, si.quantity, pv.stock_quantity, pv.reserved_quantity
    FROM public.sale_items si
    JOIN public.product_variants pv ON pv.id = si.product_variant_id
    WHERE si.sale_id = p_sale_id
  LOOP
    -- Se a venda estava pendente, o estoque estava em "reservado". Restaura o disponível e tira da reserva.
    IF v_sale.status = 'PENDING' THEN
      UPDATE public.product_variants
        SET stock_quantity = stock_quantity + v_item.quantity,
            reserved_quantity = reserved_quantity - v_item.quantity
      WHERE id = v_item.product_variant_id;
    ELSE
      -- Se já estava completa, a reserva já foi baixada. Apenas devolvemos ao estoque disponível.
      UPDATE public.product_variants
        SET stock_quantity = stock_quantity + v_item.quantity
      WHERE id = v_item.product_variant_id;
    END IF;

    -- Registrar movimentação
    INSERT INTO public.inventory_movements (
      product_variant_id, type, quantity,
      quantity_before, quantity_after,
      reference_type, reference_id, notes, user_id, reason
    ) VALUES (
      v_item.product_variant_id, 'RETURN', v_item.quantity,
      v_item.stock_quantity, v_item.stock_quantity + v_item.quantity,
      'SALE', p_sale_id, 'Estorno: venda cancelada', auth.uid(), 'Devolução/Cancelamento de Venda'
    );
  END LOOP;

  UPDATE public.payments SET status = 'CANCELLED' WHERE sale_id = p_sale_id;

  IF v_sale.status = 'COMPLETED' THEN
    INSERT INTO public.financial_transactions (
      type, category, description, amount, status, reference_type, reference_id
    )
    SELECT 'EXPENSE', 'Estornos', 'Estorno de venda ' || v_sale.sale_number,
           v_sale.total, 'PAID', 'SALE', p_sale_id;
  END IF;

  UPDATE public.sales SET status = 'CANCELLED' WHERE id = p_sale_id;

  RETURN jsonb_build_object('success', true, 'sale_id', p_sale_id, 'message', 'Venda cancelada e estoque restaurado');
END;
$$;
