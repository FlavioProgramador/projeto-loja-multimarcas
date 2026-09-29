-- CoreSys security and integrity hardening
-- Project: ndrjynlbwrugakjqtzwy
-- Non-destructive: no business data is deleted.

BEGIN;

-- 1) Returns: aggregate duplicate variants before validating availability.
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
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_profile_active boolean;
  v_role text;
  v_sale record;
  v_return_id uuid;
  v_return_number text;
  v_item record;
  v_sold_qty bigint;
  v_returned_qty bigint;
  v_available_qty bigint;
  v_stock_before integer;
  v_total numeric(12,2) := 0;
  v_customer_id uuid := p_customer_id;
  v_unit_price numeric(12,2);
  v_product_id uuid;
  v_size text;
  v_color text;
BEGIN
  SELECT is_active INTO v_profile_active
  FROM public.profiles
  WHERE id=v_user;

  IF v_user IS NULL OR COALESCE(v_profile_active,false)=false THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;

  IF p_store_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.stores WHERE id=p_store_id AND is_active=true
  ) THEN
    RAISE EXCEPTION 'Loja inválida ou inativa.';
  END IF;

  v_role := public.get_user_store_role(p_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER','CASHIER') THEN
    RAISE EXCEPTION 'Permissão negada.';
  END IF;

  IF p_original_sale_id IS NULL THEN
    RAISE EXCEPTION 'A devolução deve estar vinculada a uma venda original.';
  END IF;

  IF jsonb_typeof(COALESCE(p_items,'[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_items,'[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Nenhum item informado para devolução.';
  END IF;

  IF p_resolution_type NOT IN ('credito_cliente','vale_troca','estorno_dinheiro') THEN
    RAISE EXCEPTION 'Forma de resolução inválida.';
  END IF;

  SELECT * INTO v_sale
  FROM public.sales
  WHERE id=p_original_sale_id AND store_id=p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda original não encontrada nesta loja.';
  END IF;

  IF v_sale.status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'Somente vendas concluídas podem ter devolução.';
  END IF;

  IF v_sale.customer_id IS NOT NULL
     AND v_customer_id IS NOT NULL
     AND v_sale.customer_id IS DISTINCT FROM v_customer_id THEN
    RAISE EXCEPTION 'Cliente informado não corresponde à venda original.';
  END IF;

  IF v_customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers c WHERE c.id=v_customer_id AND c.is_active=true
  ) THEN
    RAISE EXCEPTION 'Cliente inválido ou inativo.';
  END IF;

  IF v_customer_id IS NULL THEN
    v_customer_id := v_sale.customer_id;
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

  -- Aggregate by variation before any quantity comparison. A malicious/repeated
  -- payload therefore cannot validate each duplicate row against the same quota.
  FOR v_item IN
    SELECT x.variant_id,
           sum(x.quantity::bigint) AS quantity,
           max(x.reason) AS reason
    FROM jsonb_to_recordset(p_items) AS x(
      variant_id uuid,
      quantity integer,
      product_name text,
      size text,
      color text,
      reason text
    )
    GROUP BY x.variant_id
    ORDER BY x.variant_id
  LOOP
    IF v_item.variant_id IS NULL OR v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'Item de devolução inválido.';
    END IF;

    IF v_item.quantity > 2147483647 THEN
      RAISE EXCEPTION 'Quantidade de devolução excede o limite permitido.';
    END IF;

    SELECT COALESCE(sum(si.quantity),0)::bigint INTO v_sold_qty
    FROM public.sale_items si
    WHERE si.sale_id=p_original_sale_id
      AND si.product_variant_id=v_item.variant_id;

    SELECT COALESCE(sum(ri.quantity),0)::bigint INTO v_returned_qty
    FROM public.return_items ri
    JOIN public.returns r ON r.id=ri.return_id
    WHERE r.original_sale_id=p_original_sale_id
      AND r.status='CONCLUIDO'
      AND ri.product_variant_id=v_item.variant_id;

    v_available_qty := v_sold_qty - v_returned_qty;

    IF v_sold_qty = 0 THEN
      RAISE EXCEPTION 'A variação informada não pertence à venda original.';
    END IF;

    IF v_available_qty < 0 OR v_item.quantity > v_available_qty THEN
      RAISE EXCEPTION 'Quantidade devolvida excede a quantidade ainda disponível para devolução.';
    END IF;

    SELECT si.unit_price, si.product_id, pv.size, pv.color
      INTO v_unit_price, v_product_id, v_size, v_color
    FROM public.sale_items si
    JOIN public.product_variants pv ON pv.id=si.product_variant_id
    WHERE si.sale_id=p_original_sale_id
      AND si.product_variant_id=v_item.variant_id
    ORDER BY si.created_at
    LIMIT 1;

    v_total := v_total + (v_unit_price * v_item.quantity);

    SELECT quantity INTO v_stock_before
    FROM public.store_inventory
    WHERE store_id=p_store_id
      AND product_variant_id=v_item.variant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.store_inventory(store_id,product_variant_id,quantity,minimum_stock)
      VALUES(p_store_id,v_item.variant_id,0,0);
      v_stock_before := 0;
    END IF;
  END LOOP;

  v_return_number := 'DEV-' || nextval('sale_number_seq')::text;

  INSERT INTO public.returns(
    return_number,original_sale_id,customer_id,customer_name,customer_cpf,
    resolution_type,status,total_amount,observations,expires_at,created_by,store_id
  )
  VALUES(
    v_return_number,p_original_sale_id,v_customer_id,
    COALESCE(NULLIF(trim(p_customer_name),''),v_sale.customer_name,'Consumidor Final'),
    COALESCE(NULLIF(trim(p_customer_cpf),''),v_sale.customer_cpf),
    p_resolution_type,'CONCLUIDO',round(v_total,2),p_observations,
    current_date+interval '30 days',v_user,p_store_id
  )
  RETURNING id INTO v_return_id;

  FOR v_item IN
    SELECT x.variant_id, sum(x.quantity::bigint) AS quantity, max(x.reason) AS reason
    FROM jsonb_to_recordset(p_items) AS x(
      variant_id uuid,
      quantity integer,
      product_name text,
      size text,
      color text,
      reason text
    )
    GROUP BY x.variant_id
    ORDER BY x.variant_id
  LOOP
    SELECT si.unit_price, si.product_id, pv.size, pv.color
      INTO v_unit_price, v_product_id, v_size, v_color
    FROM public.sale_items si
    JOIN public.product_variants pv ON pv.id=si.product_variant_id
    WHERE si.sale_id=p_original_sale_id
      AND si.product_variant_id=v_item.variant_id
    ORDER BY si.created_at
    LIMIT 1;

    IF v_unit_price IS NULL OR v_product_id IS NULL THEN
      RAISE EXCEPTION 'Não foi possível resolver a variação da venda original.';
    END IF;

    INSERT INTO public.return_items(
      return_id,product_id,product_variant_id,product_name,size,color,
      unit_price,quantity,reason
    )
    SELECT v_return_id,v_product_id,v_item.variant_id,p.name,pv.size,pv.color,
      v_unit_price,v_item.quantity,COALESCE(v_item.reason,'Devolução')
    FROM public.product_variants pv
    JOIN public.products p ON p.id=pv.product_id
    WHERE pv.id=v_item.variant_id;

    UPDATE public.store_inventory
    SET quantity=quantity+v_item.quantity
    WHERE store_id=p_store_id
      AND product_variant_id=v_item.variant_id;

    INSERT INTO public.inventory_movements(
      store_id,product_variant_id,type,quantity,quantity_before,
      quantity_after,reference_type,reference_id,user_id,reason,notes
    )
    SELECT p_store_id,v_item.variant_id,'RETURN',v_item.quantity,
      si.quantity-v_item.quantity,si.quantity,'RETURN',v_return_id,v_user,
      COALESCE(v_item.reason,'Devolução'),'Devolução processada'
    FROM public.store_inventory si
    WHERE si.store_id=p_store_id
      AND si.product_variant_id=v_item.variant_id;

    UPDATE public.product_variants pv
    SET stock_quantity=(
      SELECT COALESCE(sum(si.quantity),0)
      FROM public.store_inventory si
      WHERE si.product_variant_id=pv.id
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
    'success',true,
    'return_id',v_return_id,
    'return_number',v_return_number,
    'total',round(v_total,2)
  );
END;
$$;

-- 2) Storage: retain public URLs, but limit object size/MIME and prevent public listing.
UPDATE storage.buckets
SET file_size_limit=5242880,
    allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp']::text[]
WHERE id='product-images';

UPDATE storage.buckets
SET file_size_limit=2097152,
    allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp','image/svg+xml']::text[]
WHERE id='brand-logos';

DROP POLICY IF EXISTS "Public Read Product Images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Upload Product Images" ON storage.objects;
DROP POLICY IF EXISTS "Public Read Brand Logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Upload Brand Logos" ON storage.objects;

CREATE POLICY "Public Read Product Images"
ON storage.objects
FOR SELECT
TO public
USING (
  bucket_id='product-images'
  AND storage.allow_any_operation(ARRAY['object.get','object.upload'])
);

CREATE POLICY "Authenticated Upload Product Images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id='product-images'
  AND (storage.foldername(name))[1]='products'
  AND lower(storage.extension(name)) IN ('jpg','jpeg','png','webp')
);

CREATE POLICY "Public Read Brand Logos"
ON storage.objects
FOR SELECT
TO public
USING (
  bucket_id='brand-logos'
  AND storage.allow_any_operation(ARRAY['object.get','object.upload'])
);

CREATE POLICY "Authenticated Upload Brand Logos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id='brand-logos'
  AND (storage.foldername(name))[1]='logos'
  AND lower(storage.extension(name)) IN ('jpg','jpeg','png','webp','svg')
);

-- Keep direct table access blocked for sale_idempotency.
REVOKE ALL ON TABLE public.sale_idempotency FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "sale_idempotency deny all" ON public.sale_idempotency;
CREATE POLICY "sale_idempotency deny all"
ON public.sale_idempotency
FOR ALL TO authenticated
USING (false)
WITH CHECK (false);

COMMIT;
