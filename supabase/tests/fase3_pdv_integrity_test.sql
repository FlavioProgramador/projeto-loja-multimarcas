begin;
select plan(8);

select ok(
  position('group by x.variant_id' in pg_get_functiondef('public.process_return(uuid,uuid,uuid,text,text,jsonb,text,text)'::regprocedure)) > 0,
  'process_return consolida itens repetidos por variação'
);
select ok(
  position('v_returned_qty' in pg_get_functiondef('public.process_return(uuid,uuid,uuid,text,text,jsonb,text,text)'::regprocedure)) > 0,
  'process_return considera devoluções anteriores'
);
select ok(
  position('v_item.quantity>v_available_qty' in replace(pg_get_functiondef('public.process_return(uuid,uuid,uuid,text,text,jsonb,text,text)'::regprocedure),' ','')) > 0,
  'process_return bloqueia quantidade acima do saldo disponível'
);
select ok(
  position('for update' in lower(pg_get_functiondef('public.process_return(uuid,uuid,uuid,text,text,jsonb,text,text)'::regprocedure))) > 0,
  'process_return mantém locks transacionais'
);

select is((select count(*) from public.store_inventory where quantity < 0), 0::bigint, 'estoque por loja não está negativo');
select is((select count(*) from public.product_variants pv join public.store_inventory si on si.product_variant_id=pv.id where pv.stock_quantity <> (select coalesce(sum(si2.quantity),0) from public.store_inventory si2 where si2.product_variant_id=pv.id)), 0::bigint, 'stock_quantity agregado está reconciliado');
select is((select count(*) from public.sales s join public.payments p on p.sale_id=s.id where s.status='COMPLETED' and p.status<>'APPROVED'), 0::bigint, 'vendas concluídas possuem pagamento aprovado');
select is((select count(*) from public.sales s join public.financial_transactions f on f.reference_type='SALE' and f.reference_id=s.id where s.status='COMPLETED' and f.type='INCOME' and f.status='PAID' and f.amount<>s.total), 0::bigint, 'receita paga de venda coincide com o total da venda');

select * from finish();
rollback;
