BEGIN;

-- Remove client access to legacy overloads that do not carry store scope.
REVOKE ALL ON FUNCTION public.complete_sale(uuid,text,text,jsonb,text,integer,numeric,numeric,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_profitability_by_category(date,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_profitability_by_product(date,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.report_inventory_movements_summary(timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.report_stock_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.report_top_selling_products(integer) FROM PUBLIC, anon, authenticated;

-- Privileged operations remain callable only through their current scoped RPCs.
REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_user_store_access(uuid,uuid,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_store_access(uuid,uuid,text,boolean) TO authenticated;

-- Protect the sensitive product cost from direct API reads by signed-in users.
REVOKE SELECT (cost_price) ON public.products FROM anon, authenticated;

-- Expose cost only through an authorization-checked management RPC.
CREATE OR REPLACE FUNCTION public.get_product_for_management(p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_product jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Autenticação obrigatória.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_uid AND is_active=true) THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;
  v_role := public.current_user_role();
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER') THEN
    RAISE EXCEPTION 'Permissão negada.';
  END IF;
  IF p_product_id IS NULL THEN RAISE EXCEPTION 'Produto obrigatório.'; END IF;

  SELECT jsonb_build_object(
    'id',p.id,'brand_id',p.brand_id,'category_id',p.category_id,'name',p.name,
    'description',p.description,'cost_price',p.cost_price,'sale_price',p.sale_price,
    'minimum_stock',p.minimum_stock,'is_active',p.is_active,'image_url',p.image_url,
    'created_at',p.created_at,'updated_at',p.updated_at,
    'brands',CASE WHEN b.id IS NULL THEN NULL ELSE jsonb_build_object('id',b.id,'name',b.name) END,
    'categories',CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('id',c.id,'name',c.name) END,
    'product_variants',COALESCE((SELECT jsonb_agg(to_jsonb(pv) ORDER BY pv.sku) FROM public.product_variants pv WHERE pv.product_id=p.id),'[]'::jsonb)
  ) INTO v_product
  FROM public.products p
  LEFT JOIN public.brands b ON b.id=p.brand_id
  LEFT JOIN public.categories c ON c.id=p.category_id
  WHERE p.id=p_product_id;

  IF v_product IS NULL THEN RAISE EXCEPTION 'Produto não encontrado.'; END IF;
  RETURN v_product;
END;
$$;

REVOKE ALL ON FUNCTION public.get_product_for_management(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_product_for_management(uuid) TO authenticated;

COMMIT;