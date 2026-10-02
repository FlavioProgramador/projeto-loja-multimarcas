
DROP FUNCTION IF EXISTS public.register_stock_entry(UUID,INTEGER,NUMERIC,TEXT,UUID,TEXT,TEXT);

CREATE OR REPLACE FUNCTION public.register_stock_entry(
  p_variant_id UUID,
  p_quantity INTEGER,
  p_unit_cost NUMERIC,
  p_product_name TEXT,
  p_store_id UUID,
  p_reason TEXT DEFAULT 'Compra de fornecedor',
  p_type TEXT DEFAULT 'PURCHASE'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_before INTEGER;
  v_after INTEGER;
  v_total NUMERIC(12,2);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autorizado.'; END IF;
  IF public.get_user_store_role(p_store_id) NOT IN ('ADMIN','MANAGER') THEN RAISE EXCEPTION 'Permissão negada para estoque.'; END IF;
  IF p_quantity IS NULL OR p_quantity<=0 THEN RAISE EXCEPTION 'Quantidade inválida.'; END IF;
  IF p_unit_cost IS NULL OR p_unit_cost<0 THEN RAISE EXCEPTION 'Custo inválido.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id=p_variant_id AND is_active=true) THEN RAISE EXCEPTION 'Variação não encontrada ou inativa.'; END IF;

  SELECT quantity INTO v_before FROM public.store_inventory WHERE store_id=p_store_id AND product_variant_id=p_variant_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.store_inventory(store_id,product_variant_id,quantity,minimum_stock) VALUES(p_store_id,p_variant_id,0,0);
    v_before:=0;
  END IF;

  v_after:=v_before+p_quantity;
  UPDATE public.store_inventory SET quantity=v_after WHERE store_id=p_store_id AND product_variant_id=p_variant_id;
  UPDATE public.product_variants SET stock_quantity=(SELECT COALESCE(SUM(quantity),0) FROM public.store_inventory WHERE product_variant_id=p_variant_id) WHERE id=p_variant_id;

  INSERT INTO public.inventory_movements(store_id,product_variant_id,type,quantity,quantity_before,quantity_after,reference_type,user_id,notes,reason)
  VALUES(p_store_id,p_variant_id,'ENTRY',p_quantity,v_before,v_after,'STOCK_ENTRY',auth.uid(),'Entrada de estoque: '||COALESCE(p_product_name,'Produto'),COALESCE(p_reason,'Compra de fornecedor'));

  v_total:=ROUND(p_quantity*p_unit_cost,2);
  IF v_total>0 AND UPPER(COALESCE(p_type,'PURCHASE')) IN ('PURCHASE','ENTRY') THEN
    INSERT INTO public.financial_transactions(store_id,type,category,description,amount,status,reference_type,paid_at)
    VALUES(p_store_id,'EXPENSE','Estoque / Compras','Entrada de estoque: '||COALESCE(p_product_name,'Produto'),v_total,'PAID','STOCK_ENTRY',NOW());
  END IF;

  RETURN jsonb_build_object('success',true,'quantity',v_after);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_stock_entry(UUID,INTEGER,NUMERIC,TEXT,UUID,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_stock_entry(UUID,INTEGER,NUMERIC,TEXT,UUID,TEXT,TEXT) TO authenticated;

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
SET search_path=public,pg_temp
AS $$
DECLARE
  v_user_id UUID:=auth.uid();
  v_sale_id UUID;
  v_sale_number TEXT;
  v_subtotal NUMERIC(12,2):=0;
  v_total_discount NUMERIC(12,2):=0;
  v_final_total NUMERIC(12,2):=0;
  v_item RECORD;
  v_inventory RECORD;
  v_real_price NUMERIC(12,2);
  v_customer_id UUID:=p_customer_id;
  v_method TEXT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Não autorizado.'; END IF;
  IF public.get_user_store_role(p_store_id) NOT IN ('ADMIN','MANAGER','CASHIER') THEN RAISE EXCEPTION 'Permissão negada para vender nesta loja.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id=p_store_id AND is_active=true) THEN RAISE EXCEPTION 'Loja inválida ou inativa.'; END IF;
  IF jsonb_array_length(COALESCE(p_items,'[]'::jsonb))=0 THEN RAISE EXCEPTION 'Carrinho vazio.'; END IF;
  IF COALESCE(p_installments,1)<1 OR COALESCE(p_installments,1)>24 THEN RAISE EXCEPTION 'Número de parcelas inválido.'; END IF;
  IF COALESCE(p_discount_value,0)<0 OR COALESCE(p_discount_percent,0)<0 OR COALESCE(p_discount_percent,0)>100 THEN RAISE EXCEPTION 'Desconto inválido.'; END IF;

  IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key)<>'' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key,0));
    SELECT sale_id INTO v_sale_id FROM public.sale_idempotency WHERE idempotency_key=p_idempotency_key FOR SHARE;
    IF FOUND THEN
      RETURN (SELECT jsonb_build_object('success',true,'sale_id',s.id,'sale_number',s.sale_number,'total',s.total,'message','Venda já processada anteriormente (idempotência).') FROM public.sales s WHERE s.id=v_sale_id);
    END IF;
  END IF;

  IF v_customer_id IS NULL AND NULLIF(trim(p_customer_cpf),'') IS NOT NULL AND trim(p_customer_cpf)<>'Não informado' THEN
    SELECT id INTO v_customer_id FROM public.customers WHERE cpf=trim(p_customer_cpf) LIMIT 1;
    IF v_customer_id IS NULL AND NULLIF(trim(p_customer_name),'') IS NOT NULL AND p_customer_name<>'Cliente não identificado' THEN
      INSERT INTO public.customers(name,cpf) VALUES(trim(p_customer_name),trim(p_customer_cpf)) RETURNING id INTO v_customer_id;
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(variant_id UUID,quantity INT,unit_price NUMERIC,product_name TEXT,variant_description TEXT) LOOP
    IF v_item.variant_id IS NULL OR v_item.quantity IS NULL OR v_item.quantity<=0 THEN RAISE EXCEPTION 'Item de venda inválido.'; END IF;
    SELECT si.id,si.quantity INTO v_inventory
    FROM public.store_inventory si
    JOIN public.product_variants pv ON pv.id=si.product_variant_id
    JOIN public.products p ON p.id=pv.product_id
    WHERE si.store_id=p_store_id AND si.product_variant_id=v_item.variant_id AND pv.is_active=true AND p.is_active=true
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Produto não está disponível nesta loja.'; END IF;
    IF v_inventory.quantity<v_item.quantity THEN RAISE EXCEPTION 'Estoque insuficiente para o produto informado.'; END IF;
    SELECT p.sale_price INTO v_real_price FROM public.product_variants pv JOIN public.products p ON p.id=pv.product_id WHERE pv.id=v_item.variant_id AND pv.is_active=true AND p.is_active=true;
    v_subtotal:=v_subtotal+(v_real_price*v_item.quantity);
  END LOOP;

  v_total_discount:=LEAST(v_subtotal,COALESCE(p_discount_value,0)+(v_subtotal*COALESCE(p_discount_percent,0)/100));
  v_final_total:=ROUND(GREATEST(0,v_subtotal-v_total_discount),2);
  v_sale_number:='PDV #'||nextval('sale_number_seq')::TEXT;

  INSERT INTO public.sales(store_id,sale_number,customer_id,user_id,customer_name,customer_cpf,subtotal,discount,total,status,completed_at)
  VALUES(p_store_id,v_sale_number,v_customer_id,v_user_id,COALESCE(NULLIF(trim(p_customer_name),''),'Cliente não identificado'),COALESCE(NULLIF(trim(p_customer_cpf),''),'Não informado'),ROUND(v_subtotal,2),ROUND(v_total_discount,2),v_final_total,'COMPLETED',NOW())
  RETURNING id INTO v_sale_id;

  IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key)<>'' THEN
    INSERT INTO public.sale_idempotency(idempotency_key,sale_id) VALUES(p_idempotency_key,v_sale_id);
  END IF;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(variant_id UUID,quantity INT,unit_price NUMERIC,product_name TEXT,variant_description TEXT) LOOP
    SELECT p.sale_price INTO v_real_price FROM public.product_variants pv JOIN public.products p ON p.id=pv.product_id WHERE pv.id=v_item.variant_id AND pv.is_active=true AND p.is_active=true;
    INSERT INTO public.sale_items(sale_id,product_id,product_variant_id,product_name,variant_description,quantity,unit_price,total)
    SELECT v_sale_id,pv.product_id,v_item.variant_id,COALESCE(v_item.product_name,p.name),COALESCE(v_item.variant_description,pv.size||' / '||pv.color),v_item.quantity,v_real_price,ROUND(v_real_price*v_item.quantity,2)
    FROM public.product_variants pv JOIN public.products p ON p.id=pv.product_id WHERE pv.id=v_item.variant_id;

    UPDATE public.store_inventory SET quantity=quantity-v_item.quantity WHERE store_id=p_store_id AND product_variant_id=v_item.variant_id;
    INSERT INTO public.inventory_movements(store_id,product_variant_id,type,quantity,quantity_before,quantity_after,reference_type,reference_id,user_id,notes,reason)
    SELECT p_store_id,v_item.variant_id,'SALE',v_item.quantity,si.quantity+v_item.quantity,si.quantity,'SALE',v_sale_id,v_user_id,'Venda '||v_sale_number,'Venda'
    FROM public.store_inventory si WHERE si.store_id=p_store_id AND si.product_variant_id=v_item.variant_id;
    UPDATE public.product_variants SET stock_quantity=(SELECT COALESCE(SUM(quantity),0) FROM public.store_inventory WHERE product_variant_id=v_item.variant_id) WHERE id=v_item.variant_id;
  END LOOP;

  v_method:=CASE
    WHEN UPPER(COALESCE(p_payment_method,'')) LIKE '%PIX%' THEN 'PIX'
    WHEN UPPER(COALESCE(p_payment_method,'')) LIKE '%DEBIT%' THEN 'DEBIT_CARD'
    WHEN UPPER(COALESCE(p_payment_method,'')) LIKE '%CART%' THEN 'CREDIT_CARD'
    WHEN UPPER(COALESCE(p_payment_method,'')) LIKE '%DINHEIRO%' OR UPPER(COALESCE(p_payment_method,'')) LIKE '%CASH%' THEN 'CASH'
    ELSE 'CASH' END;

  INSERT INTO public.payments(sale_id,method,amount,status,installments) VALUES(v_sale_id,v_method,v_final_total,'APPROVED',GREATEST(1,p_installments));
  INSERT INTO public.financial_transactions(store_id,type,category,description,amount,status,reference_type,reference_id,paid_at)
  VALUES(p_store_id,'INCOME','Vendas PDV','Venda '||v_sale_number,v_final_total,'PAID','SALE',v_sale_id,NOW());

  RETURN jsonb_build_object('success',true,'sale_id',v_sale_id,'sale_number',v_sale_number,'total',v_final_total);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_sale(UUID,UUID,TEXT,TEXT,JSONB,TEXT,INT,NUMERIC,NUMERIC,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_sale(UUID,UUID,TEXT,TEXT,JSONB,TEXT,INT,NUMERIC,NUMERIC,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_sale(p_sale_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 v_user UUID:=auth.uid(); v_sale RECORD; v_item RECORD; v_before INTEGER;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Não autorizado.'; END IF;
 SELECT * INTO v_sale FROM public.sales WHERE id=p_sale_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'message','Venda não encontrada.'); END IF;
 IF public.get_user_store_role(v_sale.store_id) NOT IN ('ADMIN','MANAGER','CASHIER') THEN RAISE EXCEPTION 'Permissão negada.'; END IF;
 IF v_sale.status='CANCELLED' THEN RETURN jsonb_build_object('success',true,'message','Venda já cancelada (idempotente).'); END IF;
 IF v_sale.status<>'COMPLETED' THEN RETURN jsonb_build_object('success',false,'message','Somente vendas concluídas podem ser canceladas.'); END IF;

 FOR v_item IN SELECT product_variant_id,quantity FROM public.sale_items WHERE sale_id=p_sale_id LOOP
   SELECT quantity INTO v_before FROM public.store_inventory WHERE store_id=v_sale.store_id AND product_variant_id=v_item.product_variant_id FOR UPDATE;
   IF NOT FOUND THEN
     INSERT INTO public.store_inventory(store_id,product_variant_id,quantity) VALUES(v_sale.store_id,v_item.product_variant_id,0);
     v_before:=0;
   END IF;
   UPDATE public.store_inventory SET quantity=quantity+v_item.quantity WHERE store_id=v_sale.store_id AND product_variant_id=v_item.product_variant_id;
   INSERT INTO public.inventory_movements(store_id,product_variant_id,type,quantity,quantity_before,quantity_after,reference_type,reference_id,user_id,notes,reason)
   VALUES(v_sale.store_id,v_item.product_variant_id,'CANCELLATION',v_item.quantity,v_before,v_before+v_item.quantity,'SALE',p_sale_id,v_user,'Cancelamento da venda','Cancelamento');
   UPDATE public.product_variants SET stock_quantity=(SELECT COALESCE(SUM(quantity),0) FROM public.store_inventory WHERE product_variant_id=v_item.product_variant_id) WHERE id=v_item.product_variant_id;
 END LOOP;

 UPDATE public.sales SET status='CANCELLED',completed_at=NULL WHERE id=p_sale_id;
 UPDATE public.payments SET status='CANCELLED' WHERE sale_id=p_sale_id AND status<>'CANCELLED';
 IF NOT EXISTS (SELECT 1 FROM public.financial_transactions WHERE reference_type='SALE' AND reference_id=p_sale_id AND type='EXPENSE') THEN
   INSERT INTO public.financial_transactions(store_id,type,category,description,amount,status,reference_type,reference_id,paid_at)
   VALUES(v_sale.store_id,'EXPENSE','Estornos','Estorno de venda '||v_sale.sale_number,v_sale.total,'PAID','SALE',p_sale_id,NOW());
 END IF;
 RETURN jsonb_build_object('success',true,'message','Venda cancelada e estoque restaurado.');
END; $$;

REVOKE EXECUTE ON FUNCTION public.cancel_sale(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_sale(UUID) TO authenticated;
