create or replace function public.export_customer_personal_data(
  p_store_id uuid,
  p_customer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_customer public.customers%rowtype;
  v_sales jsonb;
  v_returns jsonb;
  v_credits jsonb;
  v_result jsonb;
  v_record_count integer;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  if not public.has_store_access(p_store_id) then
    raise exception 'store access denied';
  end if;

  v_role := public.get_user_store_role(p_store_id);
  if v_role not in ('ADMIN', 'MANAGER') then
    raise exception 'personal data export requires ADMIN or MANAGER role';
  end if;

  select *
    into v_customer
  from public.customers
  where id = p_customer_id
    and store_id = p_store_id;

  if not found then
    raise exception 'customer not found in store';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'sale_number', s.sale_number,
      'subtotal', s.subtotal,
      'discount', s.discount,
      'total', s.total,
      'status', s.status,
      'created_at', s.created_at,
      'completed_at', s.completed_at,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'product_name', si.product_name,
          'variant_description', si.variant_description,
          'quantity', si.quantity,
          'unit_price', si.unit_price,
          'discount', si.discount,
          'total', si.total
        ) order by si.created_at)
        from public.sale_items si
        where si.sale_id = s.id
      ), '[]'::jsonb)
    )
    order by s.created_at
  ), '[]'::jsonb)
  into v_sales
  from public.sales s
  where s.store_id = p_store_id
    and s.customer_id = p_customer_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'return_number', r.return_number,
      'original_sale_id', r.original_sale_id,
      'resolution_type', r.resolution_type,
      'status', r.status,
      'total_amount', r.total_amount,
      'observations', r.observations,
      'expires_at', r.expires_at,
      'created_at', r.created_at,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'product_name', ri.product_name,
          'size', ri.size,
          'color', ri.color,
          'unit_price', ri.unit_price,
          'quantity', ri.quantity,
          'reason', ri.reason
        ) order by ri.created_at)
        from public.return_items ri
        where ri.return_id = r.id
      ), '[]'::jsonb)
    )
    order by r.created_at
  ), '[]'::jsonb)
  into v_returns
  from public.returns r
  where r.store_id = p_store_id
    and r.customer_id = p_customer_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', ccm.id,
      'type', ccm.type,
      'amount', ccm.amount,
      'description', ccm.description,
      'reference_type', ccm.reference_type,
      'reference_id', ccm.reference_id,
      'created_at', ccm.created_at
    )
    order by ccm.created_at
  ), '[]'::jsonb)
  into v_credits
  from public.customer_credit_movements ccm
  where ccm.store_id = p_store_id
    and ccm.customer_id = p_customer_id;

  v_result := jsonb_build_object(
    'generated_at', now(),
    'store_id', p_store_id,
    'customer', jsonb_build_object(
      'id', v_customer.id,
      'name', v_customer.name,
      'cpf', v_customer.cpf,
      'rg', v_customer.rg,
      'phone', v_customer.phone,
      'email', v_customer.email,
      'address', v_customer.address,
      'birth_date', v_customer.birth_date,
      'created_at', v_customer.created_at,
      'updated_at', v_customer.updated_at,
      'is_active', v_customer.is_active
    ),
    'sales', v_sales,
    'returns', v_returns,
    'credit_movements', v_credits
  );

  v_record_count :=
    jsonb_array_length(v_sales)
    + jsonb_array_length(v_returns)
    + jsonb_array_length(v_credits)
    + 1;

  perform public.log_data_export(
    p_store_id,
    'LGPD_TITULAR',
    'customer_personal_data',
    v_record_count,
    true,
    jsonb_build_object('customer_id', p_customer_id)
  );

  return v_result;
end;
$$;

revoke all on function public.export_customer_personal_data(uuid,uuid) from public;
revoke all on function public.export_customer_personal_data(uuid,uuid) from anon;
grant execute on function public.export_customer_personal_data(uuid,uuid) to authenticated;
grant execute on function public.export_customer_personal_data(uuid,uuid) to service_role;
