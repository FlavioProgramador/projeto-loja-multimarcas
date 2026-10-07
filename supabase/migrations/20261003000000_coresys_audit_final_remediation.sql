-- CoreSys Audit Final Remediation Migration
-- Date: 2026-10-03
-- Scope: Remediate remaining findings from CoreSys Security & Backend Audits
-- Priority: Critical & High security hardening, fail-closed role checks, RLS & search_path enforcement

BEGIN;

-- 1) Revoke legacy complete_sale signature without store_id
DO $$
BEGIN
  IF to_regprocedure('public.complete_sale(uuid,text,text,jsonb,text,integer,numeric,numeric,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.complete_sale(uuid,text,text,jsonb,text,integer,numeric,numeric,text) FROM PUBLIC, anon, authenticated';
  END IF;
END $$;

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
  v_sale_number text;
  v_subtotal numeric(12,2) := 0;
  v_discount numeric(12,2) := 0;
  v_total numeric(12,2) := 0;
  v_customer_id uuid := p_customer_id;
  v_method text;
  v_item record;
  v_inv record;
BEGIN
  SELECT p.is_active INTO v_profile_active
  FROM public.profiles p
  WHERE p.id = v_user_id;

  IF v_user_id IS NULL OR COALESCE(v_profile_active, false) = false THEN
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

  IF NULLIF(btrim(p_idempotency_key), '') IS NULL OR length(btrim(p_idempotency_key)) > 200 THEN
    RAISE EXCEPTION 'Chave de idempotência obrigatória.';
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

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_store_id::text || ':' || btrim(p_idempotency_key), 0));

  SELECT sale_id INTO v_sale_id
  FROM public.sale_idempotency
  WHERE idempotency_key=btrim(p_idempotency_key) AND store_id=p_store_id AND user_id=v_user_id
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

  IF v_customer_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = v_customer_id AND c.is_active = true) THEN
    RAISE EXCEPTION 'Cliente inválido ou inativo.';
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

  INSERT INTO public.sale_idempotency(idempotency_key, sale_id, store_id, user_id)
  VALUES(btrim(p_idempotency_key), v_sale_id, p_store_id, v_user_id);

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

REVOKE ALL ON FUNCTION public.complete_sale(uuid,uuid,text,text,jsonb,text,integer,numeric,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_sale(uuid,uuid,text,text,jsonb,text,integer,numeric,numeric,text) TO authenticated;
ALTER FUNCTION public.complete_sale(uuid,uuid,text,text,jsonb,text,integer,numeric,numeric,text) SET search_path = public;

-- 3) Harden create_mp_pix_sale
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
  v_sale_number text;
  v_subtotal numeric(12,2) := 0;
  v_discount numeric(12,2) := 0;
  v_total numeric(12,2) := 0;
  v_customer_id uuid := p_customer_id;
  v_item record;
  v_inv record;
BEGIN
  SELECT p.is_active INTO v_profile_active
  FROM public.profiles p
  WHERE p.id = v_user_id;

  IF v_user_id IS NULL OR COALESCE(v_profile_active, false) = false THEN
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

  IF NULLIF(btrim(p_idempotency_key), '') IS NULL OR length(btrim(p_idempotency_key)) > 200 THEN
    RAISE EXCEPTION 'Chave de idempotência obrigatória.';
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

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_store_id::text || ':' || btrim(p_idempotency_key), 0));

  SELECT sale_id INTO v_sale_id
  FROM public.sale_idempotency
  WHERE idempotency_key=btrim(p_idempotency_key) AND store_id=p_store_id AND user_id=v_user_id
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

  INSERT INTO public.sale_idempotency(idempotency_key, sale_id, store_id, user_id)
  VALUES(btrim(p_idempotency_key), v_sale_id, p_store_id, v_user_id);

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
    SET reserved_quantity = COALESCE(reserved_quantity, 0) + v_item.quantity,
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

REVOKE ALL ON FUNCTION public.create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric,uuid,text) TO authenticated;
ALTER FUNCTION public.create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric,uuid,text) SET search_path = public;

-- 4) Harden cancel_sale
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
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
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

REVOKE ALL ON FUNCTION public.cancel_sale(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_sale(uuid) TO authenticated;
ALTER FUNCTION public.cancel_sale(uuid) SET search_path = public;

COMMIT;
