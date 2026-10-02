do $$
declare
  v_store_id uuid;
  v_store_count integer;
begin
  select count(*), (array_agg(id))[1]
    into v_store_count, v_store_id
  from public.stores
  where is_active=true;

  if v_store_count <> 1 then
    raise exception 'Expected exactly one active store for safe customer backfill; found %', v_store_count;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='customers'
      and column_name='store_id'
  ) then
    alter table public.customers add column store_id uuid;
  end if;

  update public.customers set store_id=v_store_id where store_id is null;

  alter table public.customers drop constraint if exists customers_store_id_fkey;
  alter table public.customers
    add constraint customers_store_id_fkey
    foreign key (store_id) references public.stores(id) on delete restrict;
  alter table public.customers alter column store_id set not null;
end
$$;

drop policy if exists "Customers manageable by Admin Manager Cashier" on public.customers;
drop policy if exists "Customers viewable by store access" on public.customers;
drop policy if exists "Customers insertable by store roles" on public.customers;
drop policy if exists "Customers updatable by store roles" on public.customers;
drop policy if exists "Customers deletable by store admin" on public.customers;

create policy "Customers viewable by store access"
on public.customers for select to authenticated
using (has_store_access(store_id));

create policy "Customers insertable by store roles"
on public.customers for insert to authenticated
with check (get_user_store_role(store_id) = any(array['ADMIN','MANAGER','CASHIER']));

create policy "Customers updatable by store roles"
on public.customers for update to authenticated
using (get_user_store_role(store_id) = any(array['ADMIN','MANAGER','CASHIER']))
with check (get_user_store_role(store_id) = any(array['ADMIN','MANAGER','CASHIER']));

create policy "Customers deletable by store admin"
on public.customers for delete to authenticated
using (get_user_store_role(store_id) = 'ADMIN');

revoke select on public.products from authenticated;
grant select(id,brand_id,category_id,name,description,sale_price,minimum_stock,is_active,image_url,created_at,updated_at)
  on public.products to authenticated;
revoke select(cost_price) on public.products from authenticated, anon;
revoke all on public.product_costs from anon;
grant select on public.product_costs to authenticated;
