-- VESTRA ERP - Integridade de vendas
-- Reforca validacao de descontos, idempotencia e estado da venda.

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
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Não autorizado.'; END IF;
  IF NOT public.has_store_access(p_store_id) THEN RAISE EXCEPTION 'Acesso negado à loja especificada.'; END IF;
  IF jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Carrinho vazio.'; END IF;
  IF COALESCE(p_discount_value, 0) < 0 OR COALESCE(p_discount_percent, 0) < 0 OR COALESCE(p_discount_percent, 0) > 100 THEN
    RAISE EXCEPTION 'Desconto inválido.';
  END IF;
  IF COALESCE(p_installments, 1) < 1 OR COALESCE(p_installments, 1) > 24 THEN
    RAISE EXCEPTION 'Número de parcelas inválido.';
  END IF;

  v_normalized_method := CASE
    WHEN UPPER(p_payment_method) LIKE '%PIX%' THEN 'PIX'
    WHEN UPPER(p_payment_method) LIKE '%DEBIT%' THEN 'DEBIT_CARD'
    WHEN UPPER(p_payment_method) LIKE '%CART%' THEN 'CREDIT_CARD'
    WHEN UPPER(p_payment_method) LIKE '%CASH%' OR UPPER(p_payment_method) LIKE '%DINHEIRO%' THEN 'CASH'
    ELSE 'CASH'
  END;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT sale_id INTO v_sale_id FROM public.sale_idempotency WHERE idempotency_key = p_idempotency_key FOR SHARE;
    IF FOUND THEN
      SELECT total, sale_number INTO v_final_total, v_sale_number FROM public.sales WHERE id = v_sale_id;
      RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'sale_number', v_sale_number, 'total', v_final_total, 'message', 'Venda já processada anteriormente (idempotência).');
    END IF;
  END IF;

  IF v_resolved_customer_id IS NULL AND p_customer_cpf IS NOT NULL AND p_customer_cpf NOT IN ('', 'Não informado') THEN
    SELECT id INTO v_resolved_customer_id FROM public.customers WHERE cpf = p_customer_cpf LIMIT 1;
    IF v_resolved_customer_id IS NULL AND p_customer_name IS NOT NULL AND p_customer_name <> 'Cliente não identificado' THEN
      INSERT INTO public.customers (name, cpf) VALUES (trim(p_customer_name), trim(p_customer_cpf)) RETURNING id INTO v_resolved_customer_id;
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS (variant_id UUID, quantity INT, unit_price NUMERIC, product_name TEXT, variant_description TEXT) LOOP
    IF v_item.quantity IS NULL OR v_item.quantity <= 0 THEN RAISE EXCEPTION 'Quantidade inválida.'; END IF;
    SELECT si.id, si.quantity INTO v_inventory
    FROM public.store_inventory si
    JOIN public.product_variants pv ON pv.id = si.product_variant_id
    JOIN public.products p ON p.id = pv.product_id
    WHERE si.store_id = p_store_id AND si.product_variant_id = v_item.variant_id
      AND pv.is_active = true AND p.is_active = true
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Produto não está disponível nesta loja.'; END IF;
    IF v_inventory.quantity < v_item.quantity THEN RAISE EXCEPTION 'Estoque insuficiente para o produto informado.'; END IF;
    SELECT p.sale_price INTO v_real_price
    FROM public.product_variants pv JOIN public.products p ON p.id = pv.product_id
    WHERE pv.id = v_item.variant_id AND pv.is_active = true AND p.is_active = true;
    IF v_real_price IS NULL OR v_real_price < 0 THEN RAISE EXCEPTION 'Preço do produto inválido.'; END IF;
    v_subtotal := v_subtotal + (v_real_price * v_item.quantity);
  END LOOP;

  v_total_discount := LEAST(v_subtotal, COALESCE(p_discount_value, 0) + (v_subtotal * (COALESCE(p_discount_percent, 0) / 100.0)));
  v_final_total := ROUND(GREATEST(0, v_subtotal - v_total_discount), 2);
  v_sale_number := 'PDV #' || nextval('sale_number_seq')::TEXT;

  INSERT INTO public.sales (store_id, sale_number, customer_id, user_id, customer_name, customer_cpf, subtotal, discount, total, status, completed_at)
  VALUES (p_store_id, v_sale_number, v_resolved_customer_id, v_user_id,
          COALESCE(NULLIF(trim(p_customer_name), ''), 'Cliente não identificado'),
          COALESCE(NULLIF(trim(p_customer_cpf), ''), 'Não informado'),
          ROUND(v_subtotal, 2), ROUND(v_total_discount, 2), v_final_total, 'COMPLETED', NOW())
  RETURNING id INTO v_sale_id;

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.sale_idempotency (idempotency_key, sale_id) VALUES (p_idempotency_key, v_sale_id);
  END IF;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS (variant_id UUID, quantity INT, unit_price NUMERIC, product_name TEXT, variant_description TEXT) LOOP
    SELECT p.sale_price INTO v_real_price
    FROM public.product_variants pv JOIN public.products p ON p.id = pv.product_id
    WHERE pv.id = v_item.variant_id;
    v_item_total := ROUND(v_real_price * v_item.quantity, 2);
    INSERT INTO public.sale_items (sale_id, product_variant_id, product_name, variant_description, quantity, unit_price, total)
    VALUES (v_sale_id, v_item.variant_id, COALESCE(v_item.product_name, 'Produto'), COALESCE(v_item.variant_description, 'Padrão'), v_item.quantity, v_real_price, v_item_total);
    UPDATE public.store_inventory
    SET quantity = quantity - v_item.quantity
    WHERE store_id = p_store_id AND product_variant_id = v_item.variant_id;
    INSERT INTO public.inventory_movements (store_id, product_variant_id, type, quantity, quantity_before, quantity_after, reference_type, reference_id, user_id, notes)
    SELECT p_store_id, v_item.variant_id, 'SALE', v_item.quantity, si.quantity + v_item.quantity, si.quantity, 'SALE', v_sale_id, v_user_id, 'Venda ' || v_sale_number
    FROM public.store_inventory si
    WHERE si.store_id = p_store_id AND si.product_variant_id = v_item.variant_id;
  END LOOP;

  INSERT INTO public.payments (sale_id, method, amount, status, installments)
  VALUES (v_sale_id, v_normalized_method, v_final_total, 'APPROVED', GREATEST(1, COALESCE(p_installments, 1)));
  INSERT INTO public.financial_transactions (store_id, type, category, description, amount, status, reference_type, reference_id, paid_at)
  VALUES (p_store_id, 'INCOME', 'Vendas PDV', 'Venda ' || v_sale_number, v_final_total, 'PAID', 'SALE', v_sale_id, NOW());
  RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'sale_number', v_sale_number, 'total', v_final_total);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_sale(UUID, UUID, TEXT, TEXT, JSONB, TEXT, INT, NUMERIC, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_sale(UUID, UUID, TEXT, TEXT, JSONB, TEXT, INT, NUMERIC, NUMERIC, TEXT) TO authenticated;
ALTER FUNCTION public.complete_sale(UUID, UUID, TEXT, TEXT, JSONB, TEXT, INT, NUMERIC, NUMERIC, TEXT) SET search_path = public, pg_temp;
CREATE INDEX IF NOT EXISTS idx_sale_idempotency_created_at ON public.sale_idempotency (created_at);
CREATE INDEX IF NOT EXISTS idx_store_inventory_store_variant ON public.store_inventory (store_id, product_variant_id);