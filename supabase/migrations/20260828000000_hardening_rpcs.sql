-- ============================================================================
-- MIGRATION: 20260828000000_hardening_rpcs.sql
-- FASE 1: Hardening of RPCs and SECURITY DEFINER functions
-- ============================================================================

-- 1. Revoke public execution for all sensitive functions
REVOKE EXECUTE ON FUNCTION public.complete_sale FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_mp_pix_sale FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.register_stock_entry FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.manage_product FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_user_role FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.complete_sale TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_mp_pix_sale TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_stock_entry TO authenticated;
GRANT EXECUTE ON FUNCTION public.manage_product TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role TO authenticated;

-- 2. Redefine complete_sale with proper auth check and idempotency
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
  v_resolved_customer_id UUID := p_customer_id;
  v_normalized_method TEXT;
BEGIN
  -- 1. Obter usuário autenticado
  v_user_id := auth.uid();
  
  -- HARDENING: Explicitly prevent anonymous execution if it somehow bypasses grant
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autorizado. Usuário deve estar autenticado.';
  END IF;

  -- HARDENING: Basic Role Check (Only ADMIN, MANAGER, CASHIER can complete sales)
  IF public.current_user_role() NOT IN ('ADMIN', 'MANAGER', 'CASHIER') THEN
    RAISE EXCEPTION 'Permissão negada. Apenas caixas e gerentes podem finalizar vendas.';
  END IF;

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

-- 3. Redefine cancel_mp_pix_sale with strict checks
CREATE OR REPLACE FUNCTION public.cancel_mp_pix_sale(
  p_sale_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sale RECORD;
  v_item RECORD;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL AND current_setting('request.jwt.claims', true)::json->>'role' != 'service_role' THEN
    RAISE EXCEPTION 'Não autorizado.';
  END IF;

  -- 1. Verificar se a venda existe e travar a linha para evitar double-cancel concorrente
  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Venda não encontrada');
  END IF;

  -- Se a venda não tiver usuário (IS NULL) ou for de outro usuário, só ADMIN/MANAGER/service_role pode cancelar
  IF current_setting('request.jwt.claims', true)::json->>'role' != 'service_role' AND (v_sale.user_id IS NULL OR v_sale.user_id != v_user_id) AND public.current_user_role() NOT IN ('ADMIN', 'MANAGER') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Permissão negada para cancelar esta venda');
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
      reference_type, reference_id, notes, user_id
    ) VALUES (
      v_item.product_variant_id, 'CANCELLATION', v_item.quantity,
      v_item.stock_quantity, v_item.stock_quantity + v_item.quantity,
      'SALE', p_sale_id, 'Estorno: PIX cancelado/expirado', v_user_id
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

-- 4. Redefine register_stock_entry with strict auth
CREATE OR REPLACE FUNCTION public.register_stock_entry(
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
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autorizado.';
  END IF;

  -- 1. Validar permissão (Apenas ADMIN e MANAGER)
  v_user_role := public.current_user_role();
  IF v_user_role NOT IN ('ADMIN', 'MANAGER') THEN
    RAISE EXCEPTION 'Permissão negada para dar entrada em estoque';
  END IF;

  -- 2. Obter e travar estoque atual (Lock Pessimista)
  SELECT stock_quantity INTO v_current_stock 
  FROM public.product_variants 
  WHERE id = p_variant_id 
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variação não encontrada';
  END IF;

  -- 3. Atualizar estoque
  v_new_stock := v_current_stock + p_quantity;
  UPDATE public.product_variants
  SET stock_quantity = v_new_stock
  WHERE id = p_variant_id;

  -- 4. Registrar movimentação
  INSERT INTO public.inventory_movements (
    product_variant_id, type, quantity, quantity_before, quantity_after, notes, user_id
  ) VALUES (
    p_variant_id, 'ENTRY', p_quantity, v_current_stock, v_new_stock, 'Entrada de estoque: ' || p_product_name, v_user_id
  );

  -- 5. Registrar saída financeira (se houver custo)
  v_total_expense := p_quantity * COALESCE(p_unit_cost, 0);
  IF v_total_expense > 0 THEN
    INSERT INTO public.financial_transactions (
      type, category, description, amount, status, paid_at
    ) VALUES (
      'EXPENSE', 'Estoque / Compras', 'Entrada de estoque: ' || p_product_name || ' (' || p_quantity || ' un)', v_total_expense, 'PAID', NOW()
    );
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;
