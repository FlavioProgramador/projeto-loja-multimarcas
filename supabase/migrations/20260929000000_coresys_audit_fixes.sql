-- CoreSys Audit Security Fixes & RPC Hardening Migration
-- Date: 2026-09-29
-- Scope: Fix findings from SUPABASE_REANALISE_2026-09-28 and CoreSys Audit

BEGIN;

-- 1) Revoke legacy complete_sale signature without store_id
REVOKE ALL ON FUNCTION public.complete_sale(uuid,text,text,jsonb,text,integer,numeric,numeric,text) FROM PUBLIC, anon, authenticated;

-- 2) Harden complete_sale (modern 10-param signature) with fail-closed checks and search_path
CREATE OR REPLACE FUNCTION public.complete_sale(
  p_store_id uuid,
  p_customer_id uuid DEFAULT NULL,
  p_customer_name text DEFAULT 'Cliente não identificado',
  p_customer_cpf text DEFAULT 'Não informado',
  p_items jsonb DEFAULT '[]'::jsonb,
  p_payment_method text DEFAULT 'PIX',
  p_installments integer DEFAULT 1,
  p_discount_value numeric DEFAULT 0,
  p_discount_percent numeric DEFAULT 0,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile_active boolean := false;
  v_store_active boolean := false;
  v_role text;
  v_sale_id uuid;
  v_scoped_key text;
  v_sale_number text;
  v_subtotal numeric(12,2) := 0;
  v_discount numeric(12,2) := 0;
  v_total numeric(12,2) := 0;
  v_customer_id uuid := p_customer_id;
  v_method text;
  v_item record;
  v_inv record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;

  SELECT p.is_active INTO v_profile_active
  FROM public.profiles p
  WHERE p.id = v_user_id;

  IF COALESCE(v_profile_active, false) = false THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;

  IF p_store_id IS NULL THEN
    RAISE EXCEPTION 'Loja obrigatória.';
  END IF;

  SELECT s.is_active INTO v_store_active
  FROM public.stores s
  WHERE s.id = p_store_id;

  IF COALESCE(v_store_active, false) = false THEN
    RAISE EXCEPTION 'Loja inválida ou inativa.';
  END IF;

  v_role := public.get_user_store_role(p_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER','CASHIER') THEN
    RAISE EXCEPTION 'Permissão negada para vender nesta loja.';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' OR length(btrim(p_idempotency_key)) > 200 THEN
    RAISE EXCEPTION 'Chave de idempotência obrigatória e inválida.';
  END IF;

  IF jsonb_typeof(COALESCE(p_items, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Carrinho vazio.';
  END IF;

  IF COALESCE(p_installments, 1) < 1 OR COALESCE(p_installments, 1) > 24 THEN
    RAISE EXCEPTION 'Número de parcelas inválido.';
  END IF;

  IF COALESCE(p_discount_value, 0) < 0
     OR COALESCE(p_discount_percent, 0) < 0
     OR COALESCE(p_discount_percent, 0) > 100 THEN
    RAISE EXCEPTION 'Desconto inválido.';
  END IF;

  v_scoped_key := v_user_id::text || ':' || p_store_id::text || ':' || btrim(p_idempotency_key);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_scoped_key, 0));

  SELECT si.sale_id INTO v_sale_id
  FROM public.sale_idempotency si
  WHERE si.idempotency_key = v_scoped_key
  FOR SHARE;

  IF v_sale_id IS NOT NULL THEN
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
        AND s.user_id = v_user_id
        AND s.store_id = p_store_id
    );
  END IF;

  SELECT si.sale_id INTO v_sale_id
  FROM public.sale_idempotency si
  JOIN public.sales s ON s.id = si.sale_id
  WHERE si.idempotency_key = btrim(p_idempotency_key)
    AND s.user_id = v_user_id
    AND s.store_id = p_store_id
  FOR SHARE;

  IF v_sale_id IS NOT NULL THEN
    RETURN (
      SELECT jsonb_build_object(
        'success', true,
        'sale_id', s.id,
        'sale_number', s.sale_number,
        'total', s.total,
        'message', 'Venda já processada anteriormente (idempotência legada).'
      )
      FROM public.sales s
      WHERE s.id = v_sale_id
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sale_idempotency si
    JOIN public.sales s ON s.id = si.sale_id
    WHERE si.idempotency_key = btrim(p_idempotency_key)
      AND (s.user_id IS DISTINCT FROM v_user_id OR s.store_id IS DISTINCT FROM p_store_id)
  ) THEN
    RAISE EXCEPTION 'Chave de idempotência já utilizada em outro contexto.';
  END IF;

  IF v_customer_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = v_customer_id AND c.is_active = true) THEN
    RAISE EXCEPTION 'Cliente inválido ou inativo.';
  END IF;

  IF v_customer_id IS NULL
     AND NULLIF(trim(p_customer_cpf), '') IS NOT NULL
     AND trim(p_customer_cpf) <> 'Não informado' THEN
    SELECT c.id INTO v_customer_id
    FROM public.customers c
    WHERE c.cpf = trim(p_customer_cpf) AND c.is_active = true
    LIMIT 1;

    IF v_customer_id IS NULL
       AND NULLIF(trim(p_customer_name), '') IS NOT NULL
       AND trim(p_customer_name) <> 'Cliente não identificado' THEN
      INSERT INTO public.customers(name, cpf)
      VALUES(trim(p_customer_name), trim(p_customer_cpf))
      RETURNING id INTO v_customer_id;
    END IF;
  END IF;

  v_method := CASE
    WHEN upper(COALESCE(p_payment_method, '')) LIKE '%PIX%' THEN 'PIX'
    WHEN upper(COALESCE(p_payment_method, '')) LIKE '%DEBIT%' THEN 'DEBIT_CARD'
    WHEN upper(COALESCE(p_payment_method, '')) LIKE '%CART%' THEN 'CREDIT_CARD'
    WHEN upper(COALESCE(p_payment_method, '')) LIKE '%CASH%'
      OR upper(COALESCE(p_payment_method, '')) LIKE '%DINHEIRO%' THEN 'CASH'
    ELSE NULL
  END;

  IF v_method IS NULL THEN
    RAISE EXCEPTION 'Método de pagamento inválido.';
  END IF;

  FOR v_item IN
    SELECT x.variant_id, sum(x.quantity)::integer quantity
    FROM jsonb_to_recordset(p_items) AS x(
      variant_id uuid,
      quantity integer,
      unit_price numeric,
      product_id uuid,
      product_name text,
      variant_description text
    )
    GROUP BY x.variant_id
    ORDER BY x.variant_id
  LOOP
    IF v_item.variant_id IS NULL OR v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'Item de venda inválido.';
    END IF;

    SELECT si.id, si.quantity, pv.product_id, pv.size, pv.color, p.sale_price
      INTO v_inv
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

    IF v_inv.quantity < v_item.quantity THEN
      RAISE EXCEPTION 'Estoque insuficiente para o produto informado.';
    END IF;

    v_subtotal := v_subtotal + round(v_inv.sale_price * v_item.quantity, 2);
  END LOOP;

  v_discount := least(
    v_subtotal,
    greatest(0, COALESCE(p_discount_value, 0)) +
      (v_subtotal * least(100, greatest(0, COALESCE(p_discount_percent, 0))) / 100)
  );
  v_total := round(greatest(0, v_subtotal - v_discount), 2);

  v_sale_number := 'PDV #' || nextval('sale_number_seq')::text;

  INSERT INTO public.sales(
    store_id, sale_number, customer_id, user_id, customer_name, customer_cpf,
    subtotal, discount, total, status, completed_at
  )
  VALUES(
    p_store_id, v_sale_number, v_customer_id, v_user_id,
    COALESCE(nullif(trim(p_customer_name), ''), 'Cliente não identificado'),
    COALESCE(nullif(trim(p_customer_cpf), ''), 'Não informado'),
    round(v_subtotal, 2), round(v_discount, 2), v_total, 'COMPLETED', now()
  )
  RETURNING id INTO v_sale_id;

  INSERT INTO public.sale_idempotency(idempotency_key, sale_id)
  VALUES(v_scoped_key, v_sale_id);

  FOR v_item IN
    SELECT x.variant_id, sum(x.quantity)::integer quantity
    FROM jsonb_to_recordset(p_items) AS x(
      variant_id uuid,
      quantity integer,
      unit_price numeric,
      product_id uuid,
      product_name text,
      variant_description text
    )
    GROUP BY x.variant_id
    ORDER BY x.variant_id
  LOOP
    INSERT INTO public.sale_items(
      sale_id, product_id, product_variant_id, product_name, variant_description,
      quantity, unit_price, total
    )
    SELECT v_sale_id, pv.product_id, v_item.variant_id, p.name,
      COALESCE(pv.size, 'Único') || ' / ' || COALESCE(pv.color, 'Padrão'),
      v_item.quantity, p.sale_price, round(p.sale_price * v_item.quantity, 2)
    FROM public.product_variants pv
    JOIN public.products p ON p.id = pv.product_id
    WHERE pv.id = v_item.variant_id
      AND pv.is_active = true
      AND p.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variação de venda não encontrada durante persistência.';
    END IF;

    UPDATE public.store_inventory
    SET quantity = quantity - v_item.quantity
    WHERE store_id = p_store_id AND product_variant_id = v_item.variant_id;

    INSERT INTO public.inventory_movements(
      store_id, product_variant_id, type, quantity, quantity_before,
      quantity_after, reference_type, reference_id, user_id, notes, reason
    )
    SELECT p_store_id, v_item.variant_id, 'SALE', v_item.quantity,
      si.quantity + v_item.quantity, si.quantity, 'SALE', v_sale_id, v_user_id,
      'Venda ' || v_sale_number, 'Venda concluída'
    FROM public.store_inventory si
    WHERE si.store_id = p_store_id
      AND si.product_variant_id = v_item.variant_id;

    UPDATE public.product_variants pv
    SET stock_quantity = (
      SELECT COALESCE(sum(si.quantity), 0)
      FROM public.store_inventory si
      WHERE si.product_variant_id = pv.id
    )
    WHERE pv.id = v_item.variant_id;
  END LOOP;

  INSERT INTO public.payments(sale_id, method, amount, status, installments)
  VALUES(v_sale_id, v_method, v_total, 'APPROVED', COALESCE(p_installments, 1));

  INSERT INTO public.financial_transactions(
    store_id, type, category, description, amount, status, reference_type, reference_id, paid_at
  )
  VALUES(
    p_store_id, 'INCOME', 'Vendas PDV', 'Venda ' || v_sale_number,
    v_total, 'PAID', 'SALE', v_sale_id, now()
  );

  RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'sale_number', v_sale_number, 'total', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_sale(uuid,uuid,text,text,jsonb,text,integer,numeric,numeric,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_sale(uuid,uuid,text,text,jsonb,text,integer,numeric,numeric,text) TO authenticated;
ALTER FUNCTION public.complete_sale(uuid,uuid,text,text,jsonb,text,integer,numeric,numeric,text) SET search_path = public;

-- 3) Harden create_mp_pix_sale with explicit fail-closed role check
CREATE OR REPLACE FUNCTION public.create_mp_pix_sale(
  p_customer_id uuid DEFAULT NULL,
  p_customer_name text DEFAULT 'Cliente não identificado',
  p_customer_cpf text DEFAULT 'Não informado',
  p_items jsonb DEFAULT '[]'::jsonb,
  p_discount_value numeric DEFAULT 0,
  p_discount_percent numeric DEFAULT 0,
  p_store_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile_active boolean := false;
  v_store_active boolean := false;
  v_role text;
  v_sale_id uuid;
  v_scoped_key text;
  v_sale_number text;
  v_subtotal numeric(12,2) := 0;
  v_discount numeric(12,2) := 0;
  v_total numeric(12,2) := 0;
  v_customer_id uuid := p_customer_id;
  v_item record;
  v_inv record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;

  SELECT p.is_active INTO v_profile_active
  FROM public.profiles p
  WHERE p.id = v_user_id;

  IF COALESCE(v_profile_active, false) = false THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;

  IF p_store_id IS NULL THEN
    RAISE EXCEPTION 'Loja obrigatória.';
  END IF;

  SELECT s.is_active INTO v_store_active
  FROM public.stores s
  WHERE s.id = p_store_id;

  IF COALESCE(v_store_active, false) = false THEN
    RAISE EXCEPTION 'Loja inválida ou inativa.';
  END IF;

  v_role := public.get_user_store_role(p_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER','CASHIER') THEN
    RAISE EXCEPTION 'Permissão negada para criar venda PIX nesta loja.';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' OR length(btrim(p_idempotency_key)) > 200 THEN
    RAISE EXCEPTION 'Chave de idempotência obrigatória e inválida.';
  END IF;

  IF jsonb_typeof(COALESCE(p_items, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Carrinho vazio.';
  END IF;

  IF COALESCE(p_discount_value, 0) < 0
     OR COALESCE(p_discount_percent, 0) < 0
     OR COALESCE(p_discount_percent, 0) > 100 THEN
    RAISE EXCEPTION 'Desconto inválido.';
  END IF;

  v_scoped_key := v_user_id::text || ':' || p_store_id::text || ':' || btrim(p_idempotency_key);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_scoped_key, 0));

  SELECT si.sale_id INTO v_sale_id
  FROM public.sale_idempotency si
  WHERE si.idempotency_key = v_scoped_key
  FOR SHARE;

  IF v_sale_id IS NOT NULL THEN
    RETURN (
      SELECT jsonb_build_object(
        'success', true,
        'sale_id', s.id,
        'sale_number', s.sale_number,
        'total', s.total,
        'message', 'Venda PIX já processada anteriormente (idempotência).'
      )
      FROM public.sales s
      WHERE s.id = v_sale_id
        AND s.user_id = v_user_id
        AND s.store_id = p_store_id
    );
  END IF;

  SELECT si.sale_id INTO v_sale_id
  FROM public.sale_idempotency si
  JOIN public.sales s ON s.id = si.sale_id
  WHERE si.idempotency_key = btrim(p_idempotency_key)
    AND s.user_id = v_user_id
    AND s.store_id = p_store_id
  FOR SHARE;

  IF v_sale_id IS NOT NULL THEN
    RETURN (
      SELECT jsonb_build_object(
        'success', true,
        'sale_id', s.id,
        'sale_number', s.sale_number,
        'total', s.total,
        'message', 'Venda PIX já processada anteriormente (idempotência legada).'
      )
      FROM public.sales s
      WHERE s.id = v_sale_id
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sale_idempotency si
    JOIN public.sales s ON s.id = si.sale_id
    WHERE si.idempotency_key = btrim(p_idempotency_key)
      AND (s.user_id IS DISTINCT FROM v_user_id OR s.store_id IS DISTINCT FROM p_store_id)
  ) THEN
    RAISE EXCEPTION 'Chave de idempotência já utilizada em outro contexto.';
  END IF;

  IF v_customer_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = v_customer_id AND c.is_active = true) THEN
    RAISE EXCEPTION 'Cliente inválido ou inativo.';
  END IF;

  FOR v_item IN
    SELECT x.variant_id, sum(x.quantity)::integer quantity
    FROM jsonb_to_recordset(p_items) AS x(
      variant_id uuid, quantity integer, unit_price numeric,
      product_id uuid, product_name text, variant_description text
    )
    GROUP BY x.variant_id
    ORDER BY x.variant_id
  LOOP
    IF v_item.variant_id IS NULL OR v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'Item de venda inválido.';
    END IF;

    SELECT si.id, si.quantity, pv.product_id, pv.size, pv.color, p.sale_price INTO v_inv
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

    IF v_inv.quantity < v_item.quantity THEN
      RAISE EXCEPTION 'Estoque insuficiente para o produto informado.';
    END IF;

    v_subtotal := v_subtotal + round(v_inv.sale_price * v_item.quantity, 2);
  END LOOP;

  v_discount := least(
    v_subtotal,
    greatest(0, COALESCE(p_discount_value, 0)) +
      (v_subtotal * least(100, greatest(0, COALESCE(p_discount_percent, 0))) / 100)
  );
  v_total := round(greatest(0, v_subtotal - v_discount), 2);
  v_sale_number := 'PDV #' || nextval('sale_number_seq')::text;

  INSERT INTO public.sales(
    store_id, sale_number, customer_id, user_id, customer_name, customer_cpf,
    subtotal, discount, total, status
  )
  VALUES(
    p_store_id, v_sale_number, v_customer_id, v_user_id,
    COALESCE(nullif(trim(p_customer_name), ''), 'Cliente não identificado'),
    COALESCE(nullif(trim(p_customer_cpf), ''), 'Não informado'),
    round(v_subtotal, 2), round(v_discount, 2), v_total, 'PENDING'
  )
  RETURNING id INTO v_sale_id;

  INSERT INTO public.sale_idempotency(idempotency_key, sale_id)
  VALUES(v_scoped_key, v_sale_id);

  FOR v_item IN
    SELECT x.variant_id, sum(x.quantity)::integer quantity
    FROM jsonb_to_recordset(p_items) AS x(
      variant_id uuid, quantity integer, unit_price numeric,
      product_id uuid, product_name text, variant_description text
    )
    GROUP BY x.variant_id
    ORDER BY x.variant_id
  LOOP
    INSERT INTO public.sale_items(
      sale_id, product_id, product_variant_id, product_name, variant_description,
      quantity, unit_price, total
    )
    SELECT v_sale_id, pv.product_id, v_item.variant_id, p.name,
      COALESCE(pv.size, 'Único') || ' / ' || COALESCE(pv.color, 'Padrão'),
      v_item.quantity, p.sale_price, round(p.sale_price * v_item.quantity, 2)
    FROM public.product_variants pv
    JOIN public.products p ON p.id = pv.product_id
    WHERE pv.id = v_item.variant_id AND pv.is_active = true AND p.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variação PIX não encontrada durante persistência.';
    END IF;

    UPDATE public.store_inventory
    SET quantity = quantity - v_item.quantity
    WHERE store_id = p_store_id AND product_variant_id = v_item.variant_id;

    INSERT INTO public.inventory_movements(
      store_id, product_variant_id, type, quantity, quantity_before,
      quantity_after, reference_type, reference_id, user_id, notes, reason
    )
    SELECT p_store_id, v_item.variant_id, 'SALE', v_item.quantity,
      si.quantity + v_item.quantity, si.quantity, 'SALE', v_sale_id, v_user_id,
      'Reserva PIX ' || v_sale_number, 'Reserva de estoque PIX'
    FROM public.store_inventory si
    WHERE si.store_id = p_store_id AND si.product_variant_id = v_item.variant_id;

    UPDATE public.product_variants pv
    SET reserved_quantity = pv.reserved_quantity + v_item.quantity,
        stock_quantity = (SELECT COALESCE(sum(si.quantity), 0)
                        FROM public.store_inventory si
                        WHERE si.product_variant_id = pv.id)
    WHERE pv.id = v_item.variant_id;
  END LOOP;

  INSERT INTO public.payments(sale_id, method, amount, status, installments)
  VALUES(v_sale_id, 'PIX', v_total, 'PENDING', 1);

  RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'sale_number', v_sale_number, 'total', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric,uuid,text) TO authenticated;
ALTER FUNCTION public.create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric,uuid,text) SET search_path = public;

-- 4) Harden cancel_sale with explicit fail-closed role check
CREATE OR REPLACE FUNCTION public.cancel_sale(p_sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_profile_active boolean;
  v_role text;
  v_sale record;
  v_item record;
  v_before integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;

  SELECT is_active INTO v_profile_active FROM public.profiles WHERE id = v_user;
  IF COALESCE(v_profile_active, false) = false THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Venda não encontrada.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = v_sale.store_id AND is_active = true) THEN
    RAISE EXCEPTION 'Loja da venda inválida ou inativa.';
  END IF;

  v_role := public.get_user_store_role(v_sale.store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER','CASHIER') THEN
    RAISE EXCEPTION 'Permissão negada.';
  END IF;

  IF v_sale.status = 'CANCELLED' THEN
    RETURN jsonb_build_object('success', true, 'message', 'Venda já cancelada (idempotente).');
  END IF;

  IF v_sale.status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'Somente vendas concluídas podem ser canceladas.';
  END IF;

  FOR v_item IN
    SELECT product_variant_id, quantity FROM public.sale_items
    WHERE sale_id = p_sale_id ORDER BY product_variant_id
  LOOP
    SELECT quantity INTO v_before
    FROM public.store_inventory
    WHERE store_id = v_sale.store_id AND product_variant_id = v_item.product_variant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.store_inventory(store_id, product_variant_id, quantity, minimum_stock)
      VALUES(v_sale.store_id, v_item.product_variant_id, 0, 0);
      v_before := 0;
    END IF;

    UPDATE public.store_inventory
    SET quantity = quantity + v_item.quantity
    WHERE store_id = v_sale.store_id AND product_variant_id = v_item.product_variant_id;

    INSERT INTO public.inventory_movements(
      store_id, product_variant_id, type, quantity, quantity_before, quantity_after,
      reference_type, reference_id, user_id, notes, reason
    )
    VALUES(
      v_sale.store_id, v_item.product_variant_id, 'CANCELLATION',
      v_item.quantity, v_before, v_before + v_item.quantity,
      'SALE', p_sale_id, v_user, 'Cancelamento da venda', 'Cancelamento'
    );

    UPDATE public.product_variants
    SET stock_quantity = (SELECT COALESCE(sum(si.quantity), 0) FROM public.store_inventory si WHERE si.product_variant_id = id)
    WHERE id = v_item.product_variant_id;
  END LOOP;

  UPDATE public.sales SET status = 'CANCELLED', completed_at = NULL WHERE id = p_sale_id;
  UPDATE public.payments SET status = 'CANCELLED' WHERE sale_id = p_sale_id AND status <> 'CANCELLED';

  IF NOT EXISTS (
    SELECT 1 FROM public.financial_transactions
    WHERE reference_type = 'SALE' AND reference_id = p_sale_id AND type = 'EXPENSE'
  ) THEN
    INSERT INTO public.financial_transactions(
      store_id, type, category, description, amount, status, reference_type, reference_id, paid_at
    )
    VALUES(v_sale.store_id, 'EXPENSE', 'Estornos', 'Estorno de venda ' || v_sale.sale_number,
           v_sale.total, 'PAID', 'SALE', p_sale_id, now());
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Venda cancelada e estoque restaurado.');
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_sale(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_sale(uuid) TO authenticated;
ALTER FUNCTION public.cancel_sale(uuid) SET search_path = public;

-- 5) Harden manage_product with explicit fail-closed role check
CREATE OR REPLACE FUNCTION public.manage_product(
  p_product_id uuid,
  p_name text,
  p_brand_name text,
  p_category_name text,
  p_sale_price numeric,
  p_cost_price numeric,
  p_variants jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_profile_active boolean;
  v_role text;
  v_brand_id uuid;
  v_category_id uuid;
  v_product_id uuid;
  v_variant record;
  v_variant_ids uuid[] := '{}';
  v_generated_sku text;
  v_idx int := 1;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;

  SELECT is_active INTO v_profile_active FROM public.profiles WHERE id = v_user;
  IF COALESCE(v_profile_active, false) = false THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;

  v_role := public.current_user_role();
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER') THEN
    RAISE EXCEPTION 'Permissão negada.';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Nome do produto é obrigatório.';
  END IF;
  IF p_sale_price IS NOT NULL AND p_sale_price < 0 THEN
    RAISE EXCEPTION 'Preço de venda inválido.';
  END IF;
  IF p_cost_price IS NOT NULL AND p_cost_price < 0 THEN
    RAISE EXCEPTION 'Preço de custo inválido.';
  END IF;

  IF p_brand_name IS NOT NULL AND btrim(p_brand_name) <> '' THEN
    SELECT id INTO v_brand_id FROM public.brands WHERE name ILIKE btrim(p_brand_name) AND is_active = true LIMIT 1;
    IF v_brand_id IS NULL THEN
      INSERT INTO public.brands(name) VALUES(btrim(p_brand_name)) RETURNING id INTO v_brand_id;
    END IF;
  END IF;

  IF p_category_name IS NOT NULL AND btrim(p_category_name) <> '' THEN
    SELECT id INTO v_category_id FROM public.categories WHERE name ILIKE btrim(p_category_name) AND is_active = true LIMIT 1;
    IF v_category_id IS NULL THEN
      INSERT INTO public.categories(name) VALUES(btrim(p_category_name)) RETURNING id INTO v_category_id;
    END IF;
  END IF;

  IF p_product_id IS NOT NULL THEN
    UPDATE public.products
    SET name = btrim(p_name), brand_id = v_brand_id, category_id = v_category_id,
        sale_price = COALESCE(p_sale_price, sale_price), cost_price = COALESCE(p_cost_price, cost_price)
    WHERE id = p_product_id
    RETURNING id INTO v_product_id;

    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'Produto não encontrado.';
    END IF;
  ELSE
    INSERT INTO public.products(name, brand_id, category_id, sale_price, cost_price)
    VALUES(btrim(p_name), v_brand_id, v_category_id, COALESCE(p_sale_price, 0), COALESCE(p_cost_price, 0))
    RETURNING id INTO v_product_id;
  END IF;

  FOR v_variant IN
    SELECT * FROM jsonb_to_recordset(COALESCE(p_variants, '[]'::jsonb))
      AS (id uuid, sku text, barcode text, size text, color text, minimum_stock int)
  LOOP
    v_generated_sku := nullif(trim(v_variant.sku), '');
    IF v_generated_sku IS NULL THEN
      v_generated_sku :=
        upper(substring(regexp_replace(extensions.unaccent(COALESCE(p_name, '')), '[^a-zA-Z0-9]', '', 'g') from 1 for 4))
        || '-' || upper(substring(regexp_replace(extensions.unaccent(COALESCE(v_variant.size, 'Único')), '[^a-zA-Z0-9]', '', 'g') from 1 for 3))
        || '-' || upper(substring(regexp_replace(extensions.unaccent(COALESCE(v_variant.color, 'Padrão')), '[^a-zA-Z0-9]', '', 'g') from 1 for 3));

      WHILE EXISTS (
        SELECT 1 FROM public.product_variants
        WHERE sku = v_generated_sku AND (v_variant.id IS NULL OR id <> v_variant.id)
      ) LOOP
        v_generated_sku := v_generated_sku || v_idx::text;
        v_idx := v_idx + 1;
      END LOOP;
    END IF;

    IF v_variant.barcode IS NOT NULL AND trim(v_variant.barcode) <> '' AND EXISTS (
      SELECT 1 FROM public.product_variants
      WHERE barcode = trim(v_variant.barcode) AND (v_variant.id IS NULL OR id <> v_variant.id)
    ) THEN
      RAISE EXCEPTION 'Código de barras % já está em uso.', v_variant.barcode;
    END IF;

    IF v_variant.id IS NOT NULL THEN
      UPDATE public.product_variants
      SET sku = trim(v_generated_sku),
          barcode = nullif(trim(v_variant.barcode), ''),
          size = COALESCE(v_variant.size, 'Único'),
          color = COALESCE(v_variant.color, 'Padrão'),
          minimum_stock = COALESCE(v_variant.minimum_stock, 0)
      WHERE id = v_variant.id AND product_id = v_product_id;

      v_variant_ids := array_append(v_variant_ids, v_variant.id);
    ELSE
      INSERT INTO public.product_variants(product_id, sku, barcode, size, color, minimum_stock, stock_quantity)
      VALUES(v_product_id, trim(v_generated_sku), nullif(trim(v_variant.barcode), ''),
             COALESCE(v_variant.size, 'Único'), COALESCE(v_variant.color, 'Padrão'),
             COALESCE(v_variant.minimum_stock, 0), 0)
      RETURNING id INTO v_variant.id;

      v_variant_ids := array_append(v_variant_ids, v_variant.id);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'product_id', v_product_id, 'variant_ids', v_variant_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.manage_product(uuid,text,text,text,numeric,numeric,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_product(uuid,text,text,text,numeric,numeric,jsonb) TO authenticated;
ALTER FUNCTION public.manage_product(uuid,text,text,text,numeric,numeric,jsonb) SET search_path = public, extensions;

-- 6) Harden register_stock_entry with explicit fail-closed role check
CREATE OR REPLACE FUNCTION public.register_stock_entry(
  p_variant_id uuid,
  p_quantity integer,
  p_unit_cost numeric,
  p_product_name text,
  p_store_id uuid,
  p_reason text DEFAULT 'Compra de fornecedor',
  p_type text DEFAULT 'PURCHASE'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_profile_active boolean;
  v_role text;
  v_before integer;
  v_after integer;
  v_total numeric(12,2);
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;

  SELECT is_active INTO v_profile_active FROM public.profiles WHERE id = v_user;
  IF COALESCE(v_profile_active, false) = false THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;

  IF p_store_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store_id AND is_active = true) THEN
    RAISE EXCEPTION 'Loja inválida ou inativa.';
  END IF;

  v_role := public.get_user_store_role(p_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER') THEN
    RAISE EXCEPTION 'Permissão negada para estoque.';
  END IF;

  IF p_variant_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.product_variants pv
    JOIN public.products p ON p.id = pv.product_id
    WHERE pv.id = p_variant_id AND pv.is_active = true AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'Variação não encontrada ou inativa.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantidade inválida.';
  END IF;
  IF p_unit_cost IS NULL OR p_unit_cost < 0 THEN
    RAISE EXCEPTION 'Custo inválido.';
  END IF;

  SELECT quantity INTO v_before
  FROM public.store_inventory
  WHERE store_id = p_store_id AND product_variant_id = p_variant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.store_inventory(store_id, product_variant_id, quantity, minimum_stock)
    VALUES(p_store_id, p_variant_id, 0, 0);
    v_before := 0;
  END IF;

  v_after := v_before + p_quantity;

  UPDATE public.store_inventory
  SET quantity = v_after
  WHERE store_id = p_store_id AND product_variant_id = p_variant_id;

  UPDATE public.product_variants pv
  SET stock_quantity = (SELECT COALESCE(sum(si.quantity), 0) FROM public.store_inventory si WHERE si.product_variant_id = pv.id)
  WHERE pv.id = p_variant_id;

  INSERT INTO public.inventory_movements(
    store_id, product_variant_id, type, quantity, quantity_before, quantity_after,
    reference_type, user_id, notes, reason
  )
  VALUES(
    p_store_id, p_variant_id, 'ENTRY', p_quantity, v_before, v_after,
    'STOCK_ENTRY', v_user, 'Entrada de estoque: ' || COALESCE(p_product_name, 'Produto'),
    COALESCE(p_reason, 'Compra de fornecedor')
  );

  v_total := round(p_quantity * p_unit_cost, 2);
  IF v_total > 0 AND upper(COALESCE(p_type, 'PURCHASE')) IN ('PURCHASE','ENTRY') THEN
    INSERT INTO public.financial_transactions(
      store_id, type, category, description, amount, status, reference_type, paid_at
    )
    VALUES(
      p_store_id, 'EXPENSE', 'Estoque / Compras',
      'Entrada de estoque: ' || COALESCE(p_product_name, 'Produto'),
      v_total, 'PAID', 'STOCK_ENTRY', now()
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'quantity_before', v_before, 'quantity_after', v_after);
END;
$$;

REVOKE ALL ON FUNCTION public.register_stock_entry(uuid,integer,numeric,text,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_stock_entry(uuid,integer,numeric,text,uuid,text,text) TO authenticated;
ALTER FUNCTION public.register_stock_entry(uuid,integer,numeric,text,uuid,text,text) SET search_path = public;

-- 7) Harden report functions with mandatory store_id filtering and search_path
CREATE OR REPLACE FUNCTION public.report_stock_status(p_store_id uuid DEFAULT NULL)
RETURNS TABLE(product_id uuid, product_name text, variant_id uuid, variant_sku text, stock_quantity integer, reserved_quantity integer, minimum_stock integer, status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;
  IF public.current_user_role() IS NULL THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;
  IF p_store_id IS NULL OR NOT public.has_store_access(p_store_id) THEN
    RAISE EXCEPTION 'Acesso negado à loja.';
  END IF;

  RETURN QUERY
  SELECT p.id, p.name, pv.id, pv.sku, si.quantity, pv.reserved_quantity, pv.minimum_stock,
         CASE WHEN si.quantity = 0 THEN 'OUT_OF_STOCK'
              WHEN si.quantity <= pv.minimum_stock THEN 'LOW_STOCK'
              ELSE 'OK' END
  FROM public.products p
  JOIN public.product_variants pv ON pv.product_id = p.id
  JOIN public.store_inventory si
    ON si.product_variant_id = pv.id AND si.store_id = p_store_id
  WHERE p.is_active = true AND pv.is_active = true
  ORDER BY CASE WHEN si.quantity = 0 THEN 1
                WHEN si.quantity <= pv.minimum_stock THEN 2
                ELSE 3 END,
           si.quantity;
END;
$$;

CREATE OR REPLACE FUNCTION public.report_top_selling_products(p_limit integer DEFAULT 10, p_store_id uuid DEFAULT NULL)
RETURNS TABLE(product_id uuid, product_name text, total_quantity_sold bigint, total_revenue numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;
  IF public.current_user_role() IS NULL THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;
  IF p_store_id IS NULL OR NOT public.has_store_access(p_store_id) THEN
    RAISE EXCEPTION 'Acesso negado à loja.';
  END IF;
  IF COALESCE(p_limit, 0) < 1 OR COALESCE(p_limit, 0) > 100 THEN
    RAISE EXCEPTION 'Limite inválido.';
  END IF;

  RETURN QUERY
  SELECT p.id, p.name, sum(si.quantity)::bigint, sum(si.total)::numeric
  FROM public.sale_items si
  JOIN public.sales s ON s.id = si.sale_id
  JOIN public.products p ON p.id = si.product_id
  WHERE s.store_id = p_store_id AND s.status = 'COMPLETED'
  GROUP BY p.id, p.name
  ORDER BY total_quantity_sold DESC
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.report_inventory_movements_summary(
  p_start_date timestamptz DEFAULT now()-interval '30 days',
  p_end_date timestamptz DEFAULT now(),
  p_store_id uuid DEFAULT NULL
)
RETURNS TABLE(movement_type text, total_quantity bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;
  IF public.current_user_role() IS NULL THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;
  IF p_store_id IS NULL OR NOT public.has_store_access(p_store_id) THEN
    RAISE EXCEPTION 'Acesso negado à loja.';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Período inválido.';
  END IF;

  RETURN QUERY
  SELECT im.type, sum(im.quantity)::bigint
  FROM public.inventory_movements im
  WHERE im.store_id = p_store_id
    AND im.created_at >= p_start_date
    AND im.created_at <= p_end_date
  GROUP BY im.type
  ORDER BY total_quantity DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_profitability_by_product(
  p_store_id uuid,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS TABLE(product_id uuid, product_name text, category_id uuid, total_quantity bigint, total_revenue numeric, total_cost numeric, margin_value numeric, margin_percentage numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;
  IF public.current_user_role() IS NULL THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;
  IF p_store_id IS NULL OR NOT public.has_store_access(p_store_id) THEN
    RAISE EXCEPTION 'Acesso negado à loja.';
  END IF;

  RETURN QUERY
  SELECT p.id, p.name, p.category_id, sum(si.quantity)::bigint, sum(si.total), sum(si.quantity * p.cost_price),
         sum(si.total) - sum(si.quantity * p.cost_price),
         CASE WHEN sum(si.total) > 0
              THEN ((sum(si.total) - sum(si.quantity * p.cost_price)) / sum(si.total)) * 100
              ELSE 0 END
  FROM public.sale_items si
  JOIN public.sales s ON s.id = si.sale_id
  JOIN public.products p ON p.id = si.product_id
  WHERE s.store_id = p_store_id
    AND s.status = 'COMPLETED'
    AND (p_start_date IS NULL OR s.completed_at::date >= p_start_date)
    AND (p_end_date IS NULL OR s.completed_at::date <= p_end_date)
  GROUP BY p.id, p.name, p.category_id
  ORDER BY margin_value DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_profitability_by_category(
  p_store_id uuid,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS TABLE(category_id uuid, category_name text, total_quantity bigint, total_revenue numeric, total_cost numeric, margin_value numeric, margin_percentage numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;
  IF public.current_user_role() IS NULL THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;
  IF p_store_id IS NULL OR NOT public.has_store_access(p_store_id) THEN
    RAISE EXCEPTION 'Acesso negado à loja.';
  END IF;

  RETURN QUERY
  SELECT c.id, COALESCE(c.name, 'Sem Categoria'), sum(si.quantity)::bigint, sum(si.total), sum(si.quantity * p.cost_price),
         sum(si.total) - sum(si.quantity * p.cost_price),
         CASE WHEN sum(si.total) > 0
              THEN ((sum(si.total) - sum(si.quantity * p.cost_price)) / sum(si.total)) * 100
              ELSE 0 END
  FROM public.sale_items si
  JOIN public.sales s ON s.id = si.sale_id
  JOIN public.products p ON p.id = si.product_id
  LEFT JOIN public.categories c ON c.id = p.category_id
  WHERE s.store_id = p_store_id
    AND s.status = 'COMPLETED'
    AND (p_start_date IS NULL OR s.completed_at::date >= p_start_date)
    AND (p_end_date IS NULL OR s.completed_at::date <= p_end_date)
  GROUP BY c.id, c.name
  ORDER BY margin_value DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.report_stock_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_stock_status(uuid) TO authenticated;
ALTER FUNCTION public.report_stock_status(uuid) SET search_path = public;

REVOKE ALL ON FUNCTION public.report_top_selling_products(integer,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_top_selling_products(integer,uuid) TO authenticated;
ALTER FUNCTION public.report_top_selling_products(integer,uuid) SET search_path = public;

REVOKE ALL ON FUNCTION public.report_inventory_movements_summary(timestamptz,timestamptz,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_inventory_movements_summary(timestamptz,timestamptz,uuid) TO authenticated;
ALTER FUNCTION public.report_inventory_movements_summary(timestamptz,timestamptz,uuid) SET search_path = public;

REVOKE ALL ON FUNCTION public.get_profitability_by_product(uuid,date,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_profitability_by_product(uuid,date,date) TO authenticated;
ALTER FUNCTION public.get_profitability_by_product(uuid,date,date) SET search_path = public;

REVOKE ALL ON FUNCTION public.get_profitability_by_category(uuid,date,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_profitability_by_category(uuid,date,date) TO authenticated;
ALTER FUNCTION public.get_profitability_by_category(uuid,date,date) SET search_path = public;

COMMIT;
