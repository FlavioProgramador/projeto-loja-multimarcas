-- CoreSys Audit Remediation Migration
-- Date: 2026-10-03
-- Priority 1 & 2 Remediation: RPC Security, Multi-tenant Store Isolation, Search Path Enforcement, RLS Policies

BEGIN;

-- 1) Revoke legacy un-scoped function signatures
DO $$
BEGIN
  IF to_regprocedure('public.complete_sale(uuid,text,text,jsonb,text,integer,numeric,numeric,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.complete_sale(uuid,text,text,jsonb,text,integer,numeric,numeric,text) FROM PUBLIC, anon, authenticated';
  END IF;
  IF to_regprocedure('public.create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric) FROM PUBLIC, anon, authenticated';
  END IF;
END $$;

-- 2) Harden complete_sale (10-parameter signature)
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

  IF v_customer_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.customers c
       WHERE c.id = v_customer_id
         AND c.store_id = p_store_id
         AND c.is_active = true
     ) THEN
    RAISE EXCEPTION 'Cliente inválido, inativo ou não pertence à loja informada.';
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
  VALUES(v_scoped_key, v_sale_id, p_store_id, v_user_id);

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

  IF v_customer_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.customers c
       WHERE c.id = v_customer_id
         AND c.store_id = p_store_id
         AND c.is_active = true
     ) THEN
    RAISE EXCEPTION 'Cliente inválido, inativo ou não pertence à loja informada.';
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
  VALUES(v_scoped_key, v_sale_id, p_store_id, v_user_id);

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

    UPDATE public.product_variants pv
    SET stock_quantity = (
      SELECT COALESCE(sum(si.quantity), 0)
      FROM public.store_inventory si
      WHERE si.product_variant_id = pv.id
    )
    WHERE pv.id = v_item.product_variant_id;
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

-- 5) Harden manage_product
CREATE OR REPLACE FUNCTION public.manage_product(
  p_product_id uuid DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_cost_price numeric DEFAULT 0,
  p_sale_price numeric DEFAULT 0,
  p_variants jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile_active boolean := false;
  v_product_id uuid := p_product_id;
  v_has_admin boolean := false;
  v_var record;
  v_variant_id uuid;
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

  SELECT EXISTS (
    SELECT 1 FROM public.user_store_access usa
    WHERE usa.user_id = v_user_id AND usa.role = 'ADMIN' AND usa.is_active = true
  ) INTO v_has_admin;

  IF NOT v_has_admin THEN
    RAISE EXCEPTION 'Permissão negada. Apenas administradores podem gerenciar produtos.';
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Nome do produto é obrigatório.';
  END IF;

  IF p_sale_price < 0 OR p_cost_price < 0 THEN
    RAISE EXCEPTION 'Preço de custo e venda devem ser maiores ou iguais a zero.';
  END IF;

  IF v_product_id IS NULL THEN
    INSERT INTO public.products (name, description, category_id, cost_price, sale_price, is_active)
    VALUES (trim(p_name), trim(p_description), p_category_id, p_cost_price, p_sale_price, true)
    RETURNING id INTO v_product_id;
  ELSE
    UPDATE public.products
    SET name = trim(p_name),
        description = trim(p_description),
        category_id = p_category_id,
        cost_price = p_cost_price,
        sale_price = p_sale_price,
        updated_at = now()
    WHERE id = v_product_id AND is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto não encontrado para atualização.';
    END IF;
  END IF;

  IF jsonb_typeof(COALESCE(p_variants, '[]'::jsonb)) = 'array' THEN
    FOR v_var IN
      SELECT x.id, x.sku, x.color, x.size, x.barcode
      FROM jsonb_to_recordset(p_variants) AS x(
        id uuid, sku text, color text, size text, barcode text
      )
    LOOP
      IF v_var.id IS NOT NULL THEN
        UPDATE public.product_variants
        SET sku = trim(v_var.sku),
            color = trim(v_var.color),
            size = trim(v_var.size),
            barcode = trim(v_var.barcode),
            updated_at = now()
        WHERE id = v_var.id AND product_id = v_product_id;
      ELSE
        INSERT INTO public.product_variants (product_id, sku, color, size, barcode, is_active)
        VALUES (v_product_id, trim(v_var.sku), trim(v_var.color), trim(v_var.size), trim(v_var.barcode), true);
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('success', true, 'product_id', v_product_id);
END;
$$;

REVOKE ALL ON FUNCTION public.manage_product(uuid,text,text,uuid,numeric,numeric,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_product(uuid,text,text,uuid,numeric,numeric,jsonb) TO authenticated;
ALTER FUNCTION public.manage_product(uuid,text,text,uuid,numeric,numeric,jsonb) SET search_path = public, extensions;

-- 6) Harden approve_physical_inventory
CREATE OR REPLACE FUNCTION public.approve_physical_inventory(p_inventory_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_profile_active boolean := false;
  v_store_id uuid;
  v_store_active boolean := false;
  v_role text;
  v_status text;
  v_item_count integer := 0;
  v_incomplete_count integer := 0;
  v_item record;
  v_before integer;
  v_divergence integer;
  v_after integer;
BEGIN
  IF v_actor IS NULL OR p_user_id IS NULL OR p_user_id <> v_actor THEN
    RAISE EXCEPTION 'Usuário de aprovação inválido.';
  END IF;

  SELECT p.is_active INTO v_profile_active FROM public.profiles p WHERE p.id = v_actor;
  IF COALESCE(v_profile_active, false) = false THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;

  IF p_inventory_id IS NULL THEN
    RAISE EXCEPTION 'Inventário é obrigatório.';
  END IF;

  SELECT pi.status, pi.store_id
    INTO v_status, v_store_id
  FROM public.physical_inventories pi
  WHERE pi.id = p_inventory_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventário não encontrado.';
  END IF;

  SELECT s.is_active INTO v_store_active FROM public.stores s WHERE s.id = v_store_id;
  IF COALESCE(v_store_active, false) = false THEN
    RAISE EXCEPTION 'Loja inválida ou inativa.';
  END IF;

  v_role := public.get_user_store_role(v_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER') THEN
    RAISE EXCEPTION 'Permissão negada para aprovar inventário.';
  END IF;

  IF v_status = 'APPROVED' THEN
    RETURN true;
  END IF;

  IF v_status NOT IN ('OPEN', 'IN_PROGRESS', 'DRAFT') THEN
    RAISE EXCEPTION 'Apenas inventários em andamento ou rascunho podem ser aprovados.';
  END IF;

  SELECT count(*),
         count(*) FILTER (
           WHERE product_variant_id IS NULL
              OR expected_quantity < 0
              OR counted_quantity < 0
              OR counted_quantity IS NULL
         )
    INTO v_item_count, v_incomplete_count
  FROM public.physical_inventory_items
  WHERE inventory_id = p_inventory_id;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Inventário sem itens não pode ser aprovado.';
  END IF;

  IF v_incomplete_count > 0 THEN
    RAISE EXCEPTION 'Inventário contém itens incompletos ou inválidos.';
  END IF;

  FOR v_item IN
    SELECT product_variant_id, expected_quantity, counted_quantity, reason
    FROM public.physical_inventory_items
    WHERE inventory_id = p_inventory_id
    ORDER BY product_variant_id
    FOR UPDATE
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.product_variants pv
      JOIN public.products p ON p.id = pv.product_id
      WHERE pv.id = v_item.product_variant_id
        AND pv.is_active = true
        AND p.is_active = true
    ) THEN
      RAISE EXCEPTION 'Variação inválida no inventário.';
    END IF;

    SELECT quantity INTO v_before
    FROM public.store_inventory
    WHERE store_id = v_store_id AND product_variant_id = v_item.product_variant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.store_inventory(
        store_id, product_variant_id, quantity, minimum_stock
      ) VALUES(v_store_id, v_item.product_variant_id, 0, 0);
      v_before := 0;
    END IF;

    v_divergence := v_item.counted_quantity - v_item.expected_quantity;
    v_after := v_item.counted_quantity;

    IF v_divergence <> 0 THEN
      UPDATE public.store_inventory
      SET quantity = v_after
      WHERE store_id = v_store_id AND product_variant_id = v_item.product_variant_id;

      INSERT INTO public.inventory_movements(
        store_id, product_variant_id, type, quantity, quantity_before,
        quantity_after, reference_type, reference_id, user_id, reason, notes
      )
      VALUES(
        v_store_id, v_item.product_variant_id, 'ADJUSTMENT', v_divergence,
        v_before, v_after, 'INVENTORY', p_inventory_id, v_actor,
        COALESCE(v_item.reason, 'Ajuste de inventário físico'),
        'Ajuste de inventário físico'
      );
    END IF;

    UPDATE public.product_variants pv
    SET stock_quantity = (
      SELECT COALESCE(sum(si.quantity), 0)
      FROM public.store_inventory si
      WHERE si.product_variant_id = pv.id
    )
    WHERE pv.id = v_item.product_variant_id;
  END LOOP;

  UPDATE public.physical_inventories
  SET status = 'APPROVED', approved_by = v_actor, updated_at = now()
  WHERE id = p_inventory_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_physical_inventory(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_physical_inventory(uuid,uuid) TO authenticated;
ALTER FUNCTION public.approve_physical_inventory(uuid,uuid) SET search_path = public;

-- 7) Harden report/helper RPCs with store filtering & search_path
CREATE OR REPLACE FUNCTION public.report_stock_status(p_store_id uuid DEFAULT NULL)
RETURNS TABLE(product_id uuid, product_name text, variant_id uuid, variant_sku text, stock_quantity integer, reserved_quantity integer, minimum_stock integer, status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticação obrigatória.'; END IF;
  IF public.current_user_role() IS NULL THEN RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.'; END IF;
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
  JOIN public.store_inventory si ON si.product_variant_id = pv.id AND si.store_id = p_store_id
  WHERE p.is_active = true AND pv.is_active = true
  ORDER BY CASE WHEN si.quantity = 0 THEN 1
                WHEN si.quantity <= pv.minimum_stock THEN 2
                ELSE 3 END,
           si.quantity;
END;
$$;

REVOKE ALL ON FUNCTION public.report_stock_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_stock_status(uuid) TO authenticated;
ALTER FUNCTION public.report_stock_status(uuid) SET search_path = public;

CREATE OR REPLACE FUNCTION public.report_top_selling_products(p_limit integer DEFAULT 10, p_store_id uuid DEFAULT NULL)
RETURNS TABLE(product_id uuid, product_name text, total_quantity_sold bigint, total_revenue numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticação obrigatória.'; END IF;
  IF public.current_user_role() IS NULL THEN RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.'; END IF;
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

REVOKE ALL ON FUNCTION public.report_top_selling_products(integer,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_top_selling_products(integer,uuid) TO authenticated;
ALTER FUNCTION public.report_top_selling_products(integer,uuid) SET search_path = public;

CREATE OR REPLACE FUNCTION public.report_inventory_movements_summary(
  p_start_date timestamptz DEFAULT now() - interval '30 days',
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
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticação obrigatória.'; END IF;
  IF public.current_user_role() IS NULL THEN RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.'; END IF;
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

REVOKE ALL ON FUNCTION public.report_inventory_movements_summary(timestamptz,timestamptz,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_inventory_movements_summary(timestamptz,timestamptz,uuid) TO authenticated;
ALTER FUNCTION public.report_inventory_movements_summary(timestamptz,timestamptz,uuid) SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_profitability_by_product(
  p_store_id uuid,
  start_date date DEFAULT NULL,
  end_date date DEFAULT NULL
)
RETURNS TABLE(product_id uuid, product_name text, category_id uuid, total_quantity bigint, total_revenue numeric, total_cost numeric, margin_value numeric, margin_percentage numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticação obrigatória.'; END IF;
  IF public.current_user_role() IS NULL THEN RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.'; END IF;
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
    AND (start_date IS NULL OR s.completed_at::date >= start_date)
    AND (end_date IS NULL OR s.completed_at::date <= end_date)
  GROUP BY p.id, p.name, p.category_id
  ORDER BY margin_value DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_profitability_by_product(uuid,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profitability_by_product(uuid,date,date) TO authenticated;
ALTER FUNCTION public.get_profitability_by_product(uuid,date,date) SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_profitability_by_category(
  p_store_id uuid,
  start_date date DEFAULT NULL,
  end_date date DEFAULT NULL
)
RETURNS TABLE(category_id uuid, category_name text, total_quantity bigint, total_revenue numeric, total_cost numeric, margin_value numeric, margin_percentage numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticação obrigatória.'; END IF;
  IF public.current_user_role() IS NULL THEN RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.'; END IF;
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
    AND (start_date IS NULL OR s.completed_at::date >= start_date)
    AND (end_date IS NULL OR s.completed_at::date <= end_date)
  GROUP BY c.id, c.name
  ORDER BY margin_value DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_profitability_by_category(uuid,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profitability_by_category(uuid,date,date) TO authenticated;
ALTER FUNCTION public.get_profitability_by_category(uuid,date,date) SET search_path = public;

-- 8) Physical inventory RLS policy & identity immutability
DROP POLICY IF EXISTS "Physical inventories update by store managers" ON public.physical_inventories;
CREATE POLICY "Physical inventories update by store managers"
ON public.physical_inventories
FOR UPDATE TO authenticated
USING (
  store_id IS NOT NULL
  AND public.get_user_store_role(store_id) IN ('ADMIN','MANAGER')
)
WITH CHECK (
  store_id IS NOT NULL
  AND public.get_user_store_role(store_id) IN ('ADMIN','MANAGER')
);

CREATE OR REPLACE FUNCTION public.prevent_physical_inventory_identity_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF OLD.store_id IS DISTINCT FROM NEW.store_id
     OR OLD.created_by IS DISTINCT FROM NEW.created_by THEN
    RAISE EXCEPTION 'store_id e created_by de inventário físico são imutáveis.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_physical_inventory_identity_change ON public.physical_inventories;
CREATE TRIGGER trg_prevent_physical_inventory_identity_change
BEFORE UPDATE ON public.physical_inventories
FOR EACH ROW
EXECUTE FUNCTION public.prevent_physical_inventory_identity_change();

COMMIT;
