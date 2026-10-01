-- CoreSys security hardening
-- Project ref: ndrjynlbwrugakjqtzwy
-- No DROP of business functions. Legacy signatures remain installed but are API-inaccessible.

BEGIN;

-- 1) Explicit API grants/revokes. Keep service-only PIX settlement RPCs service_role-only.
REVOKE ALL ON FUNCTION public.complete_sale(uuid,text,text,jsonb,text,integer,numeric,numeric,text) FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'create_mp_pix_sale'
      AND pg_get_function_identity_arguments(p.oid) = 'uuid, text, text, jsonb, numeric, numeric'
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric) FROM PUBLIC, anon, authenticated';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.complete_sale(uuid,uuid,text,text,jsonb,text,integer,numeric,numeric,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_sale(uuid,uuid,text,text,jsonb,text,integer,numeric,numeric,text) TO authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'create_mp_pix_sale'
      AND pg_get_function_identity_arguments(p.oid) = 'uuid, text, text, jsonb, numeric, numeric, uuid, text'
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric,uuid,text) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric,uuid,text) TO authenticated';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.approve_physical_inventory(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_physical_inventory(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_sale(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_sale(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.process_return(uuid,uuid,uuid,text,text,jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_return(uuid,uuid,uuid,text,text,jsonb,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.register_stock_entry(uuid,integer,numeric,text,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_stock_entry(uuid,integer,numeric,text,uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.manage_product(uuid,text,text,text,numeric,numeric,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_product(uuid,text,text,text,numeric,numeric,jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
REVOKE ALL ON FUNCTION public.get_user_store_role(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_store_role(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.has_store_access(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_store_access(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_variant_stock_by_store(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_variant_stock_by_store(uuid) TO authenticated;

-- Modern store-scoped reports.
REVOKE ALL ON FUNCTION public.report_stock_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_stock_status(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.report_top_selling_products(integer,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_top_selling_products(integer,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.report_inventory_movements_summary(timestamptz,timestamptz,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_inventory_movements_summary(timestamptz,timestamptz,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_profitability_by_product(uuid,date,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_profitability_by_product(uuid,date,date) TO authenticated;
REVOKE ALL ON FUNCTION public.get_profitability_by_category(uuid,date,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_profitability_by_category(uuid,date,date) TO authenticated;

REVOKE ALL ON FUNCTION public.approve_mp_pix_sale(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_mp_pix_sale(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_mp_pix_sale(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_mp_pix_sale(uuid) TO service_role;

-- 2) Prevent direct access to internal idempotency storage.
REVOKE ALL ON TABLE public.sale_idempotency FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "sale_idempotency deny all" ON public.sale_idempotency;
CREATE POLICY "sale_idempotency deny all"
  ON public.sale_idempotency
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- 3) Harden helper visibility.
CREATE OR REPLACE FUNCTION public.get_variant_stock_by_store(p_variant_id uuid)
RETURNS TABLE(store_id uuid, store_name text, stock_quantity bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT s.id, s.name, COALESCE(si.quantity, 0)::bigint
  FROM public.stores s
  LEFT JOIN public.store_inventory si
    ON si.store_id = s.id
   AND si.product_variant_id = p_variant_id
  WHERE s.is_active = true
    AND EXISTS (
      SELECT 1
      FROM public.user_store_access usa
      JOIN public.profiles p ON p.id = usa.user_id
      WHERE usa.user_id = auth.uid()
        AND usa.store_id = s.id
        AND usa.is_active = true
        AND p.is_active = true
    )
  ORDER BY s.name;
$$;

-- 4) Rebuild complete_sale with fail-closed checks and scoped idempotency.
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
SET search_path TO public
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

  IF COALESCE(v_profile_active,false) = false THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;

  IF p_store_id IS NULL THEN
    RAISE EXCEPTION 'Loja obrigatória.';
  END IF;

  SELECT s.is_active INTO v_store_active
  FROM public.stores s
  WHERE s.id = p_store_id;

  IF COALESCE(v_store_active,false) = false THEN
    RAISE EXCEPTION 'Loja inválida ou inativa.';
  END IF;

  v_role := public.get_user_store_role(p_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER','CASHIER') THEN
    RAISE EXCEPTION 'Permissão negada para vender nesta loja.';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' OR length(btrim(p_idempotency_key)) > 200 THEN
    RAISE EXCEPTION 'Chave de idempotência obrigatória e inválida.';
  END IF;

  IF jsonb_typeof(COALESCE(p_items,'[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_items,'[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Carrinho vazio.';
  END IF;

  IF COALESCE(p_installments,1) < 1 OR COALESCE(p_installments,1) > 24 THEN
    RAISE EXCEPTION 'Número de parcelas inválido.';
  END IF;

  IF COALESCE(p_discount_value,0) < 0
     OR COALESCE(p_discount_percent,0) < 0
     OR COALESCE(p_discount_percent,0) > 100 THEN
    RAISE EXCEPTION 'Desconto inválido.';
  END IF;

  v_scoped_key := v_user_id::text || ':' || p_store_id::text || ':' || btrim(p_idempotency_key);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_scoped_key,0));

  -- New scoped format.
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

  -- Backward compatibility for legacy raw keys only when ownership/store matches.
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
     AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id=v_customer_id AND c.is_active=true) THEN
    RAISE EXCEPTION 'Cliente inválido ou inativo.';
  END IF;

  IF v_customer_id IS NULL
     AND NULLIF(trim(p_customer_cpf),'') IS NOT NULL
     AND trim(p_customer_cpf) <> 'Não informado' THEN
    SELECT c.id INTO v_customer_id
    FROM public.customers c
    WHERE c.cpf=trim(p_customer_cpf) AND c.is_active=true
    LIMIT 1;

    IF v_customer_id IS NULL
       AND NULLIF(trim(p_customer_name),'') IS NOT NULL
       AND trim(p_customer_name) <> 'Cliente não identificado' THEN
      INSERT INTO public.customers(name,cpf)
      VALUES(trim(p_customer_name),trim(p_customer_cpf))
      RETURNING id INTO v_customer_id;
    END IF;
  END IF;

  v_method := CASE
    WHEN upper(coalesce(p_payment_method,'')) LIKE '%PIX%' THEN 'PIX'
    WHEN upper(coalesce(p_payment_method,'')) LIKE '%DEBIT%' THEN 'DEBIT_CARD'
    WHEN upper(coalesce(p_payment_method,'')) LIKE '%CART%' THEN 'CREDIT_CARD'
    WHEN upper(coalesce(p_payment_method,'')) LIKE '%CASH%'
      OR upper(coalesce(p_payment_method,'')) LIKE '%DINHEIRO%' THEN 'CASH'
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

    SELECT si.id,si.quantity,pv.product_id,pv.size,pv.color,p.sale_price
      INTO v_inv
    FROM public.store_inventory si
    JOIN public.product_variants pv ON pv.id=si.product_variant_id
    JOIN public.products p ON p.id=pv.product_id
    WHERE si.store_id=p_store_id
      AND si.product_variant_id=v_item.variant_id
      AND pv.is_active=true
      AND p.is_active=true
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto não está disponível nesta loja.';
    END IF;

    IF v_inv.quantity < v_item.quantity THEN
      RAISE EXCEPTION 'Estoque insuficiente para o produto informado.';
    END IF;

    v_subtotal := v_subtotal + round(v_inv.sale_price*v_item.quantity,2);
  END LOOP;

  v_discount := least(
    v_subtotal,
    greatest(0,coalesce(p_discount_value,0)) +
      (v_subtotal*least(100,greatest(0,coalesce(p_discount_percent,0)))/100)
  );
  v_total := round(greatest(0,v_subtotal-v_discount),2);

  v_sale_number := 'PDV #'||nextval('sale_number_seq')::text;

  INSERT INTO public.sales(
    store_id,sale_number,customer_id,user_id,customer_name,customer_cpf,
    subtotal,discount,total,status,completed_at
  )
  VALUES(
    p_store_id,v_sale_number,v_customer_id,v_user_id,
    coalesce(nullif(trim(p_customer_name),''),'Cliente não identificado'),
    coalesce(nullif(trim(p_customer_cpf),''),'Não informado'),
    round(v_subtotal,2),round(v_discount,2),v_total,'COMPLETED',now()
  )
  RETURNING id INTO v_sale_id;

  INSERT INTO public.sale_idempotency(idempotency_key,sale_id)
  VALUES(v_scoped_key,v_sale_id);

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
      sale_id,product_id,product_variant_id,product_name,variant_description,
      quantity,unit_price,total
    )
    SELECT v_sale_id,pv.product_id,v_item.variant_id,p.name,
      coalesce(pv.size,'Único')||' / '||coalesce(pv.color,'Padrão'),
      v_item.quantity,p.sale_price,round(p.sale_price*v_item.quantity,2)
    FROM public.product_variants pv
    JOIN public.products p ON p.id=pv.product_id
    WHERE pv.id=v_item.variant_id
      AND pv.is_active=true
      AND p.is_active=true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variação de venda não encontrada durante persistência.';
    END IF;

    UPDATE public.store_inventory
    SET quantity=quantity-v_item.quantity
    WHERE store_id=p_store_id AND product_variant_id=v_item.variant_id;

    INSERT INTO public.inventory_movements(
      store_id,product_variant_id,type,quantity,quantity_before,
      quantity_after,reference_type,reference_id,user_id,notes,reason
    )
    SELECT p_store_id,v_item.variant_id,'SALE',v_item.quantity,
      si.quantity+v_item.quantity,si.quantity,'SALE',v_sale_id,v_user_id,
      'Venda '||v_sale_number,'Venda concluída'
    FROM public.store_inventory si
    WHERE si.store_id=p_store_id
      AND si.product_variant_id=v_item.variant_id;

    UPDATE public.product_variants pv
    SET stock_quantity=(
      SELECT coalesce(sum(si.quantity),0)
      FROM public.store_inventory si
      WHERE si.product_variant_id=pv.id
    )
    WHERE pv.id=v_item.variant_id;
  END LOOP;

  INSERT INTO public.payments(sale_id,method,amount,status,installments)
  VALUES(v_sale_id,v_method,v_total,'APPROVED',coalesce(p_installments,1));

  INSERT INTO public.financial_transactions(
    store_id,type,category,description,amount,status,reference_type,reference_id,paid_at
  )
  VALUES(
    p_store_id,'INCOME','Vendas PDV','Venda '||v_sale_number,
    v_total,'PAID','SALE',v_sale_id,now()
  );

  RETURN jsonb_build_object('success',true,'sale_id',v_sale_id,'sale_number',v_sale_number,'total',v_total);
END;
$$;

-- 5) Rebuild create_mp_pix_sale with the same scoped idempotency boundary.
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
SET search_path TO public
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

  IF COALESCE(v_profile_active,false) = false THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;

  IF p_store_id IS NULL THEN
    RAISE EXCEPTION 'Loja obrigatória.';
  END IF;

  SELECT s.is_active INTO v_store_active
  FROM public.stores s
  WHERE s.id=p_store_id;

  IF COALESCE(v_store_active,false)=false THEN
    RAISE EXCEPTION 'Loja inválida ou inativa.';
  END IF;

  v_role:=public.get_user_store_role(p_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER','CASHIER') THEN
    RAISE EXCEPTION 'Permissão negada para criar venda PIX nesta loja.';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key)='' OR length(btrim(p_idempotency_key)) > 200 THEN
    RAISE EXCEPTION 'Chave de idempotência obrigatória e inválida.';
  END IF;

  IF jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array'
     OR jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 THEN
    RAISE EXCEPTION 'Carrinho vazio.';
  END IF;

  IF coalesce(p_discount_value,0)<0
     OR coalesce(p_discount_percent,0)<0
     OR coalesce(p_discount_percent,0)>100 THEN
    RAISE EXCEPTION 'Desconto inválido.';
  END IF;

  v_scoped_key := v_user_id::text || ':' || p_store_id::text || ':' || btrim(p_idempotency_key);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_scoped_key,0));

  SELECT si.sale_id INTO v_sale_id
  FROM public.sale_idempotency si
  WHERE si.idempotency_key=v_scoped_key
  FOR SHARE;

  IF v_sale_id IS NOT NULL THEN
    RETURN (
      SELECT jsonb_build_object(
        'success',true,
        'sale_id',s.id,
        'sale_number',s.sale_number,
        'total',s.total,
        'message','Venda PIX já processada anteriormente (idempotência).'
      )
      FROM public.sales s
      WHERE s.id=v_sale_id
        AND s.user_id=v_user_id
        AND s.store_id=p_store_id
    );
  END IF;

  SELECT si.sale_id INTO v_sale_id
  FROM public.sale_idempotency si
  JOIN public.sales s ON s.id=si.sale_id
  WHERE si.idempotency_key=btrim(p_idempotency_key)
    AND s.user_id=v_user_id
    AND s.store_id=p_store_id
  FOR SHARE;

  IF v_sale_id IS NOT NULL THEN
    RETURN (
      SELECT jsonb_build_object(
        'success',true,
        'sale_id',s.id,
        'sale_number',s.sale_number,
        'total',s.total,
        'message','Venda PIX já processada anteriormente (idempotência legada).'
      )
      FROM public.sales s
      WHERE s.id=v_sale_id
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sale_idempotency si
    JOIN public.sales s ON s.id=si.sale_id
    WHERE si.idempotency_key=btrim(p_idempotency_key)
      AND (s.user_id IS DISTINCT FROM v_user_id OR s.store_id IS DISTINCT FROM p_store_id)
  ) THEN
    RAISE EXCEPTION 'Chave de idempotência já utilizada em outro contexto.';
  END IF;

  IF v_customer_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id=v_customer_id AND c.is_active=true) THEN
    RAISE EXCEPTION 'Cliente inválido ou inativo.';
  END IF;

  FOR v_item IN
    SELECT x.variant_id,sum(x.quantity)::integer quantity
    FROM jsonb_to_recordset(p_items) AS x(
      variant_id uuid,quantity integer,unit_price numeric,
      product_id uuid,product_name text,variant_description text
    )
    GROUP BY x.variant_id
    ORDER BY x.variant_id
  LOOP
    IF v_item.variant_id IS NULL OR v_item.quantity IS NULL OR v_item.quantity<=0 THEN
      RAISE EXCEPTION 'Item de venda inválido.';
    END IF;

    SELECT si.id,si.quantity,pv.product_id,pv.size,pv.color,p.sale_price INTO v_inv
    FROM public.store_inventory si
    JOIN public.product_variants pv ON pv.id=si.product_variant_id
    JOIN public.products p ON p.id=pv.product_id
    WHERE si.store_id=p_store_id
      AND si.product_variant_id=v_item.variant_id
      AND pv.is_active=true
      AND p.is_active=true
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto não está disponível nesta loja.';
    END IF;

    IF v_inv.quantity<v_item.quantity THEN
      RAISE EXCEPTION 'Estoque insuficiente para o produto informado.';
    END IF;

    v_subtotal:=v_subtotal+round(v_inv.sale_price*v_item.quantity,2);
  END LOOP;

  v_discount:=least(
    v_subtotal,
    greatest(0,coalesce(p_discount_value,0)) +
      (v_subtotal*least(100,greatest(0,coalesce(p_discount_percent,0)))/100)
  );
  v_total:=round(greatest(0,v_subtotal-v_discount),2);
  v_sale_number:='PDV #'||nextval('sale_number_seq')::text;

  INSERT INTO public.sales(
    store_id,sale_number,customer_id,user_id,customer_name,customer_cpf,
    subtotal,discount,total,status
  )
  VALUES(
    p_store_id,v_sale_number,v_customer_id,v_user_id,
    coalesce(nullif(trim(p_customer_name),''),'Cliente não identificado'),
    coalesce(nullif(trim(p_customer_cpf),''),'Não informado'),
    round(v_subtotal,2),round(v_discount,2),v_total,'PENDING'
  )
  RETURNING id INTO v_sale_id;

  INSERT INTO public.sale_idempotency(idempotency_key,sale_id)
  VALUES(v_scoped_key,v_sale_id);

  FOR v_item IN
    SELECT x.variant_id,sum(x.quantity)::integer quantity
    FROM jsonb_to_recordset(p_items) AS x(
      variant_id uuid,quantity integer,unit_price numeric,
      product_id uuid,product_name text,variant_description text
    )
    GROUP BY x.variant_id
    ORDER BY x.variant_id
  LOOP
    INSERT INTO public.sale_items(
      sale_id,product_id,product_variant_id,product_name,variant_description,
      quantity,unit_price,total
    )
    SELECT v_sale_id,pv.product_id,v_item.variant_id,p.name,
      coalesce(pv.size,'Único')||' / '||coalesce(pv.color,'Padrão'),
      v_item.quantity,p.sale_price,round(p.sale_price*v_item.quantity,2)
    FROM public.product_variants pv
    JOIN public.products p ON p.id=pv.product_id
    WHERE pv.id=v_item.variant_id AND pv.is_active=true AND p.is_active=true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variação PIX não encontrada durante persistência.';
    END IF;

    UPDATE public.store_inventory
    SET quantity=quantity-v_item.quantity
    WHERE store_id=p_store_id AND product_variant_id=v_item.variant_id;

    INSERT INTO public.inventory_movements(
      store_id,product_variant_id,type,quantity,quantity_before,
      quantity_after,reference_type,reference_id,user_id,notes,reason
    )
    SELECT p_store_id,v_item.variant_id,'SALE',v_item.quantity,
      si.quantity+v_item.quantity,si.quantity,'SALE',v_sale_id,v_user_id,
      'Reserva PIX '||v_sale_number,'Reserva de estoque PIX'
    FROM public.store_inventory si
    WHERE si.store_id=p_store_id AND si.product_variant_id=v_item.variant_id;

    UPDATE public.product_variants pv
    SET reserved_quantity=pv.reserved_quantity+v_item.quantity,
        stock_quantity=(SELECT coalesce(sum(si.quantity),0)
                        FROM public.store_inventory si
                        WHERE si.product_variant_id=pv.id)
    WHERE pv.id=v_item.variant_id;
  END LOOP;

  INSERT INTO public.payments(sale_id,method,amount,status,installments)
  VALUES(v_sale_id,'PIX',v_total,'PENDING',1);

  RETURN jsonb_build_object('success',true,'sale_id',v_sale_id,'sale_number',v_sale_number,'total',v_total);
END;
$$;

-- 6) Harden return validation against duplicate variants and mismatched customer.
CREATE OR REPLACE FUNCTION public.process_return(
  p_store_id uuid,
  p_original_sale_id uuid,
  p_customer_id uuid DEFAULT NULL,
  p_customer_name text DEFAULT NULL,
  p_customer_cpf text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_resolution_type text DEFAULT 'credito_cliente',
  p_observations text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_profile_active boolean := false;
  v_role text;
  v_sale record;
  v_return_id uuid;
  v_return_number text;
  v_item record;
  v_sold_qty integer;
  v_returned_qty integer;
  v_available_qty integer;
  v_stock_before integer;
  v_total numeric(12,2) := 0;
  v_customer_id uuid := p_customer_id;
  v_unit_price numeric(12,2);
  v_product_id uuid;
  v_size text;
  v_color text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;

  SELECT p.is_active INTO v_profile_active
  FROM public.profiles p WHERE p.id=v_user;

  IF COALESCE(v_profile_active,false)=false THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;

  IF p_store_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.stores s WHERE s.id=p_store_id AND s.is_active=true) THEN
    RAISE EXCEPTION 'Loja inválida ou inativa.';
  END IF;

  v_role:=public.get_user_store_role(p_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER','CASHIER') THEN
    RAISE EXCEPTION 'Permissão negada.';
  END IF;

  IF p_original_sale_id IS NULL THEN
    RAISE EXCEPTION 'A devolução deve estar vinculada a uma venda original.';
  END IF;

  IF jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array'
     OR jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 THEN
    RAISE EXCEPTION 'Nenhum item informado para devolução.';
  END IF;

  IF p_resolution_type NOT IN ('credito_cliente','vale_troca','estorno_dinheiro') THEN
    RAISE EXCEPTION 'Forma de resolução inválida.';
  END IF;

  SELECT * INTO v_sale
  FROM public.sales
  WHERE id=p_original_sale_id
    AND store_id=p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda original não encontrada nesta loja.';
  END IF;

  IF v_sale.status<>'COMPLETED' THEN
    RAISE EXCEPTION 'Somente vendas concluídas podem ter devolução.';
  END IF;

  IF v_sale.customer_id IS NOT NULL
     AND v_customer_id IS NOT NULL
     AND v_sale.customer_id IS DISTINCT FROM v_customer_id THEN
    RAISE EXCEPTION 'Cliente informado não corresponde à venda original.';
  END IF;

  IF v_customer_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id=v_customer_id AND c.is_active=true) THEN
    RAISE EXCEPTION 'Cliente inválido ou inativo.';
  END IF;

  IF v_customer_id IS NULL THEN
    v_customer_id:=v_sale.customer_id;
  END IF;

  IF v_customer_id IS NULL AND NULLIF(trim(p_customer_cpf),'') IS NOT NULL THEN
    SELECT c.id INTO v_customer_id
    FROM public.customers c
    WHERE c.cpf=trim(p_customer_cpf) AND c.is_active=true
    LIMIT 1;
  END IF;

  IF v_customer_id IS NULL AND p_resolution_type IN ('credito_cliente','vale_troca') THEN
    RAISE EXCEPTION 'Crédito ou vale-troca exige um cliente identificado.';
  END IF;

  -- Aggregate the request first. The sale row lock serializes concurrent returns
  -- against this same sale, while aggregation prevents duplicate variants inside one request.
  FOR v_item IN
    SELECT x.variant_id, sum(x.quantity)::integer AS quantity,
           max(x.reason) AS reason
    FROM jsonb_to_recordset(p_items) AS x(
      variant_id uuid,quantity integer,product_name text,size text,color text,reason text
    )
    GROUP BY x.variant_id
    ORDER BY x.variant_id
  LOOP
    IF v_item.variant_id IS NULL OR v_item.quantity IS NULL OR v_item.quantity<=0 THEN
      RAISE EXCEPTION 'Item de devolução inválido.';
    END IF;

    SELECT coalesce(sum(si.quantity),0)
      INTO v_sold_qty
    FROM public.sale_items si
    WHERE si.sale_id=p_original_sale_id
      AND si.product_variant_id=v_item.variant_id;

    SELECT coalesce(sum(ri.quantity),0)
      INTO v_returned_qty
    FROM public.return_items ri
    JOIN public.returns r ON r.id=ri.return_id
    WHERE r.original_sale_id=p_original_sale_id
      AND r.status='CONCLUIDO'
      AND ri.product_variant_id=v_item.variant_id;

    v_available_qty:=v_sold_qty-v_returned_qty;

    IF v_sold_qty=0 THEN
      RAISE EXCEPTION 'A variação informada não pertence à venda original.';
    END IF;

    IF v_available_qty<0 OR v_item.quantity>v_available_qty THEN
      RAISE EXCEPTION 'Quantidade devolvida excede a quantidade ainda disponível para devolução.';
    END IF;

    SELECT si.unit_price,si.product_id,pv.size,pv.color
      INTO v_unit_price,v_product_id,v_size,v_color
    FROM public.sale_items si
    JOIN public.product_variants pv ON pv.id=si.product_variant_id
    WHERE si.sale_id=p_original_sale_id
      AND si.product_variant_id=v_item.variant_id
    ORDER BY si.created_at
    LIMIT 1;

    v_total:=v_total+(v_unit_price*v_item.quantity);

    SELECT quantity INTO v_stock_before
    FROM public.store_inventory
    WHERE store_id=p_store_id AND product_variant_id=v_item.variant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.store_inventory(store_id,product_variant_id,quantity,minimum_stock)
      VALUES(p_store_id,v_item.variant_id,0,0);
      v_stock_before:=0;
    END IF;
  END LOOP;

  v_return_number:='DEV-'||nextval('sale_number_seq')::text;

  INSERT INTO public.returns(
    return_number,original_sale_id,customer_id,customer_name,customer_cpf,
    resolution_type,status,total_amount,observations,expires_at,created_by,store_id
  )
  VALUES(
    v_return_number,p_original_sale_id,v_customer_id,
    coalesce(nullif(trim(p_customer_name),''),v_sale.customer_name,'Consumidor Final'),
    coalesce(nullif(trim(p_customer_cpf),''),v_sale.customer_cpf),
    p_resolution_type,'CONCLUIDO',round(v_total,2),p_observations,
    current_date + interval '30 days',v_user,p_store_id
  )
  RETURNING id INTO v_return_id;

  FOR v_item IN
    SELECT x.variant_id, sum(x.quantity)::integer AS quantity, max(x.reason) AS reason
    FROM jsonb_to_recordset(p_items) AS x(
      variant_id uuid,quantity integer,product_name text,size text,color text,reason text
    )
    GROUP BY x.variant_id
    ORDER BY x.variant_id
  LOOP
    SELECT si.unit_price,si.product_id,pv.size,pv.color
      INTO v_unit_price,v_product_id,v_size,v_color
    FROM public.sale_items si
    JOIN public.product_variants pv ON pv.id=si.product_variant_id
    WHERE si.sale_id=p_original_sale_id
      AND si.product_variant_id=v_item.variant_id
    ORDER BY si.created_at
    LIMIT 1;

    INSERT INTO public.return_items(
      return_id,product_id,product_variant_id,product_name,size,color,
      unit_price,quantity,reason
    )
    SELECT v_return_id,v_product_id,v_item.variant_id,p.name,pv.size,pv.color,
      v_unit_price,v_item.quantity,coalesce(v_item.reason,'Devolução')
    FROM public.product_variants pv
    JOIN public.products p ON p.id=pv.product_id
    WHERE pv.id=v_item.variant_id;

    UPDATE public.store_inventory
    SET quantity=quantity+v_item.quantity
    WHERE store_id=p_store_id AND product_variant_id=v_item.variant_id;

    INSERT INTO public.inventory_movements(
      store_id,product_variant_id,type,quantity,quantity_before,
      quantity_after,reference_type,reference_id,user_id,reason,notes
    )
    SELECT p_store_id,v_item.variant_id,'RETURN',v_item.quantity,
      si.quantity-v_item.quantity,si.quantity,'RETURN',v_return_id,v_user,
      coalesce(v_item.reason,'Devolução'),'Devolução processada'
    FROM public.store_inventory si
    WHERE si.store_id=p_store_id
      AND si.product_variant_id=v_item.variant_id;

    UPDATE public.product_variants pv
    SET stock_quantity=(
      SELECT coalesce(sum(quantity),0)
      FROM public.store_inventory
      WHERE product_variant_id=v_item.variant_id
    )
    WHERE id=v_item.variant_id;
  END LOOP;

  IF p_resolution_type IN ('credito_cliente','vale_troca') THEN
    INSERT INTO public.customer_credit_movements(
      store_id,customer_id,type,amount,description,reference_type,reference_id
    )
    VALUES(
      p_store_id,v_customer_id,'CREDIT',round(v_total,2),
      CASE WHEN p_resolution_type='vale_troca'
           THEN 'Vale-troca gerado pela devolução '
           ELSE 'Crédito gerado pela devolução ' END||v_return_number,
      'RETURN',v_return_id
    );

    INSERT INTO public.financial_transactions(
      store_id,type,category,description,amount,status,reference_type,reference_id,paid_at
    )
    VALUES(
      p_store_id,'EXPENSE','Créditos de devolução',
      'Crédito/vale emitido na devolução '||v_return_number,
      round(v_total,2),'PAID','RETURN',v_return_id,now()
    );
  ELSE
    INSERT INTO public.financial_transactions(
      store_id,type,category,description,amount,status,reference_type,reference_id,paid_at
    )
    VALUES(
      p_store_id,'EXPENSE','Estornos',
      'Estorno em dinheiro da devolução '||v_return_number,
      round(v_total,2),'PAID','RETURN',v_return_id,now()
    );
  END IF;

  RETURN jsonb_build_object(
    'success',true,'return_id',v_return_id,
    'return_number',v_return_number,'total',round(v_total,2)
  );
END;
$$;

-- 7) Hardening physical-inventory RLS and immutable ownership/store fields.
DROP POLICY IF EXISTS "Physical inventories update by store managers" ON public.physical_inventories;
CREATE POLICY "Physical inventories update by store managers"
ON public.physical_inventories
FOR UPDATE TO authenticated
USING (
  store_id IS NOT NULL
  AND status='OPEN'
  AND public.get_user_store_role(store_id) IN ('ADMIN','MANAGER')
)
WITH CHECK (
  store_id IS NOT NULL
  AND status='OPEN'
  AND public.get_user_store_role(store_id) IN ('ADMIN','MANAGER')
);

CREATE OR REPLACE FUNCTION public.prevent_physical_inventory_identity_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
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

-- 8) Explicitly preserve the current OPEN -> APPROVED state handled only by the RPC.
CREATE OR REPLACE FUNCTION public.approve_physical_inventory(p_inventory_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_actor uuid:=auth.uid();
  v_profile_active boolean:=false;
  v_store_id uuid;
  v_store_active boolean:=false;
  v_role text;
  v_status text;
  v_item_count integer:=0;
  v_incomplete_count integer:=0;
  v_item record;
  v_before integer;
  v_divergence integer;
  v_after integer;
BEGIN
  IF v_actor IS NULL OR p_user_id IS NULL OR p_user_id<>v_actor THEN
    RAISE EXCEPTION 'Usuário de aprovação inválido.';
  END IF;

  SELECT p.is_active INTO v_profile_active FROM public.profiles p WHERE p.id=v_actor;
  IF COALESCE(v_profile_active,false)=false THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;

  IF p_inventory_id IS NULL THEN
    RAISE EXCEPTION 'Inventário é obrigatório.';
  END IF;

  SELECT pi.status,pi.store_id
    INTO v_status,v_store_id
  FROM public.physical_inventories pi
  WHERE pi.id=p_inventory_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventário não encontrado.';
  END IF;

  SELECT s.is_active INTO v_store_active FROM public.stores s WHERE s.id=v_store_id;
  IF COALESCE(v_store_active,false)=false THEN
    RAISE EXCEPTION 'Loja inválida ou inativa.';
  END IF;

  v_role:=public.get_user_store_role(v_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER') THEN
    RAISE EXCEPTION 'Permissão negada para aprovar inventário.';
  END IF;

  IF v_status='APPROVED' THEN
    RETURN true;
  END IF;

  IF v_status<>'OPEN' THEN
    RAISE EXCEPTION 'Apenas inventários OPEN podem ser aprovados.';
  END IF;

  SELECT count(*),
         count(*) FILTER (
           WHERE product_variant_id IS NULL
              OR expected_quantity < 0
              OR counted_quantity < 0
              OR counted_quantity IS NULL
         )
    INTO v_item_count,v_incomplete_count
  FROM public.physical_inventory_items
  WHERE inventory_id=p_inventory_id;

  IF v_item_count=0 THEN
    RAISE EXCEPTION 'Inventário sem itens não pode ser aprovado.';
  END IF;

  IF v_incomplete_count>0 THEN
    RAISE EXCEPTION 'Inventário contém itens incompletos ou inválidos.';
  END IF;

  FOR v_item IN
    SELECT product_variant_id,expected_quantity,counted_quantity,reason
    FROM public.physical_inventory_items
    WHERE inventory_id=p_inventory_id
    ORDER BY product_variant_id
    FOR UPDATE
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.product_variants pv
      JOIN public.products p ON p.id=pv.product_id
      WHERE pv.id=v_item.product_variant_id
        AND pv.is_active=true
        AND p.is_active=true
    ) THEN
      RAISE EXCEPTION 'Variação inválida no inventário.';
    END IF;

    SELECT quantity INTO v_before
    FROM public.store_inventory
    WHERE store_id=v_store_id AND product_variant_id=v_item.product_variant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.store_inventory(
        store_id,product_variant_id,quantity,minimum_stock
      ) VALUES(v_store_id,v_item.product_variant_id,0,0);
      v_before:=0;
    END IF;

    v_divergence:=v_item.counted_quantity-v_item.expected_quantity;
    v_after:=v_item.counted_quantity;

    IF v_divergence<>0 THEN
      UPDATE public.store_inventory
      SET quantity=v_after
      WHERE store_id=v_store_id AND product_variant_id=v_item.product_variant_id;

      INSERT INTO public.inventory_movements(
        store_id,product_variant_id,type,quantity,quantity_before,
        quantity_after,reference_type,reference_id,user_id,reason,notes
      )
      VALUES(
        v_store_id,v_item.product_variant_id,'ADJUSTMENT',v_divergence,
        v_before,v_after,'INVENTORY',p_inventory_id,v_actor,
        coalesce(v_item.reason,'Ajuste de inventário físico'),
        'Ajuste de inventário físico'
      );
    END IF;

    UPDATE public.product_variants pv
    SET stock_quantity=(
      SELECT coalesce(sum(si.quantity),0)
      FROM public.store_inventory si
      WHERE si.product_variant_id=pv.id
    )
    WHERE pv.id=v_item.product_variant_id;
  END LOOP;

  UPDATE public.physical_inventories
  SET status='APPROVED',approved_by=v_actor,updated_at=now()
  WHERE id=p_inventory_id;

  RETURN true;
END;
$$;

-- 9) Fix direct report/helper auth checks without changing signatures.
CREATE OR REPLACE FUNCTION public.report_stock_status(p_store_id uuid)
RETURNS TABLE(product_id uuid, product_name text, variant_id uuid, variant_sku text, stock_quantity integer, reserved_quantity integer, minimum_stock integer, status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticação obrigatória.'; END IF;
  IF public.current_user_role() IS NULL THEN RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.'; END IF;
  IF p_store_id IS NULL OR NOT public.has_store_access(p_store_id) THEN
    RAISE EXCEPTION 'Acesso negado à loja.';
  END IF;
  RETURN QUERY
  SELECT p.id,p.name,pv.id,pv.sku,si.quantity,pv.reserved_quantity,pv.minimum_stock,
         CASE WHEN si.quantity=0 THEN 'OUT_OF_STOCK'
              WHEN si.quantity<=pv.minimum_stock THEN 'LOW_STOCK'
              ELSE 'OK' END
  FROM public.products p
  JOIN public.product_variants pv ON pv.product_id=p.id
  JOIN public.store_inventory si
    ON si.product_variant_id=pv.id AND si.store_id=p_store_id
  WHERE p.is_active=true AND pv.is_active=true
  ORDER BY CASE WHEN si.quantity=0 THEN 1
                WHEN si.quantity<=pv.minimum_stock THEN 2
                ELSE 3 END,
           si.quantity;
END;
$$;

CREATE OR REPLACE FUNCTION public.report_top_selling_products(p_limit integer, p_store_id uuid)
RETURNS TABLE(product_id uuid, product_name text, total_quantity_sold bigint, total_revenue numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticação obrigatória.'; END IF;
  IF public.current_user_role() IS NULL THEN RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.'; END IF;
  IF p_store_id IS NULL OR NOT public.has_store_access(p_store_id) THEN
    RAISE EXCEPTION 'Acesso negado à loja.';
  END IF;
  IF COALESCE(p_limit,0) < 1 OR COALESCE(p_limit,0) > 100 THEN
    RAISE EXCEPTION 'Limite inválido.';
  END IF;
  RETURN QUERY
  SELECT p.id,p.name,sum(si.quantity)::bigint,sum(si.total)::numeric
  FROM public.sale_items si
  JOIN public.sales s ON s.id=si.sale_id
  JOIN public.products p ON p.id=si.product_id
  WHERE s.store_id=p_store_id AND s.status='COMPLETED'
  GROUP BY p.id,p.name
  ORDER BY total_quantity_sold DESC
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.report_inventory_movements_summary(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_store_id uuid
)
RETURNS TABLE(movement_type text, total_quantity bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
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
  SELECT im.type,sum(im.quantity)::bigint
  FROM public.inventory_movements im
  WHERE im.store_id=p_store_id
    AND im.created_at>=p_start_date
    AND im.created_at<=p_end_date
  GROUP BY im.type
  ORDER BY total_quantity DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_profitability_by_product(
  p_store_id uuid,
  start_date date,
  end_date date
)
RETURNS TABLE(product_id uuid, product_name text, category_id uuid, total_quantity bigint, total_revenue numeric, total_cost numeric, margin_value numeric, margin_percentage numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticação obrigatória.'; END IF;
  IF public.current_user_role() IS NULL THEN RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.'; END IF;
  IF p_store_id IS NULL OR NOT public.has_store_access(p_store_id) THEN
    RAISE EXCEPTION 'Acesso negado à loja.';
  END IF;
  RETURN QUERY
  SELECT p.id,p.name,p.category_id,sum(si.quantity)::bigint,sum(si.total),sum(si.quantity*p.cost_price),
         sum(si.total)-sum(si.quantity*p.cost_price),
         CASE WHEN sum(si.total)>0
              THEN ((sum(si.total)-sum(si.quantity*p.cost_price))/sum(si.total))*100
              ELSE 0 END
  FROM public.sale_items si
  JOIN public.sales s ON s.id=si.sale_id
  JOIN public.products p ON p.id=si.product_id
  WHERE s.store_id=p_store_id
    AND s.status='COMPLETED'
  AND (p_start_date IS NULL OR s.completed_at::date>=p_start_date)
    AND (p_end_date IS NULL OR s.completed_at::date<=p_end_date)
  GROUP BY p.id,p.name,p.category_id
  ORDER BY margin_value DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_profitability_by_category(
  p_store_id uuid,
  start_date date,
  end_date date
)
RETURNS TABLE(category_id uuid, category_name text, total_quantity bigint, total_revenue numeric, total_cost numeric, margin_value numeric, margin_percentage numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
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
  SELECT c.id,coalesce(c.name,'Sem Categoria'),sum(si.quantity)::bigint,sum(si.total),sum(si.quantity*p.cost_price),
         sum(si.total)-sum(si.quantity*p.cost_price),
         CASE WHEN sum(si.total)>0
              THEN ((sum(si.total)-sum(si.quantity*p.cost_price))/sum(si.total))*100
              ELSE 0 END
  FROM public.sale_items si
  JOIN public.sales s ON s.id=si.sale_id
  JOIN public.products p ON p.id=si.product_id
  LEFT JOIN public.categories c ON c.id=p.category_id
  WHERE s.store_id=p_store_id
    AND s.status='COMPLETED'
  AND (p_start_date IS NULL OR s.completed_at::date>=p_start_date)
    AND (p_end_date IS NULL OR s.completed_at::date<=p_end_date)
  GROUP BY c.id,c.name
  ORDER BY margin_value DESC;
END;
$$;

-- Ensure all modified SECDEF functions have a fixed search_path.
ALTER FUNCTION public.complete_sale(uuid,uuid,text,text,jsonb,text,integer,numeric,numeric,text) SET search_path=public;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'create_mp_pix_sale'
      AND pg_get_function_identity_arguments(p.oid) = 'uuid, text, text, jsonb, numeric, numeric, uuid, text'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric,uuid,text) SET search_path=public';
  END IF;
END $$;
ALTER FUNCTION public.process_return(uuid,uuid,uuid,text,text,jsonb,text,text) SET search_path=public;
ALTER FUNCTION public.register_stock_entry(uuid,integer,numeric,text,uuid,text,text) SET search_path=public;
ALTER FUNCTION public.cancel_sale(uuid) SET search_path=public;
ALTER FUNCTION public.manage_product(uuid,text,text,text,numeric,numeric,jsonb) SET search_path='public','extensions';
ALTER FUNCTION public.approve_physical_inventory(uuid,uuid) SET search_path=public;
ALTER FUNCTION public.admin_set_user_role(uuid,text) SET search_path=public;

COMMIT;
