BEGIN;
UPDATE public.sale_idempotency si SET store_id=s.store_id,user_id=s.user_id
FROM public.sales s WHERE s.id=si.sale_id;
ALTER TABLE public.sale_idempotency DROP CONSTRAINT IF EXISTS sale_idempotency_pkey;
ALTER TABLE public.sale_idempotency ADD CONSTRAINT sale_idempotency_pkey PRIMARY KEY (idempotency_key,store_id,user_id);

CREATE OR REPLACE FUNCTION public.complete_sale(p_store_id uuid,p_customer_id uuid DEFAULT NULL,p_customer_name text DEFAULT 'Cliente não identificado',p_customer_cpf text DEFAULT 'Não informado',p_items jsonb DEFAULT '[]'::jsonb,p_payment_method text DEFAULT 'PIX',p_installments integer DEFAULT 1,p_discount_value numeric DEFAULT 0,p_discount_percent numeric DEFAULT 0,p_idempotency_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
 v_user_id uuid:=auth.uid(); v_profile_active boolean; v_store_active boolean; v_role text;
 v_sale_id uuid; v_sale_number text; v_subtotal numeric(12,2):=0; v_discount numeric(12,2):=0; v_total numeric(12,2):=0;
 v_customer_id uuid:=p_customer_id; v_method text; v_item record; v_inv record;
BEGIN
 SELECT is_active INTO v_profile_active FROM profiles WHERE id=v_user_id;
 IF v_user_id IS NULL OR NOT COALESCE(v_profile_active,false) THEN RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.'; END IF;
 IF p_store_id IS NULL THEN RAISE EXCEPTION 'Loja obrigatória.'; END IF;
 SELECT is_active INTO v_store_active FROM stores WHERE id=p_store_id;
 IF NOT COALESCE(v_store_active,false) THEN RAISE EXCEPTION 'Loja inválida ou inativa.'; END IF;
 v_role:=get_user_store_role(p_store_id);
 IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER','CASHIER') THEN RAISE EXCEPTION 'Permissão negada para vender nesta loja.'; END IF;
 IF NULLIF(btrim(p_idempotency_key),'') IS NULL THEN RAISE EXCEPTION 'Chave de idempotência obrigatória.'; END IF;
 IF jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' OR jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 THEN RAISE EXCEPTION 'Carrinho vazio.'; END IF;
 IF coalesce(p_installments,1)<1 OR coalesce(p_installments,1)>24 THEN RAISE EXCEPTION 'Número de parcelas inválido.'; END IF;
 IF coalesce(p_discount_value,0)<0 OR coalesce(p_discount_percent,0)<0 OR coalesce(p_discount_percent,0)>100 THEN RAISE EXCEPTION 'Desconto inválido.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text||':'||p_store_id::text||':'||btrim(p_idempotency_key),0));
 SELECT sale_id INTO v_sale_id FROM sale_idempotency WHERE idempotency_key=btrim(p_idempotency_key) AND store_id=p_store_id AND user_id=v_user_id FOR SHARE;
 IF v_sale_id IS NOT NULL THEN RETURN (SELECT jsonb_build_object('success',true,'sale_id',s.id,'sale_number',s.sale_number,'total',s.total,'message','Venda já processada anteriormente (idempotência).') FROM sales s WHERE s.id=v_sale_id AND s.store_id=p_store_id AND s.user_id=v_user_id); END IF;
 IF v_customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customers WHERE id=v_customer_id AND is_active=true) THEN RAISE EXCEPTION 'Cliente inválido ou inativo.'; END IF;
 v_method:=CASE WHEN upper(coalesce(p_payment_method,'')) LIKE '%PIX%' THEN 'PIX' WHEN upper(coalesce(p_payment_method,'')) LIKE '%DEBIT%' THEN 'DEBIT_CARD' WHEN upper(coalesce(p_payment_method,'')) LIKE '%CART%' THEN 'CREDIT_CARD' WHEN upper(coalesce(p_payment_method,'')) LIKE '%CASH%' OR upper(coalesce(p_payment_method,'')) LIKE '%DINHEIRO%' THEN 'CASH' ELSE NULL END;
 IF v_method IS NULL THEN RAISE EXCEPTION 'Método de pagamento inválido.'; END IF;
 FOR v_item IN SELECT x.variant_id,sum(x.quantity)::integer quantity FROM jsonb_to_recordset(p_items) x(variant_id uuid,quantity integer,unit_price numeric,product_id uuid,product_name text,variant_description text) GROUP BY x.variant_id ORDER BY x.variant_id LOOP
  IF v_item.variant_id IS NULL OR v_item.quantity IS NULL OR v_item.quantity<=0 THEN RAISE EXCEPTION 'Item de venda inválido.'; END IF;
  SELECT si.id,si.quantity,pv.product_id,pv.size,pv.color,p.sale_price INTO v_inv FROM store_inventory si JOIN product_variants pv ON pv.id=si.product_variant_id JOIN products p ON p.id=pv.product_id WHERE si.store_id=p_store_id AND si.product_variant_id=v_item.variant_id AND pv.is_active AND p.is_active FOR UPDATE;
  IF NOT FOUND OR v_inv.quantity<v_item.quantity THEN RAISE EXCEPTION 'Estoque insuficiente ou produto indisponível.'; END IF;
  v_subtotal:=v_subtotal+round(v_inv.sale_price*v_item.quantity,2);
 END LOOP;
 v_discount:=least(v_subtotal,greatest(0,coalesce(p_discount_value,0))+(v_subtotal*greatest(0,coalesce(p_discount_percent,0))/100));
 v_total:=round(greatest(0,v_subtotal-v_discount),2); v_sale_number:='PDV #'||nextval('sale_number_seq')::text;
 INSERT INTO sales(store_id,sale_number,customer_id,user_id,customer_name,customer_cpf,subtotal,discount,total,status,completed_at)
 VALUES(p_store_id,v_sale_number,v_customer_id,v_user_id,coalesce(nullif(trim(p_customer_name),''),'Cliente não identificado'),coalesce(nullif(trim(p_customer_cpf),''),'Não informado'),v_subtotal,v_discount,v_total,'COMPLETED',now()) RETURNING id INTO v_sale_id;
 INSERT INTO sale_idempotency(idempotency_key,sale_id,store_id,user_id) VALUES(btrim(p_idempotency_key),v_sale_id,p_store_id,v_user_id);
 FOR v_item IN SELECT x.variant_id,sum(x.quantity)::integer quantity FROM jsonb_to_recordset(p_items) x(variant_id uuid,quantity integer,unit_price numeric,product_id uuid,product_name text,variant_description text) GROUP BY x.variant_id ORDER BY x.variant_id LOOP
  INSERT INTO sale_items(sale_id,product_id,product_variant_id,product_name,variant_description,quantity,unit_price,total)
  SELECT v_sale_id,pv.product_id,v_item.variant_id,p.name,coalesce(pv.size,'Único')||' / '||coalesce(pv.color,'Padrão'),v_item.quantity,p.sale_price,round(p.sale_price*v_item.quantity,2)
  FROM product_variants pv JOIN products p ON p.id=pv.product_id WHERE pv.id=v_item.variant_id AND pv.is_active AND p.is_active;
  UPDATE store_inventory SET quantity=quantity-v_item.quantity WHERE store_id=p_store_id AND product_variant_id=v_item.variant_id;
  INSERT INTO inventory_movements(store_id,product_variant_id,type,quantity,quantity_before,quantity_after,reference_type,reference_id,user_id,notes,reason)
  SELECT p_store_id,v_item.variant_id,'SALE',v_item.quantity,si.quantity+v_item.quantity,si.quantity,'SALE',v_sale_id,v_user_id,'Venda '||v_sale_number,'Venda concluída' FROM store_inventory si WHERE si.store_id=p_store_id AND si.product_variant_id=v_item.variant_id;
  UPDATE product_variants SET stock_quantity=(SELECT coalesce(sum(si.quantity),0) FROM store_inventory si WHERE si.product_variant_id=product_variants.id) WHERE id=v_item.variant_id;
 END LOOP;
 INSERT INTO payments(sale_id,method,amount,status,installments) VALUES(v_sale_id,v_method,v_total,'APPROVED',coalesce(p_installments,1));
 INSERT INTO financial_transactions(store_id,type,category,description,amount,status,reference_type,reference_id,paid_at) VALUES(p_store_id,'INCOME','Vendas PDV','Venda '||v_sale_number,v_total,'PAID','SALE',v_sale_id,now());
 RETURN jsonb_build_object('success',true,'sale_id',v_sale_id,'sale_number',v_sale_number,'total',v_total);
END;$function$;
CREATE OR REPLACE FUNCTION public.create_mp_pix_sale(p_customer_id uuid DEFAULT NULL,p_customer_name text DEFAULT 'Cliente não identificado',p_customer_cpf text DEFAULT 'Não informado',p_items jsonb DEFAULT '[]'::jsonb,p_discount_value numeric DEFAULT 0,p_discount_percent numeric DEFAULT 0,p_store_id uuid DEFAULT NULL,p_idempotency_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
 v_user_id uuid:=auth.uid(); v_profile_active boolean; v_store_active boolean; v_role text; v_sale_id uuid; v_sale_number text;
 v_subtotal numeric(12,2):=0; v_discount numeric(12,2):=0; v_total numeric(12,2):=0; v_customer_id uuid:=p_customer_id; v_item record; v_inv record;
BEGIN
 SELECT is_active INTO v_profile_active FROM profiles WHERE id=v_user_id;
 IF v_user_id IS NULL OR NOT COALESCE(v_profile_active,false) THEN RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.'; END IF;
 IF p_store_id IS NULL THEN RAISE EXCEPTION 'Loja obrigatória.'; END IF;
 SELECT is_active INTO v_store_active FROM stores WHERE id=p_store_id;
 IF NOT COALESCE(v_store_active,false) THEN RAISE EXCEPTION 'Loja inválida ou inativa.'; END IF;
 v_role:=get_user_store_role(p_store_id);
 IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER','CASHIER') THEN RAISE EXCEPTION 'Permissão negada para criar venda PIX nesta loja.'; END IF;
 IF NULLIF(btrim(p_idempotency_key),'') IS NULL THEN RAISE EXCEPTION 'Chave de idempotência obrigatória.'; END IF;
 IF jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' OR jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 THEN RAISE EXCEPTION 'Carrinho vazio.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text||':'||p_store_id::text||':'||btrim(p_idempotency_key),0));
 SELECT sale_id INTO v_sale_id FROM sale_idempotency WHERE idempotency_key=btrim(p_idempotency_key) AND store_id=p_store_id AND user_id=v_user_id FOR SHARE;
 IF v_sale_id IS NOT NULL THEN RETURN (SELECT jsonb_build_object('success',true,'sale_id',s.id,'sale_number',s.sale_number,'total',s.total,'message','Venda já processada anteriormente (idempotência).') FROM sales s WHERE s.id=v_sale_id AND s.store_id=p_store_id AND s.user_id=v_user_id); END IF;
 IF v_customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customers WHERE id=v_customer_id AND is_active=true) THEN RAISE EXCEPTION 'Cliente inválido ou inativo.'; END IF;
 FOR v_item IN SELECT x.variant_id,sum(x.quantity)::integer quantity FROM jsonb_to_recordset(p_items) x(variant_id uuid,quantity integer,unit_price numeric,product_id uuid,product_name text,variant_description text) GROUP BY x.variant_id ORDER BY x.variant_id LOOP
  IF v_item.variant_id IS NULL OR v_item.quantity IS NULL OR v_item.quantity<=0 THEN RAISE EXCEPTION 'Item de venda inválido.'; END IF;
  SELECT si.id,si.quantity,pv.product_id,pv.size,pv.color,p.sale_price INTO v_inv FROM store_inventory si JOIN product_variants pv ON pv.id=si.product_variant_id JOIN products p ON p.id=pv.product_id WHERE si.store_id=p_store_id AND si.product_variant_id=v_item.variant_id AND pv.is_active AND p.is_active FOR UPDATE;
  IF NOT FOUND OR v_inv.quantity<v_item.quantity THEN RAISE EXCEPTION 'Estoque insuficiente ou produto indisponível.'; END IF;
  v_subtotal:=v_subtotal+round(v_inv.sale_price*v_item.quantity,2);
 END LOOP;
 v_discount:=least(v_subtotal,greatest(0,coalesce(p_discount_value,0))+(v_subtotal*least(100,greatest(0,coalesce(p_discount_percent,0)))/100));
 v_total:=round(greatest(0,v_subtotal-v_discount),2); v_sale_number:='PDV #'||nextval('sale_number_seq')::text;
 INSERT INTO sales(store_id,sale_number,customer_id,user_id,customer_name,customer_cpf,subtotal,discount,total,status) VALUES(p_store_id,v_sale_number,v_customer_id,v_user_id,coalesce(nullif(trim(p_customer_name),''),'Cliente não identificado'),coalesce(nullif(trim(p_customer_cpf),''),'Não informado'),v_subtotal,v_discount,v_total,'PENDING') RETURNING id INTO v_sale_id;
 INSERT INTO sale_idempotency(idempotency_key,sale_id,store_id,user_id) VALUES(btrim(p_idempotency_key),v_sale_id,p_store_id,v_user_id);
 FOR v_item IN SELECT x.variant_id,sum(x.quantity)::integer quantity FROM jsonb_to_recordset(p_items) x(variant_id uuid,quantity integer,unit_price numeric,product_id uuid,product_name text,variant_description text) GROUP BY x.variant_id ORDER BY x.variant_id LOOP
  INSERT INTO sale_items(sale_id,product_id,product_variant_id,product_name,variant_description,quantity,unit_price,total)
  SELECT v_sale_id,pv.product_id,v_item.variant_id,p.name,coalesce(pv.size,'Único')||' / '||coalesce(pv.color,'Padrão'),v_item.quantity,p.sale_price,round(p.sale_price*v_item.quantity,2)
  FROM product_variants pv JOIN products p ON p.id=pv.product_id WHERE pv.id=v_item.variant_id AND pv.is_active AND p.is_active;
  UPDATE store_inventory SET quantity=quantity-v_item.quantity WHERE store_id=p_store_id AND product_variant_id=v_item.variant_id;
  INSERT INTO inventory_movements(store_id,product_variant_id,type,quantity,quantity_before,quantity_after,reference_type,reference_id,user_id,notes,reason)
  SELECT p_store_id,v_item.variant_id,'SALE',v_item.quantity,si.quantity+v_item.quantity,si.quantity,'SALE',v_sale_id,v_user_id,'Reserva PIX '||v_sale_number,'Reserva de estoque PIX' FROM store_inventory si WHERE si.store_id=p_store_id AND si.product_variant_id=v_item.variant_id;
  UPDATE product_variants SET reserved_quantity=coalesce(reserved_quantity,0)+v_item.quantity,stock_quantity=(SELECT coalesce(sum(si.quantity),0) FROM store_inventory si WHERE si.product_variant_id=product_variants.id) WHERE id=v_item.variant_id;
 END LOOP;
 INSERT INTO payments(sale_id,method,amount,status,installments) VALUES(v_sale_id,'PIX',v_total,'PENDING',1);
 RETURN jsonb_build_object('success',true,'sale_id',v_sale_id,'sale_number',v_sale_number,'total',v_total);
END;$function$;

COMMIT;
