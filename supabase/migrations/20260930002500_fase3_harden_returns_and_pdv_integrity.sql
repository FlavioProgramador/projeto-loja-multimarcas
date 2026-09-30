-- Fase 3: integridade de devoluções e PDV.
-- Consolida itens repetidos por variação antes de validar limites.
create or replace function public.process_return(
  p_store_id uuid,
  p_original_sale_id uuid,
  p_customer_id uuid default null,
  p_customer_name text default null,
  p_customer_cpf text default null,
  p_items jsonb default '[]'::jsonb,
  p_resolution_type text default 'credito_cliente',
  p_observations text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
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
  v_total numeric(12,2) := 0;
  v_customer_id uuid := p_customer_id;
  v_unit_price numeric(12,2);
  v_product_id uuid;
  v_size text;
  v_color text;
begin
  select is_active into v_profile_active from public.profiles where id=v_user;
  if v_user is null or not coalesce(v_profile_active,false) then raise exception 'Perfil autenticado inexistente ou inativo.'; end if;
  if p_store_id is null or not exists(select 1 from public.stores where id=p_store_id and is_active=true) then raise exception 'Loja inválida ou inativa.'; end if;
  v_role := public.get_user_store_role(p_store_id);
  if v_role is null or v_role not in ('ADMIN','MANAGER','CASHIER') then raise exception 'Permissão negada.'; end if;
  if p_original_sale_id is null then raise exception 'A devolução deve estar vinculada a uma venda original.'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then raise exception 'Nenhum item informado para devolução.'; end if;
  if p_resolution_type not in ('credito_cliente','vale_troca','estorno_dinheiro') then raise exception 'Forma de resolução inválida.'; end if;
  select * into v_sale from public.sales where id=p_original_sale_id and store_id=p_store_id for update;
  if not found then raise exception 'Venda original não encontrada nesta loja.'; end if;
  if v_sale.status <> 'COMPLETED' then raise exception 'Somente vendas concluídas podem ter devolução.'; end if;
  if v_customer_id is not null and not exists(select 1 from public.customers where id=v_customer_id and is_active=true) then raise exception 'Cliente inválido ou inativo.'; end if;
  if v_customer_id is null then v_customer_id := v_sale.customer_id; end if;
  if v_customer_id is null and nullif(trim(p_customer_cpf),'') is not null then select id into v_customer_id from public.customers where cpf=trim(p_customer_cpf) and is_active=true limit 1; end if;
  if v_customer_id is null and p_resolution_type in ('credito_cliente','vale_troca') then raise exception 'Crédito ou vale-troca exige um cliente identificado.'; end if;
  for v_item in
    select x.variant_id, sum(x.quantity)::integer quantity,
           max(x.product_name) product_name, max(x.size) size,
           max(x.color) color, max(x.reason) reason
    from jsonb_to_recordset(p_items) x(
      variant_id uuid, quantity integer, product_name text,
      size text, color text, reason text
    )
    group by x.variant_id order by x.variant_id
  loop
    if v_item.variant_id is null or v_item.quantity is null or v_item.quantity<=0 then raise exception 'Item de devolução inválido.'; end if;
    select coalesce(sum(si.quantity),0) into v_sold_qty from public.sale_items si
      where si.sale_id=p_original_sale_id and si.product_variant_id=v_item.variant_id;
    select coalesce(sum(ri.quantity),0) into v_returned_qty
      from public.return_items ri join public.returns r on r.id=ri.return_id
      where r.original_sale_id=p_original_sale_id and r.status='CONCLUIDO'
        and ri.product_variant_id=v_item.variant_id;
    v_available_qty := v_sold_qty-v_returned_qty;
    if v_sold_qty=0 then raise exception 'A variação informada não pertence à venda original.'; end if;
    if v_available_qty<0 or v_item.quantity>v_available_qty then
      raise exception 'Quantidade devolvida excede a quantidade ainda disponível para devolução.';
    end if;
    select si.unit_price,si.product_id,pv.size,pv.color into v_unit_price,v_product_id,v_size,v_color
      from public.sale_items si join public.product_variants pv on pv.id=si.product_variant_id
      where si.sale_id=p_original_sale_id and si.product_variant_id=v_item.variant_id
      order by si.created_at limit 1;
    v_total := v_total+(v_unit_price*v_item.quantity);
    select quantity into v_stock_before from public.store_inventory
      where store_id=p_store_id and product_variant_id=v_item.variant_id for update;
    if not found then
      insert into public.store_inventory(store_id,product_variant_id,quantity,minimum_stock)
      values(p_store_id,v_item.variant_id,0,0); v_stock_before:=0;
    end if;
  end loop;
  v_return_number := 'DEV-'||nextval('sale_number_seq')::text;
  insert into public.returns(return_number,original_sale_id,customer_id,customer_name,customer_cpf,
    resolution_type,status,total_amount,observations,expires_at,created_by,store_id)
  values(v_return_number,p_original_sale_id,v_customer_id,
    coalesce(nullif(trim(p_customer_name),''),v_sale.customer_name,'Consumidor Final'),
    coalesce(nullif(trim(p_customer_cpf),''),v_sale.customer_cpf),p_resolution_type,
    'CONCLUIDO',round(v_total,2),p_observations,current_date+interval '30 days',v_user,p_store_id)
  returning id into v_return_id;
  for v_item in
    select x.variant_id, sum(x.quantity)::integer quantity,
           max(x.product_name) product_name, max(x.size) size,
           max(x.color) color, max(x.reason) reason
    from jsonb_to_recordset(p_items) x(
      variant_id uuid, quantity integer, product_name text,
      size text, color text, reason text
    )
    group by x.variant_id order by x.variant_id
  loop
    select si.unit_price,si.product_id,pv.size,pv.color into v_unit_price,v_product_id,v_size,v_color
      from public.sale_items si join public.product_variants pv on pv.id=si.product_variant_id
      where si.sale_id=p_original_sale_id and si.product_variant_id=v_item.variant_id
      order by si.created_at limit 1;
    select quantity into v_stock_before from public.store_inventory
      where store_id=p_store_id and product_variant_id=v_item.variant_id for update;
    insert into public.return_items(return_id,product_id,product_variant_id,product_name,size,color,unit_price,quantity,reason)
    values(v_return_id,v_product_id,v_item.variant_id,coalesce(nullif(v_item.product_name,''),'Produto'),
      coalesce(nullif(v_item.size,''),v_size,'Único'),coalesce(nullif(v_item.color,''),v_color,'Padrão'),
      v_unit_price,v_item.quantity,coalesce(nullif(v_item.reason,''),'Devolução'));
    update public.store_inventory set quantity=quantity+v_item.quantity
      where store_id=p_store_id and product_variant_id=v_item.variant_id;
    insert into public.inventory_movements(store_id,product_variant_id,type,quantity,quantity_before,quantity_after,
      reference_type,reference_id,user_id,notes,reason)
    values(p_store_id,v_item.variant_id,'RETURN',v_item.quantity,v_stock_before,v_stock_before+v_item.quantity,
      'RETURN',v_return_id,v_user,'Devolução '||v_return_number,coalesce(v_item.reason,'Devolução'));
    update public.product_variants set stock_quantity=(select coalesce(sum(quantity),0)
      from public.store_inventory where product_variant_id=v_item.variant_id)
      where id=v_item.variant_id;
  end loop;
  if p_resolution_type in ('credito_cliente','vale_troca') then
    insert into public.customer_credit_movements(store_id,customer_id,type,amount,description,reference_type,reference_id)
    values(p_store_id,v_customer_id,'CREDIT',round(v_total,2),
      case when p_resolution_type='vale_troca' then 'Vale-troca gerado pela devolução ' else 'Crédito gerado pela devolução ' end||v_return_number,
      'RETURN',v_return_id);
    insert into public.financial_transactions(store_id,type,category,description,amount,status,reference_type,reference_id,paid_at)
    values(p_store_id,'EXPENSE','Créditos de devolução','Crédito/vale emitido na devolução '||v_return_number,
      round(v_total,2),'PAID','RETURN',v_return_id,now());
  else
    insert into public.financial_transactions(store_id,type,category,description,amount,status,reference_type,reference_id,paid_at)
    values(p_store_id,'EXPENSE','Estornos','Estorno em dinheiro da devolução '||v_return_number,
      round(v_total,2),'PAID','RETURN',v_return_id,now());
  end if;
  return jsonb_build_object('success',true,'return_id',v_return_id,'return_number',v_return_number,'total',round(v_total,2));
end;
$function$;

comment on function public.process_return(uuid,uuid,uuid,text,text,jsonb,text,text)
is 'Processa devoluções consolidando itens por variação e validando o limite total disponível antes da mutação.';
