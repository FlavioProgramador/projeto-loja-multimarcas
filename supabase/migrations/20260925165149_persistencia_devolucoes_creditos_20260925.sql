
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS rg TEXT;

CREATE TABLE IF NOT EXISTS public.customer_credit_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('CREDIT','DEBIT')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  description TEXT NOT NULL,
  reference_type TEXT,
  reference_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_credit_reference
  ON public.customer_credit_movements(reference_type, reference_id, type);

CREATE INDEX IF NOT EXISTS idx_customer_credit_store_customer_created
  ON public.customer_credit_movements(store_id, customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number TEXT NOT NULL UNIQUE,
  original_sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE RESTRICT,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_cpf TEXT,
  resolution_type TEXT NOT NULL CHECK (resolution_type IN ('credito_cliente','vale_troca','estorno_dinheiro')),
  status TEXT NOT NULL DEFAULT 'CONCLUIDO' CHECK (status IN ('CONCLUIDO','CANCELADO')),
  total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
  observations TEXT,
  expires_at DATE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES public.returns(id) ON DELETE RESTRICT,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_variant_id UUID NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  size TEXT NOT NULL,
  color TEXT NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_returns_store_created
  ON public.returns(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_returns_original_sale
  ON public.returns(original_sale_id);
CREATE INDEX IF NOT EXISTS idx_return_items_return
  ON public.return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_return_items_variant
  ON public.return_items(product_variant_id);

ALTER TABLE public.returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_credit_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Returns viewable by store access" ON public.returns;
CREATE POLICY "Returns viewable by store access"
ON public.returns FOR SELECT TO authenticated
USING (public.has_store_access(store_id) OR public.current_user_role() = 'ADMIN');

DROP POLICY IF EXISTS "Return items viewable by store access" ON public.return_items;
CREATE POLICY "Return items viewable by store access"
ON public.return_items FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.returns r
    WHERE r.id = return_id
      AND (public.has_store_access(r.store_id) OR public.current_user_role() = 'ADMIN')
  )
);

DROP POLICY IF EXISTS "Customer credit movements viewable by store access" ON public.customer_credit_movements;
CREATE POLICY "Customer credit movements viewable by store access"
ON public.customer_credit_movements FOR SELECT TO authenticated
USING (public.has_store_access(store_id) OR public.current_user_role() = 'ADMIN');

CREATE OR REPLACE FUNCTION public.process_return(
  p_store_id UUID,
  p_original_sale_id UUID,
  p_customer_id UUID DEFAULT NULL,
  p_customer_name TEXT DEFAULT NULL,
  p_customer_cpf TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::JSONB,
  p_resolution_type TEXT DEFAULT 'credito_cliente',
  p_observations TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_sale RECORD;
  v_return_id UUID;
  v_return_number TEXT;
  v_item RECORD;
  v_sold_qty INTEGER;
  v_returned_qty INTEGER;
  v_available_qty INTEGER;
  v_stock_before INTEGER;
  v_total NUMERIC(12,2) := 0;
  v_customer_id UUID := p_customer_id;
  v_unit_price NUMERIC(12,2);
  v_product_id UUID;
  v_size TEXT;
  v_color TEXT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Não autorizado.'; END IF;
  v_role := public.get_user_store_role(p_store_id);
  IF v_role NOT IN ('ADMIN','MANAGER','CASHIER') THEN RAISE EXCEPTION 'Permissão negada.'; END IF;
  IF p_original_sale_id IS NULL THEN RAISE EXCEPTION 'A devolução deve estar vinculada a uma venda original.'; END IF;
  IF jsonb_array_length(COALESCE(p_items,'[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'Nenhum item informado para devolução.'; END IF;
  IF p_resolution_type NOT IN ('credito_cliente','vale_troca','estorno_dinheiro') THEN RAISE EXCEPTION 'Forma de resolução inválida.'; END IF;

  SELECT * INTO v_sale
  FROM public.sales
  WHERE id = p_original_sale_id
    AND store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Venda original não encontrada nesta loja.'; END IF;
  IF v_sale.status <> 'COMPLETED' THEN RAISE EXCEPTION 'Somente vendas concluídas podem ter devolução.'; END IF;

  IF v_customer_id IS NULL THEN v_customer_id := v_sale.customer_id; END IF;
  IF v_customer_id IS NULL AND NULLIF(trim(p_customer_cpf),'') IS NOT NULL THEN
    SELECT id INTO v_customer_id FROM public.customers WHERE cpf = trim(p_customer_cpf) LIMIT 1;
  END IF;
  IF v_customer_id IS NULL AND p_resolution_type IN ('credito_cliente','vale_troca') THEN
    RAISE EXCEPTION 'Crédito ou vale-troca exige um cliente identificado.';
  END IF;

  FOR v_item IN
    SELECT *
    FROM jsonb_to_recordset(p_items) AS (
      variant_id UUID,
      quantity INT,
      product_name TEXT,
      size TEXT,
      color TEXT,
      reason TEXT
    )
  LOOP
    IF v_item.variant_id IS NULL OR v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'Item de devolução inválido.';
    END IF;

    SELECT COALESCE(SUM(si.quantity),0) INTO v_sold_qty
    FROM public.sale_items si
    WHERE si.sale_id = p_original_sale_id
      AND si.product_variant_id = v_item.variant_id;

    SELECT COALESCE(SUM(ri.quantity),0) INTO v_returned_qty
    FROM public.return_items ri
    JOIN public.returns r ON r.id = ri.return_id
    WHERE r.original_sale_id = p_original_sale_id
      AND r.status = 'CONCLUIDO'
      AND ri.product_variant_id = v_item.variant_id;

    v_available_qty := v_sold_qty - v_returned_qty;
    IF v_sold_qty = 0 THEN RAISE EXCEPTION 'A variação informada não pertence à venda original.'; END IF;
    IF v_item.quantity > v_available_qty THEN
      RAISE EXCEPTION 'Quantidade devolvida excede a quantidade ainda disponível para devolução.';
    END IF;

    SELECT si.unit_price, si.product_id, pv.size, pv.color
      INTO v_unit_price, v_product_id, v_size, v_color
    FROM public.sale_items si
    JOIN public.product_variants pv ON pv.id = si.product_variant_id
    WHERE si.sale_id = p_original_sale_id
      AND si.product_variant_id = v_item.variant_id
    ORDER BY si.created_at
    LIMIT 1;

    v_total := v_total + (v_unit_price * v_item.quantity);

    SELECT quantity INTO v_stock_before
    FROM public.store_inventory
    WHERE store_id = p_store_id
      AND product_variant_id = v_item.variant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.store_inventory(store_id,product_variant_id,quantity,minimum_stock)
      VALUES(p_store_id,v_item.variant_id,0,0);
      v_stock_before := 0;
    END IF;
  END LOOP;

  IF v_customer_id IS NULL AND p_customer_id IS NULL AND p_customer_cpf IS NOT NULL THEN
    SELECT id INTO v_customer_id FROM public.customers WHERE cpf=trim(p_customer_cpf) LIMIT 1;
  END IF;

  v_return_number := 'DEV-' || nextval('sale_number_seq')::TEXT;

  INSERT INTO public.returns (
    return_number, original_sale_id, customer_id, customer_name, customer_cpf,
    resolution_type, status, total_amount, observations, expires_at, created_by, store_id
  )
  VALUES (
    v_return_number, p_original_sale_id, v_customer_id,
    COALESCE(NULLIF(trim(p_customer_name),''), v_sale.customer_name, 'Consumidor Final'),
    COALESCE(NULLIF(trim(p_customer_cpf),''), v_sale.customer_cpf),
    p_resolution_type, 'CONCLUIDO', ROUND(v_total,2), p_observations,
    current_date + INTERVAL '30 days', v_user_id, p_store_id
  )
  RETURNING id INTO v_return_id;

  FOR v_item IN
    SELECT *
    FROM jsonb_to_recordset(p_items) AS (
      variant_id UUID,
      quantity INT,
      product_name TEXT,
      size TEXT,
      color TEXT,
      reason TEXT
    )
  LOOP
    SELECT si.unit_price, si.product_id, pv.size, pv.color
      INTO v_unit_price, v_product_id, v_size, v_color
    FROM public.sale_items si
    JOIN public.product_variants pv ON pv.id=si.product_variant_id
    WHERE si.sale_id=p_original_sale_id AND si.product_variant_id=v_item.variant_id
    ORDER BY si.created_at
    LIMIT 1;

    SELECT quantity INTO v_stock_before
    FROM public.store_inventory
    WHERE store_id=p_store_id AND product_variant_id=v_item.variant_id
    FOR UPDATE;

    INSERT INTO public.return_items(
      return_id,product_id,product_variant_id,product_name,size,color,unit_price,quantity,reason
    )
    VALUES(
      v_return_id,v_product_id,v_item.variant_id,COALESCE(v_item.product_name,'Produto'),
      COALESCE(v_item.size,v_size,'Único'),COALESCE(v_item.color,v_color,'Padrão'),
      v_unit_price,v_item.quantity,COALESCE(v_item.reason,'Devolução')
    );

    UPDATE public.store_inventory
    SET quantity=quantity+v_item.quantity
    WHERE store_id=p_store_id AND product_variant_id=v_item.variant_id;

    INSERT INTO public.inventory_movements(
      store_id,product_variant_id,type,quantity,quantity_before,quantity_after,
      reference_type,reference_id,user_id,notes,reason
    )
    VALUES(
      p_store_id,v_item.variant_id,'RETURN',v_item.quantity,v_stock_before,
      v_stock_before+v_item.quantity,'RETURN',v_return_id,v_user_id,
      'Devolução '||v_return_number,COALESCE(v_item.reason,'Devolução')
    );

    UPDATE public.product_variants
    SET stock_quantity=(SELECT COALESCE(SUM(quantity),0) FROM public.store_inventory WHERE product_variant_id=v_item.variant_id)
    WHERE id=v_item.variant_id;
  END LOOP;

  IF p_resolution_type IN ('credito_cliente','vale_troca') THEN
    INSERT INTO public.customer_credit_movements(
      store_id,customer_id,type,amount,description,reference_type,reference_id
    )
    VALUES(
      p_store_id,v_customer_id,'CREDIT',ROUND(v_total,2),
      CASE WHEN p_resolution_type='vale_troca' THEN 'Vale-troca gerado pela devolução ' ELSE 'Crédito gerado pela devolução ' END || v_return_number,
      'RETURN',v_return_id
    );

    INSERT INTO public.financial_transactions(
      store_id,type,category,description,amount,status,reference_type,reference_id,paid_at
    )
    VALUES(
      p_store_id,'EXPENSE','Créditos de devolução','Crédito/vale emitido na devolução '||v_return_number,
      ROUND(v_total,2),'PAID','RETURN',v_return_id,NOW()
    );
  ELSE
    INSERT INTO public.financial_transactions(
      store_id,type,category,description,amount,status,reference_type,reference_id,paid_at
    )
    VALUES(
      p_store_id,'EXPENSE','Estornos','Estorno em dinheiro da devolução '||v_return_number,
      ROUND(v_total,2),'PAID','RETURN',v_return_id,NOW()
    );
  END IF;

  RETURN jsonb_build_object(
    'success',true,
    'return_id',v_return_id,
    'return_number',v_return_number,
    'total',ROUND(v_total,2)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_return(UUID,UUID,UUID,TEXT,TEXT,JSONB,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_return(UUID,UUID,UUID,TEXT,TEXT,JSONB,TEXT,TEXT) TO authenticated;
