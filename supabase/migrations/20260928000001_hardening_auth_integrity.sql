-- CoreSys security hardening migration
-- Target project: ndrjynlbwrugakjqtzwy
-- This file is intentionally prepared after live-schema inspection.

-- 1) Remove API access to the legacy sale RPC. Keep the function for now;
-- dependency removal can be done later after confirming no remaining callers.
REVOKE EXECUTE ON FUNCTION public.complete_sale(uuid,text,text,jsonb,text,integer,numeric,numeric,text) FROM PUBLIC, anon, authenticated;

-- 2) Fail-closed authorization helpers.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.role
  FROM public.profiles p
  WHERE p.id = (select auth.uid())
    AND p.is_active = true
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.get_user_store_role(p_store_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT usa.role
  FROM public.user_store_access usa
  JOIN public.profiles p ON p.id = usa.user_id
  JOIN public.stores s ON s.id = usa.store_id
  WHERE usa.user_id = (select auth.uid())
    AND usa.store_id = p_store_id
    AND usa.is_active = true
    AND p.is_active = true
    AND s.is_active = true
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.has_store_access(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_store_access usa
    JOIN public.profiles p ON p.id = usa.user_id
    JOIN public.stores s ON s.id = usa.store_id
    WHERE usa.user_id = (select auth.uid())
      AND usa.store_id = p_store_id
      AND usa.is_active = true
      AND p.is_active = true
      AND s.is_active = true
  )
$$;

-- 3) Harden admin role mutation.
CREATE OR REPLACE FUNCTION public.admin_set_user_role(p_target_user_id uuid, p_new_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_target_id uuid;
BEGIN
  v_caller_role := public.current_user_role();
  IF v_caller_role IS NULL OR v_caller_role <> 'ADMIN' THEN
    RAISE EXCEPTION 'Permissão negada: apenas ADMIN pode alterar papéis de usuário.';
  END IF;

  IF (select auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;

  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário alvo é obrigatório.';
  END IF;

  IF p_new_role IS NULL OR p_new_role NOT IN ('ADMIN','MANAGER','CASHIER','EMPLOYEE') THEN
    RAISE EXCEPTION 'Role inválida: %', p_new_role;
  END IF;

  IF p_target_user_id = (select auth.uid()) THEN
    RAISE EXCEPTION 'Administrador não pode alterar o próprio papel.';
  END IF;

  UPDATE public.profiles
     SET role = p_new_role,
         updated_at = now()
   WHERE id = p_target_user_id
     AND is_active = true
   RETURNING id INTO v_target_id;

  IF v_target_id IS NULL THEN
    RAISE EXCEPTION 'Usuário alvo não encontrado ou inativo.';
  END IF;

  RETURN jsonb_build_object('success',true,'user_id',v_target_id,'new_role',p_new_role);
END;
$$;

-- 4) Harden modern complete_sale: mandatory idempotency, fail-closed auth,
-- store-scoped inventory, DB price resolution, atomic transaction.
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
  v_user_id uuid := (select auth.uid());
  v_profile_active boolean;
  v_store_active boolean;
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
  SELECT is_active INTO v_profile_active
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_user_id IS NULL OR COALESCE(v_profile_active,false) = false THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;

  IF p_store_id IS NULL THEN
    RAISE EXCEPTION 'Loja obrigatória.';
  END IF;

  SELECT is_active INTO v_store_active
  FROM public.stores
  WHERE id = p_store_id;

  IF COALESCE(v_store_active,false) = false THEN
    RAISE EXCEPTION 'Loja inválida ou inativa.';
  END IF;

  v_role := public.get_user_store_role(p_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER','CASHIER') THEN
    RAISE EXCEPTION 'Permissão negada para vender nesta loja.';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Chave de idempotência obrigatória.';
  END IF;

  IF jsonb_typeof(COALESCE(p_items,'[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(p_items,'[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Carrinho vazio.';
  END IF;

  IF COALESCE(p_installments,1) < 1 OR COALESCE(p_installments,1) > 24 THEN
    RAISE EXCEPTION 'Número de parcelas inválido.';
  END IF;

  IF COALESCE(p_discount_value,0) < 0 OR COALESCE(p_discount_percent,0) < 0 OR COALESCE(p_discount_percent,0) > 100 THEN
    RAISE EXCEPTION 'Desconto inválido.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key,0));

  SELECT sale_id INTO v_sale_id
  FROM public.sale_idempotency
  WHERE idempotency_key = btrim(p_idempotency_key)
  FOR SHARE;

  IF v_sale_id IS NOT NULL THEN
    RETURN (
      SELECT jsonb_build_object(
        'success',true,
        'sale_id',s.id,
        'sale_number',s.sale_number,
        'total',s.total,
        'message','Venda já processada anteriormente (idempotência).'
      )
      FROM public.sales s
      WHERE s.id = v_sale_id
    );
  END IF;

  IF v_customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers c WHERE c.id=v_customer_id AND c.is_active=true
  ) THEN
    RAISE EXCEPTION 'Cliente inválido ou inativo.';
  END IF;

  IF v_customer_id IS NULL
     AND NULLIF(trim(p_customer_cpf),'') IS NOT NULL
     AND trim(p_customer_cpf) <> 'Não informado'
  THEN
    SELECT id INTO v_customer_id
    FROM public.customers
    WHERE cpf=trim(p_customer_cpf) AND is_active=true
    LIMIT 1;

    IF v_customer_id IS NULL AND NULLIF(trim(p_customer_name),'') IS NOT NULL
       AND trim(p_customer_name) <> 'Cliente não identificado'
    THEN
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

  -- Lock store rows in deterministic order to prevent overselling.
  FOR v_item IN
    SELECT
      x.variant_id,
      sum(x.quantity)::integer AS quantity,
      (array_agg(x.product_name ORDER BY x.product_name NULLS LAST))[1] AS product_name,
      (array_agg(x.variant_description ORDER BY x.variant_description NULLS LAST))[1] AS variant_description
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

    v_subtotal := v_subtotal + round(v_inv.sale_price * v_item.quantity,2);
  END LOOP;

  v_discount := least(
    v_subtotal,
    greatest(0,coalesce(p_discount_value,0))
      + (v_subtotal * greatest(0,coalesce(p_discount_percent,0)) / 100)
  );
  v_total := round(greatest(0,v_subtotal-v_discount),2);
  v_sale_number := 'PDV #' || nextval('sale_number_seq')::text;

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
  VALUES(btrim(p_idempotency_key),v_sale_id);

  FOR v_item IN
    SELECT *
    FROM jsonb_to_recordset(p_items) AS x(
      variant_id uuid,
      quantity integer,
      unit_price numeric,
      product_id uuid,
      product_name text,
      variant_description text
    )
    ORDER BY variant_id
  LOOP
    INSERT INTO public.sale_items(
      sale_id,product_id,product_variant_id,product_name,variant_description,
      quantity,unit_price,total
    )
    SELECT
      v_sale_id,pv.product_id,v_item.variant_id,
      coalesce(nullif(v_item.product_name,''),p.name),
      coalesce(nullif(v_item.variant_description,''),coalesce(pv.size,'Único') || ' / ' || coalesce(pv.color,'Padrão')),
      v_item.quantity,p.sale_price,round(p.sale_price*v_item.quantity,2)
    FROM public.product_variants pv
    JOIN public.products p ON p.id=pv.product_id
    WHERE pv.id=v_item.variant_id
      AND pv.is_active=true
      AND p.is_active=true;

    UPDATE public.store_inventory
       SET quantity=quantity-v_item.quantity
     WHERE store_id=p_store_id
       AND product_variant_id=v_item.variant_id;

    INSERT INTO public.inventory_movements(
      store_id,product_variant_id,type,quantity,quantity_before,quantity_after,
      reference_type,reference_id,user_id,notes,reason
    )
    SELECT
      p_store_id,v_item.variant_id,'SALE',v_item.quantity,
      si.quantity+v_item.quantity,si.quantity,
      'SALE',v_sale_id,v_user_id,
      'Venda '||v_sale_number,'Venda concluída'
    FROM public.store_inventory si
    WHERE si.store_id=p_store_id AND si.product_variant_id=v_item.variant_id;

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

REVOKE ALL ON FUNCTION public.complete_sale(uuid,uuid,text,text,jsonb,text,integer,numeric,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_sale(uuid,uuid,text,text,jsonb,text,integer,numeric,numeric,text) TO authenticated;

-- 5) Harden PIX creation.
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
  v_user_id uuid := (select auth.uid());
  v_profile_active boolean;
  v_store_active boolean;
  v_role text;
  v_sale_id uuid;
  v_sale_number text;
  v_subtotal numeric(12,2):=0;
  v_discount numeric(12,2):=0;
  v_total numeric(12,2):=0;
  v_customer_id uuid:=p_customer_id;
  v_item record;
  v_inv record;
BEGIN
  SELECT is_active INTO v_profile_active FROM public.profiles WHERE id=v_user_id;
  IF v_user_id IS NULL OR COALESCE(v_profile_active,false)=false THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;

  IF p_store_id IS NULL THEN RAISE EXCEPTION 'Loja obrigatória.'; END IF;

  SELECT is_active INTO v_store_active FROM public.stores WHERE id=p_store_id;
  IF COALESCE(v_store_active,false)=false THEN RAISE EXCEPTION 'Loja inválida ou inativa.'; END IF;

  v_role:=public.get_user_store_role(p_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER','CASHIER') THEN
    RAISE EXCEPTION 'Permissão negada para criar venda PIX nesta loja.';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key)='' THEN
    RAISE EXCEPTION 'Chave de idempotência obrigatória.';
  END IF;

  IF jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' OR jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 THEN
    RAISE EXCEPTION 'Carrinho vazio.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(btrim(p_idempotency_key),0));

  SELECT sale_id INTO v_sale_id FROM public.sale_idempotency
  WHERE idempotency_key=btrim(p_idempotency_key) FOR SHARE;
  IF v_sale_id IS NOT NULL THEN
    RETURN (SELECT jsonb_build_object('success',true,'sale_id',s.id,'sale_number',s.sale_number,'total',s.total,'message','Venda já processada anteriormente (idempotência).') FROM public.sales s WHERE s.id=v_sale_id);
  END IF;

  IF v_customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers c WHERE c.id=v_customer_id AND c.is_active=true
  ) THEN
    RAISE EXCEPTION 'Cliente inválido ou inativo.';
  END IF;

  IF v_customer_id IS NULL AND NULLIF(trim(p_customer_cpf),'') IS NOT NULL AND trim(p_customer_cpf)<>'Não informado' THEN
    SELECT id INTO v_customer_id FROM public.customers WHERE cpf=trim(p_customer_cpf) AND is_active=true LIMIT 1;
  END IF;

  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(p_items) AS x(
      variant_id uuid,quantity integer,unit_price numeric,product_id uuid,product_name text,variant_description text
    )
    ORDER BY variant_id
  LOOP
    IF v_item.variant_id IS NULL OR v_item.quantity IS NULL OR v_item.quantity<=0 THEN
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

    IF NOT FOUND THEN RAISE EXCEPTION 'Produto não está disponível nesta loja.'; END IF;
    IF v_inv.quantity < v_item.quantity THEN RAISE EXCEPTION 'Estoque insuficiente para o produto informado.'; END IF;
    v_subtotal := v_subtotal + round(v_inv.sale_price*v_item.quantity,2);
  END LOOP;

  v_discount:=least(
    v_subtotal,
    greatest(0,coalesce(p_discount_value,0))
      + (v_subtotal * least(100,greatest(0,coalesce(p_discount_percent,0))) / 100)
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
  VALUES(btrim(p_idempotency_key),v_sale_id);

  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(p_items) AS x(
      variant_id uuid,quantity integer,unit_price numeric,product_id uuid,product_name text,variant_description text
    )
    ORDER BY variant_id
  LOOP
    INSERT INTO public.sale_items(
      sale_id,product_id,product_variant_id,product_name,variant_description,quantity,unit_price,total
    )
    SELECT
      v_sale_id,pv.product_id,v_item.variant_id,
      coalesce(nullif(v_item.product_name,''),p.name),
      coalesce(nullif(v_item.variant_description,''),coalesce(pv.size,'Único') || ' / ' || coalesce(pv.color,'Padrão')),
      v_item.quantity,p.sale_price,round(p.sale_price*v_item.quantity,2)
    FROM public.product_variants pv
    JOIN public.products p ON p.id=pv.product_id
    WHERE pv.id=v_item.variant_id AND pv.is_active=true AND p.is_active=true;

    UPDATE public.store_inventory
       SET quantity=quantity-v_item.quantity
     WHERE store_id=p_store_id AND product_variant_id=v_item.variant_id;

    INSERT INTO public.inventory_movements(
      store_id,product_variant_id,type,quantity,quantity_before,quantity_after,
      reference_type,reference_id,user_id,notes,reason
    )
    SELECT p_store_id,v_item.variant_id,'SALE',v_item.quantity,
      si.quantity+v_item.quantity,si.quantity,'SALE',v_sale_id,v_user_id,
      'Reserva PIX '||v_sale_number,'Reserva de estoque PIX'
    FROM public.store_inventory si
    WHERE si.store_id=p_store_id AND si.product_variant_id=v_item.variant_id;

    UPDATE public.product_variants pv
       SET reserved_quantity=pv.reserved_quantity+v_item.quantity,
           stock_quantity=(SELECT coalesce(sum(si.quantity),0) FROM public.store_inventory si WHERE si.product_variant_id=pv.id)
     WHERE pv.id=v_item.variant_id;
  END LOOP;

  INSERT INTO public.payments(sale_id,method,amount,status,installments)
  VALUES(v_sale_id,'PIX',v_total,'PENDING',1);

  RETURN jsonb_build_object('success',true,'sale_id',v_sale_id,'sale_number',v_sale_number,'total',v_total);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric,uuid,text) TO authenticated;

-- 6) Harden cancellation.
CREATE OR REPLACE FUNCTION public.cancel_sale(p_sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := (select auth.uid());
  v_profile_active boolean;
  v_role text;
  v_sale record;
  v_item record;
  v_before integer;
BEGIN
  SELECT is_active INTO v_profile_active FROM public.profiles WHERE id=v_user;
  IF v_user IS NULL OR COALESCE(v_profile_active,false)=false THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id=p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'message','Venda não encontrada.'); END IF;

  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id=v_sale.store_id AND is_active=true) THEN
    RAISE EXCEPTION 'Loja da venda inválida ou inativa.';
  END IF;

  v_role:=public.get_user_store_role(v_sale.store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER','CASHIER') THEN
    RAISE EXCEPTION 'Permissão negada.';
  END IF;

  IF v_sale.status='CANCELLED' THEN
    RETURN jsonb_build_object('success',true,'message','Venda já cancelada (idempotente).');
  END IF;
  IF v_sale.status<>'COMPLETED' THEN
    RAISE EXCEPTION 'Somente vendas concluídas podem ser canceladas.';
  END IF;

  FOR v_item IN
    SELECT product_variant_id,quantity FROM public.sale_items
    WHERE sale_id=p_sale_id ORDER BY product_variant_id
  LOOP
    SELECT quantity INTO v_before
    FROM public.store_inventory
    WHERE store_id=v_sale.store_id AND product_variant_id=v_item.product_variant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.store_inventory(store_id,product_variant_id,quantity,minimum_stock)
      VALUES(v_sale.store_id,v_item.product_variant_id,0,0);
      v_before:=0;
    END IF;

    UPDATE public.store_inventory
    SET quantity=quantity+v_item.quantity
    WHERE store_id=v_sale.store_id AND product_variant_id=v_item.product_variant_id;

    INSERT INTO public.inventory_movements(
      store_id,product_variant_id,type,quantity,quantity_before,quantity_after,
      reference_type,reference_id,user_id,notes,reason
    )
    VALUES(
      v_sale.store_id,v_item.product_variant_id,'CANCELLATION',
      v_item.quantity,v_before,v_before+v_item.quantity,
      'SALE',p_sale_id,v_user,'Cancelamento da venda','Cancelamento'
    );

    UPDATE public.product_variants
    SET stock_quantity=(SELECT coalesce(sum(si.quantity),0) FROM public.store_inventory si WHERE si.product_variant_id=id)
    WHERE id=v_item.product_variant_id;
  END LOOP;

  UPDATE public.sales SET status='CANCELLED',completed_at=NULL WHERE id=p_sale_id;
  UPDATE public.payments SET status='CANCELLED' WHERE sale_id=p_sale_id AND status<>'CANCELLED';

  IF NOT EXISTS (
    SELECT 1 FROM public.financial_transactions
    WHERE reference_type='SALE' AND reference_id=p_sale_id AND type='EXPENSE'
  ) THEN
    INSERT INTO public.financial_transactions(
      store_id,type,category,description,amount,status,reference_type,reference_id,paid_at
    )
    VALUES(v_sale.store_id,'EXPENSE','Estornos','Estorno de venda '||v_sale.sale_number,
           v_sale.total,'PAID','SALE',p_sale_id,now());
  END IF;

  RETURN jsonb_build_object('success',true,'message','Venda cancelada e estoque restaurado.');
END;
$$;

-- 7) Harden stock entry.
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
  v_user uuid := (select auth.uid());
  v_profile_active boolean;
  v_role text;
  v_before integer;
  v_after integer;
  v_total numeric(12,2);
BEGIN
  SELECT is_active INTO v_profile_active FROM public.profiles WHERE id=v_user;
  IF v_user IS NULL OR COALESCE(v_profile_active,false)=false THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;

  IF p_store_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.stores WHERE id=p_store_id AND is_active=true) THEN
    RAISE EXCEPTION 'Loja inválida ou inativa.';
  END IF;

  v_role:=public.get_user_store_role(p_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER') THEN
    RAISE EXCEPTION 'Permissão negada para estoque.';
  END IF;

  IF p_variant_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.product_variants pv
    JOIN public.products p ON p.id=pv.product_id
    WHERE pv.id=p_variant_id AND pv.is_active=true AND p.is_active=true
  ) THEN
    RAISE EXCEPTION 'Variação não encontrada ou inativa.';
  END IF;

  IF p_quantity IS NULL OR p_quantity<=0 THEN RAISE EXCEPTION 'Quantidade inválida.'; END IF;
  IF p_unit_cost IS NULL OR p_unit_cost<0 THEN RAISE EXCEPTION 'Custo inválido.'; END IF;

  SELECT quantity INTO v_before
  FROM public.store_inventory
  WHERE store_id=p_store_id AND product_variant_id=p_variant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.store_inventory(store_id,product_variant_id,quantity,minimum_stock)
    VALUES(p_store_id,p_variant_id,0,0);
    v_before:=0;
  END IF;

  v_after:=v_before+p_quantity;

  UPDATE public.store_inventory
  SET quantity=v_after
  WHERE store_id=p_store_id AND product_variant_id=p_variant_id;

  UPDATE public.product_variants pv
  SET stock_quantity=(SELECT coalesce(sum(si.quantity),0) FROM public.store_inventory si WHERE si.product_variant_id=pv.id)
  WHERE pv.id=p_variant_id;

  INSERT INTO public.inventory_movements(
    store_id,product_variant_id,type,quantity,quantity_before,quantity_after,
    reference_type,user_id,notes,reason
  )
  VALUES(
    p_store_id,p_variant_id,'ENTRY',p_quantity,v_before,v_after,
    'STOCK_ENTRY',v_user,'Entrada de estoque: '||coalesce(p_product_name,'Produto'),
    coalesce(p_reason,'Compra de fornecedor')
  );

  v_total:=round(p_quantity*p_unit_cost,2);
  IF v_total>0 AND upper(coalesce(p_type,'PURCHASE')) IN ('PURCHASE','ENTRY') THEN
    INSERT INTO public.financial_transactions(
      store_id,type,category,description,amount,status,reference_type,paid_at
    )
    VALUES(
      p_store_id,'EXPENSE','Estoque / Compras',
      'Entrada de estoque: '||coalesce(p_product_name,'Produto'),
      v_total,'PAID','STOCK_ENTRY',now()
    );
  END IF;

  RETURN jsonb_build_object('success',true,'quantity',v_after);
END;
$$;

-- 8) Harden product management. Stock is no longer mutated here.
-- Existing UI must migrate initial quantities to register_stock_entry in a later
-- product-creation flow. This function sets newly-created variants to 0.
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
  v_user uuid := (select auth.uid());
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
  SELECT is_active INTO v_profile_active FROM public.profiles WHERE id=v_user;
  IF v_user IS NULL OR COALESCE(v_profile_active,false)=false THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;

  v_role:=public.current_user_role();
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER') THEN
    RAISE EXCEPTION 'Permissão negada.';
  END IF;

  IF p_name IS NULL OR btrim(p_name)='' THEN RAISE EXCEPTION 'Nome do produto é obrigatório.'; END IF;
  IF p_sale_price IS NOT NULL AND p_sale_price<0 THEN RAISE EXCEPTION 'Preço de venda inválido.'; END IF;
  IF p_cost_price IS NOT NULL AND p_cost_price<0 THEN RAISE EXCEPTION 'Preço de custo inválido.'; END IF;

  IF p_brand_name IS NOT NULL AND btrim(p_brand_name)<>'' THEN
    SELECT id INTO v_brand_id FROM public.brands WHERE name ILIKE btrim(p_brand_name) AND is_active=true LIMIT 1;
    IF v_brand_id IS NULL THEN
      INSERT INTO public.brands(name) VALUES(btrim(p_brand_name)) RETURNING id INTO v_brand_id;
    END IF;
  END IF;

  IF p_category_name IS NOT NULL AND btrim(p_category_name)<>'' THEN
    SELECT id INTO v_category_id FROM public.categories WHERE name ILIKE btrim(p_category_name) AND is_active=true LIMIT 1;
    IF v_category_id IS NULL THEN
      INSERT INTO public.categories(name) VALUES(btrim(p_category_name)) RETURNING id INTO v_category_id;
    END IF;
  END IF;

  IF p_product_id IS NOT NULL THEN
    UPDATE public.products
    SET name=btrim(p_name),brand_id=v_brand_id,category_id=v_category_id,
        sale_price=coalesce(p_sale_price,sale_price),cost_price=coalesce(p_cost_price,cost_price)
    WHERE id=p_product_id
    RETURNING id INTO v_product_id;

    IF v_product_id IS NULL THEN RAISE EXCEPTION 'Produto não encontrado.'; END IF;
  ELSE
    INSERT INTO public.products(name,brand_id,category_id,sale_price,cost_price)
    VALUES(btrim(p_name),v_brand_id,v_category_id,coalesce(p_sale_price,0),coalesce(p_cost_price,0))
    RETURNING id INTO v_product_id;
  END IF;

  FOR v_variant IN
    SELECT * FROM jsonb_to_recordset(coalesce(p_variants,'[]'::jsonb))
      AS (id uuid,sku text,barcode text,size text,color text,stock_quantity int,minimum_stock int)
  LOOP
    v_generated_sku:=nullif(trim(v_variant.sku),'');
    IF v_generated_sku IS NULL THEN
      v_generated_sku :=
        upper(substring(regexp_replace(extensions.unaccent(coalesce(p_name,'')),'[^a-zA-Z0-9]','','g') from 1 for 4))
        ||'-'||upper(substring(regexp_replace(extensions.unaccent(coalesce(v_variant.size,'Único')),'[^a-zA-Z0-9]','','g') from 1 for 3))
        ||'-'||upper(substring(regexp_replace(extensions.unaccent(coalesce(v_variant.color,'Padrão')),'[^a-zA-Z0-9]','','g') from 1 for 3));

      WHILE EXISTS (
        SELECT 1 FROM public.product_variants
        WHERE sku=v_generated_sku AND (v_variant.id IS NULL OR id<>v_variant.id)
      ) LOOP
        v_generated_sku:=v_generated_sku||v_idx::text;
        v_idx:=v_idx+1;
      END LOOP;
    END IF;

    IF v_variant.barcode IS NOT NULL AND trim(v_variant.barcode)<>'' AND EXISTS (
      SELECT 1 FROM public.product_variants
      WHERE barcode=trim(v_variant.barcode) AND (v_variant.id IS NULL OR id<>v_variant.id)
    ) THEN
      RAISE EXCEPTION 'Código de barras % já está em uso.',v_variant.barcode;
    END IF;

    IF v_variant.id IS NOT NULL THEN
      UPDATE public.product_variants
      SET sku=trim(v_generated_sku),
          barcode=nullif(trim(v_variant.barcode),''),
          size=coalesce(v_variant.size,'Único'),
          color=coalesce(v_variant.color,'Padrão'),
          minimum_stock=coalesce(v_variant.minimum_stock,minimum_stock),
          is_active=true
      WHERE id=v_variant.id AND product_id=v_product_id;

      IF NOT FOUND THEN RAISE EXCEPTION 'Variação não encontrada para o produto informado.'; END IF;
      v_variant_ids:=array_append(v_variant_ids,v_variant.id);
    ELSE
      INSERT INTO public.product_variants(
        product_id,sku,barcode,size,color,stock_quantity,minimum_stock,is_active
      )
      VALUES(
        v_product_id,trim(v_generated_sku),nullif(trim(v_variant.barcode),''),
        coalesce(v_variant.size,'Único'),coalesce(v_variant.color,'Padrão'),
        0,coalesce(v_variant.minimum_stock,0),true
      )
      RETURNING id INTO v_variant.id;

      v_variant_ids:=array_append(v_variant_ids,v_variant.id);
    END IF;
  END LOOP;

  UPDATE public.product_variants
  SET is_active=false
  WHERE product_id=v_product_id
    AND (cardinality(v_variant_ids)=0 OR NOT (id=ANY(v_variant_ids)));

  RETURN jsonb_build_object('success',true,'product_id',v_product_id);
END;
$$;

-- 9) Harden physical inventory approval before return processing.
CREATE OR REPLACE FUNCTION public.approve_physical_inventory(p_inventory_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $
DECLARE
  v_actor uuid := (select auth.uid());
  v_profile_active boolean;
  v_store_id uuid;
  v_store_active boolean;
  v_role text;
  v_status text;
  v_item_count integer;
  v_incomplete_count integer;
  v_item record;
  v_before integer;
  v_after integer;
  v_divergence integer;
BEGIN
  IF v_actor IS NULL OR p_user_id IS NULL OR p_user_id <> v_actor THEN
    RAISE EXCEPTION 'Usuário de aprovação inválido.';
  END IF;

  SELECT is_active INTO v_profile_active
  FROM public.profiles
  WHERE id = v_actor;

  IF COALESCE(v_profile_active,false) = false THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;

  IF p_inventory_id IS NULL THEN
    RAISE EXCEPTION 'Inventário é obrigatório.';
  END IF;

  SELECT status,store_id INTO v_status,v_store_id
  FROM public.physical_inventories
  WHERE id=p_inventory_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventário não encontrado.';
  END IF;

  SELECT is_active INTO v_store_active
  FROM public.stores
  WHERE id=v_store_id;

  IF COALESCE(v_store_active,false) = false THEN
    RAISE EXCEPTION 'Loja inválida ou inativa.';
  END IF;

  v_role:=public.get_user_store_role(v_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER') THEN
    RAISE EXCEPTION 'Permissão negada para aprovar inventário.';
  END IF;

  IF v_status = 'APPROVED' THEN
    RETURN true;
  END IF;

  IF v_status <> 'OPEN' THEN
    RAISE EXCEPTION 'Apenas inventários OPEN podem ser aprovados.';
  END IF;

  SELECT count(*),count(*) FILTER (
    WHERE product_variant_id IS NULL
       OR expected_quantity < 0
       OR counted_quantity < 0
  )
  INTO v_item_count,v_incomplete_count
  FROM public.physical_inventory_items
  WHERE inventory_id=p_inventory_id;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Inventário sem itens não pode ser aprovado.';
  END IF;

  IF v_incomplete_count > 0 THEN
    RAISE EXCEPTION 'Inventário contém itens incompletos ou inválidos.';
  END IF;

  FOR v_item IN
    SELECT product_variant_id,expected_quantity,counted_quantity,reason
    FROM public.physical_inventory_items
    WHERE inventory_id=p_inventory_id
    ORDER BY product_variant_id
    FOR UPDATE
  LOOP
    SELECT quantity INTO v_before
    FROM public.store_inventory
    WHERE store_id=v_store_id
      AND product_variant_id=v_item.product_variant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.store_inventory(store_id,product_variant_id,quantity,minimum_stock)
      VALUES(v_store_id,v_item.product_variant_id,0,0);
      v_before:=0;
    END IF;

    v_divergence:=v_item.counted_quantity-v_item.expected_quantity;
    v_after:=v_item.counted_quantity;

    IF v_divergence <> 0 THEN
      UPDATE public.store_inventory
      SET quantity=v_after
      WHERE store_id=v_store_id AND product_variant_id=v_item.product_variant_id;

      INSERT INTO public.inventory_movements(
        store_id,product_variant_id,type,quantity,quantity_before,quantity_after,
        reference_type,reference_id,user_id,reason,notes
      )
      VALUES(
        v_store_id,v_item.product_variant_id,'ADJUSTMENT',v_divergence,
        v_before,v_after,'INVENTORY',p_inventory_id,v_actor,
        coalesce(v_item.reason,'Ajuste de inventário físico'),'Ajuste de inventário físico'
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
  SET status='APPROVED',
      approved_by=v_actor,
      updated_at=now()
  WHERE id=p_inventory_id;

  RETURN true;
END;
$;

-- 10) Harden returns with concurrency by locking the original sale
-- (already present) and validating availability under that lock.
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
  v_user uuid := (select auth.uid());
  v_profile_active boolean;
  v_role text;
  v_sale record;
  v_return_id uuid;
  v_return_number text;
  v_item record;
  v_sold_qty integer;
  v_returned_qty integer;
  v_available_qty integer;
  v_stock_before integer;
  v_total numeric(12,2):=0;
  v_customer_id uuid:=p_customer_id;
  v_unit_price numeric(12,2);
  v_product_id uuid;
  v_size text;
  v_color text;
BEGIN
  SELECT is_active INTO v_profile_active FROM public.profiles WHERE id=v_user;
  IF v_user IS NULL OR COALESCE(v_profile_active,false)=false THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;

  IF p_store_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.stores WHERE id=p_store_id AND is_active=true) THEN
    RAISE EXCEPTION 'Loja inválida ou inativa.';
  END IF;

  v_role:=public.get_user_store_role(p_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER','CASHIER') THEN
    RAISE EXCEPTION 'Permissão negada.';
  END IF;

  IF p_original_sale_id IS NULL THEN RAISE EXCEPTION 'A devolução deve estar vinculada a uma venda original.'; END IF;
  IF jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' OR jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 THEN
    RAISE EXCEPTION 'Nenhum item informado para devolução.';
  END IF;
  IF p_resolution_type NOT IN ('credito_cliente','vale_troca','estorno_dinheiro') THEN
    RAISE EXCEPTION 'Forma de resolução inválida.';
  END IF;

  SELECT * INTO v_sale
  FROM public.sales
  WHERE id=p_original_sale_id AND store_id=p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Venda original não encontrada nesta loja.'; END IF;
  IF v_sale.status<>'COMPLETED' THEN RAISE EXCEPTION 'Somente vendas concluídas podem ter devolução.'; END IF;

  IF v_customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id=v_customer_id AND is_active=true) THEN
    RAISE EXCEPTION 'Cliente inválido ou inativo.';
  END IF;

  IF v_customer_id IS NULL THEN v_customer_id:=v_sale.customer_id; END IF;
  IF v_customer_id IS NULL AND NULLIF(trim(p_customer_cpf),'') IS NOT NULL THEN
    SELECT id INTO v_customer_id FROM public.customers WHERE cpf=trim(p_customer_cpf) AND is_active=true LIMIT 1;
  END IF;
  IF v_customer_id IS NULL AND p_resolution_type IN ('credito_cliente','vale_troca') THEN
    RAISE EXCEPTION 'Crédito ou vale-troca exige um cliente identificado.';
  END IF;

  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(p_items)
      AS (variant_id uuid,quantity int,product_name text,size text,color text,reason text)
    ORDER BY variant_id
  LOOP
    IF v_item.variant_id IS NULL OR v_item.quantity IS NULL OR v_item.quantity<=0 THEN
      RAISE EXCEPTION 'Item de devolução inválido.';
    END IF;

    SELECT coalesce(sum(si.quantity),0) INTO v_sold_qty
    FROM public.sale_items si
    WHERE si.sale_id=p_original_sale_id AND si.product_variant_id=v_item.variant_id;

    SELECT coalesce(sum(ri.quantity),0) INTO v_returned_qty
    FROM public.return_items ri
    JOIN public.returns r ON r.id=ri.return_id
    WHERE r.original_sale_id=p_original_sale_id
      AND r.status='CONCLUIDO'
      AND ri.product_variant_id=v_item.variant_id;

    v_available_qty:=v_sold_qty-v_returned_qty;
    IF v_sold_qty=0 THEN RAISE EXCEPTION 'A variação informada não pertence à venda original.'; END IF;
    IF v_available_qty<0 OR v_item.quantity>v_available_qty THEN
      RAISE EXCEPTION 'Quantidade devolvida excede a quantidade ainda disponível para devolução.';
    END IF;

    SELECT si.unit_price,si.product_id,pv.size,pv.color
    INTO v_unit_price,v_product_id,v_size,v_color
    FROM public.sale_items si
    JOIN public.product_variants pv ON pv.id=si.product_variant_id
    WHERE si.sale_id=p_original_sale_id AND si.product_variant_id=v_item.variant_id
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
    current_date+interval '30 days',v_user,p_store_id
  )
  RETURNING id INTO v_return_id;

  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(p_items)
      AS (variant_id uuid,quantity int,product_name text,size text,color text,reason text)
    ORDER BY variant_id
  LOOP
    SELECT si.unit_price,si.product_id,pv.size,pv.color
    INTO v_unit_price,v_product_id,v_size,v_color
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
      v_return_id,v_product_id,v_item.variant_id,
      coalesce(nullif(v_item.product_name,''),'Produto'),
      coalesce(nullif(v_item.size,''),v_size,'Único'),
      coalesce(nullif(v_item.color,''),v_color,'Padrão'),
      v_unit_price,v_item.quantity,coalesce(nullif(v_item.reason,''),'Devolução')
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
      v_stock_before+v_item.quantity,'RETURN',v_return_id,v_user,
      'Devolução '||v_return_number,coalesce(v_item.reason,'Devolução')
    );

    UPDATE public.product_variants
    SET stock_quantity=(SELECT coalesce(sum(si.quantity),0) FROM public.store_inventory si WHERE si.product_variant_id=id)
    WHERE id=v_item.variant_id;
  END LOOP;

  IF p_resolution_type IN ('credito_cliente','vale_troca') THEN
    INSERT INTO public.customer_credit_movements(store_id,customer_id,type,amount,description,reference_type,reference_id)
    VALUES(
      p_store_id,v_customer_id,'CREDIT',round(v_total,2),
      CASE WHEN p_resolution_type='vale_troca'
           THEN 'Vale-troca gerado pela devolução '
           ELSE 'Crédito gerado pela devolução '
      END||v_return_number,
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

  RETURN jsonb_build_object('success',true,'return_id',v_return_id,'return_number',v_return_number,'total',round(v_total,2));
END;
$$;

-- 10) Reports are store-scoped by explicit parameter.
-- Existing client callers must be updated together with this migration.
CREATE OR REPLACE FUNCTION public.report_stock_status(p_store_id uuid DEFAULT NULL)
RETURNS TABLE(product_id uuid,product_name text,variant_id uuid,variant_sku text,stock_quantity integer,reserved_quantity integer,minimum_stock integer,status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (select auth.uid()) IS NULL OR public.current_user_role() IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;
  IF p_store_id IS NULL OR NOT public.has_store_access(p_store_id) THEN
    RAISE EXCEPTION 'Acesso negado à loja.';
  END IF;

  RETURN QUERY
  SELECT p.id,p.name,v.id,v.sku,si.quantity,v.reserved_quantity,v.minimum_stock,
    CASE WHEN si.quantity=0 THEN 'OUT_OF_STOCK'
         WHEN si.quantity<=v.minimum_stock THEN 'LOW_STOCK'
         ELSE 'OK' END
  FROM public.store_inventory si
  JOIN public.product_variants v ON v.id=si.product_variant_id
  JOIN public.products p ON p.id=v.product_id
  WHERE si.store_id=p_store_id AND v.is_active=true AND p.is_active=true
  ORDER BY CASE WHEN si.quantity=0 THEN 1 WHEN si.quantity<=v.minimum_stock THEN 2 ELSE 3 END,si.quantity;
END;
$$;

CREATE OR REPLACE FUNCTION public.report_top_selling_products(p_limit integer DEFAULT 10,p_store_id uuid DEFAULT NULL)
RETURNS TABLE(product_id uuid,product_name text,total_quantity_sold bigint,total_revenue numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (select auth.uid()) IS NULL OR public.current_user_role() IS NULL THEN RAISE EXCEPTION 'Autenticação obrigatória.'; END IF;
  IF p_store_id IS NULL OR NOT public.has_store_access(p_store_id) THEN RAISE EXCEPTION 'Acesso negado à loja.'; END IF;
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'Limite inválido.'; END IF;

  RETURN QUERY
  SELECT p.id,p.name,sum(si.quantity)::bigint,sum(si.total)::numeric
  FROM public.sale_items si
  JOIN public.sales s ON s.id=si.sale_id
  JOIN public.products p ON p.id=si.product_id
  WHERE s.status='COMPLETED' AND s.store_id=p_store_id
  GROUP BY p.id,p.name
  ORDER BY total_quantity_sold DESC
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.report_inventory_movements_summary(
  p_start_date timestamptz DEFAULT now()-interval '30 days',
  p_end_date timestamptz DEFAULT now(),
  p_store_id uuid DEFAULT NULL
)
RETURNS TABLE(movement_type text,total_quantity bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (select auth.uid()) IS NULL OR public.current_user_role() IS NULL THEN RAISE EXCEPTION 'Autenticação obrigatória.'; END IF;
  IF p_store_id IS NULL OR NOT public.has_store_access(p_store_id) THEN RAISE EXCEPTION 'Acesso negado à loja.'; END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date>p_end_date THEN RAISE EXCEPTION 'Intervalo inválido.'; END IF;

  RETURN QUERY
  SELECT m.type,sum(m.quantity)::bigint
  FROM public.inventory_movements m
  WHERE m.store_id=p_store_id AND m.created_at>=p_start_date AND m.created_at<=p_end_date
  GROUP BY m.type
  ORDER BY total_quantity DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_profitability_by_product(
  p_store_id uuid,
  start_date date DEFAULT NULL,
  end_date date DEFAULT NULL
)
RETURNS TABLE(product_id uuid,product_name text,category_id uuid,total_quantity bigint,total_revenue numeric,total_cost numeric,margin_value numeric,margin_percentage numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (select auth.uid()) IS NULL OR public.current_user_role() IS NULL THEN RAISE EXCEPTION 'Autenticação obrigatória.'; END IF;
  IF p_store_id IS NULL OR NOT public.has_store_access(p_store_id) THEN RAISE EXCEPTION 'Acesso negado à loja.'; END IF;

  RETURN QUERY
  SELECT p.id,p.name,p.category_id,sum(si.quantity)::bigint,sum(si.total),
    sum(si.quantity*p.cost_price),
    sum(si.total)-sum(si.quantity*p.cost_price),
    CASE WHEN sum(si.total)>0 THEN ((sum(si.total)-sum(si.quantity*p.cost_price))/sum(si.total))*100 ELSE 0 END
  FROM public.sale_items si
  JOIN public.sales s ON s.id=si.sale_id
  JOIN public.products p ON p.id=si.product_id
  WHERE s.status='COMPLETED'
    AND s.store_id=p_store_id
    AND (start_date IS NULL OR s.completed_at::date>=start_date)
    AND (end_date IS NULL OR s.completed_at::date<=end_date)
  GROUP BY p.id,p.name,p.category_id
  ORDER BY margin_value DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_profitability_by_category(
  p_store_id uuid,
  start_date date DEFAULT NULL,
  end_date date DEFAULT NULL
)
RETURNS TABLE(category_id uuid,category_name text,total_quantity bigint,total_revenue numeric,total_cost numeric,margin_value numeric,margin_percentage numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (select auth.uid()) IS NULL OR public.current_user_role() IS NULL THEN RAISE EXCEPTION 'Autenticação obrigatória.'; END IF;
  IF p_store_id IS NULL OR NOT public.has_store_access(p_store_id) THEN RAISE EXCEPTION 'Acesso negado à loja.'; END IF;

  RETURN QUERY
  SELECT c.id,coalesce(c.name,'Sem Categoria'),sum(si.quantity)::bigint,sum(si.total),
    sum(si.quantity*p.cost_price),
    sum(si.total)-sum(si.quantity*p.cost_price),
    CASE WHEN sum(si.total)>0 THEN ((sum(si.total)-sum(si.quantity*p.cost_price))/sum(si.total))*100 ELSE 0 END
  FROM public.sale_items si
  JOIN public.sales s ON s.id=si.sale_id
  JOIN public.products p ON p.id=si.product_id
  LEFT JOIN public.categories c ON c.id=p.category_id
  WHERE s.status='COMPLETED'
    AND s.store_id=p_store_id
    AND (start_date IS NULL OR s.completed_at::date>=start_date)
    AND (end_date IS NULL OR s.completed_at::date<=end_date)
  GROUP BY c.id,c.name
  ORDER BY margin_value DESC;
END;
$$;

-- Replace report grants with the new signatures and remove the old API signatures.
REVOKE ALL ON FUNCTION public.report_stock_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.report_top_selling_products(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.report_inventory_movements_summary(timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_profitability_by_product(date,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_profitability_by_category(date,date) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.report_stock_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_top_selling_products(integer,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_inventory_movements_summary(timestamptz,timestamptz,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_profitability_by_product(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_profitability_by_category(uuid,date,date) TO authenticated;

-- 12) Physical inventory RLS: only OPEN inventories are directly editable;
-- approval is performed by the SECURITY DEFINER RPC. Existing store_id and
-- created_by values must remain unchanged.
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
  AND EXISTS (
    SELECT 1
    FROM public.physical_inventories old_pi
    WHERE old_pi.id=physical_inventories.id
      AND old_pi.store_id=physical_inventories.store_id
      AND old_pi.created_by IS NOT DISTINCT FROM physical_inventories.created_by
  )
);

-- 13) Grants remain limited to authenticated for sensitive RPCs.
REVOKE EXECUTE ON FUNCTION public.admin_set_user_role(uuid,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_sale(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.manage_product(uuid,text,text,text,numeric,numeric,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.process_return(uuid,uuid,uuid,text,text,jsonb,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.register_stock_entry(uuid,integer,numeric,text,uuid,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.approve_physical_inventory(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_sale(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manage_product(uuid,text,text,text,numeric,numeric,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_return(uuid,uuid,uuid,text,text,jsonb,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_stock_entry(uuid,integer,numeric,text,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_physical_inventory(uuid,uuid) TO authenticated;
