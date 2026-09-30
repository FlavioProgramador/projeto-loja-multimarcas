-- Audit Security Hardening: Report RPCs and Fail-Closed Functions
-- Date: 2026-10-01
-- Scope: Fix report RPCs to mandate store_id filtering, fail-closed auth checks, and explicit search_path

BEGIN;

-- 1) report_stock_status
CREATE OR REPLACE FUNCTION public.report_stock_status(p_store_id uuid)
RETURNS TABLE(
  product_id uuid,
  product_name text,
  variant_id uuid,
  variant_sku text,
  stock_quantity integer,
  reserved_quantity integer,
  minimum_stock integer,
  status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;
  IF public.current_user_role() IS NULL THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;
  IF p_store_id IS NULL OR NOT public.has_store_access(p_store_id) THEN
    RAISE EXCEPTION 'Acesso negado à loja.';
  END IF;

  RETURN QUERY
  SELECT p.id, p.name, pv.id, pv.sku, si.quantity, pv.reserved_quantity, pv.minimum_stock,
         CASE WHEN si.quantity = 0 THEN 'OUT_OF_STOCK'
              WHEN si.quantity <= pv.minimum_stock THEN 'LOW_STOCK'
              ELSE 'OK' END
  FROM public.products p
  JOIN public.product_variants pv ON pv.product_id = p.id
  JOIN public.store_inventory si
    ON si.product_variant_id = pv.id AND si.store_id = p_store_id
  WHERE p.is_active = true AND pv.is_active = true
  ORDER BY CASE WHEN si.quantity = 0 THEN 1
                WHEN si.quantity <= pv.minimum_stock THEN 2
                ELSE 3 END,
           si.quantity;
END;
$$;

REVOKE ALL ON FUNCTION public.report_stock_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_stock_status(uuid) TO authenticated;
ALTER FUNCTION public.report_stock_status(uuid) SET search_path = public;

-- 2) report_top_selling_products
CREATE OR REPLACE FUNCTION public.report_top_selling_products(p_limit integer, p_store_id uuid)
RETURNS TABLE(
  product_id uuid,
  product_name text,
  total_quantity_sold bigint,
  total_revenue numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;
  IF public.current_user_role() IS NULL THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;
  IF p_store_id IS NULL OR NOT public.has_store_access(p_store_id) THEN
    RAISE EXCEPTION 'Acesso negado à loja.';
  END IF;
  IF COALESCE(p_limit, 0) < 1 OR COALESCE(p_limit, 0) > 100 THEN
    RAISE EXCEPTION 'Limite inválido.';
  END IF;

  RETURN QUERY
  SELECT p.id, p.name, sum(si.quantity)::bigint, sum(si.total)::numeric
  FROM public.sale_items si
  JOIN public.sales s ON s.id = si.sale_id
  JOIN public.products p ON p.id = si.product_id
  WHERE s.store_id = p_store_id AND s.status = 'COMPLETED'
  GROUP BY p.id, p.name
  ORDER BY total_quantity_sold DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.report_top_selling_products(integer,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_top_selling_products(integer,uuid) TO authenticated;
ALTER FUNCTION public.report_top_selling_products(integer,uuid) SET search_path = public;

-- 3) report_inventory_movements_summary
CREATE OR REPLACE FUNCTION public.report_inventory_movements_summary(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_store_id uuid
)
RETURNS TABLE(movement_type text, total_quantity bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;
  IF public.current_user_role() IS NULL THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;
  IF p_store_id IS NULL OR NOT public.has_store_access(p_store_id) THEN
    RAISE EXCEPTION 'Acesso negado à loja.';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Período inválido.';
  END IF;

  RETURN QUERY
  SELECT im.type, sum(im.quantity)::bigint
  FROM public.inventory_movements im
  WHERE im.store_id = p_store_id
    AND im.created_at >= p_start_date
    AND im.created_at <= p_end_date
  GROUP BY im.type
  ORDER BY total_quantity DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.report_inventory_movements_summary(timestamptz,timestamptz,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_inventory_movements_summary(timestamptz,timestamptz,uuid) TO authenticated;
ALTER FUNCTION public.report_inventory_movements_summary(timestamptz,timestamptz,uuid) SET search_path = public;

-- 4) get_profitability_by_product
CREATE OR REPLACE FUNCTION public.get_profitability_by_product(
  p_store_id uuid,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS TABLE(
  product_id uuid,
  product_name text,
  category_id uuid,
  total_quantity bigint,
  total_revenue numeric,
  total_cost numeric,
  margin_value numeric,
  margin_percentage numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;
  IF public.current_user_role() IS NULL THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;
  IF p_store_id IS NULL OR NOT public.has_store_access(p_store_id) THEN
    RAISE EXCEPTION 'Acesso negado à loja.';
  END IF;

  RETURN QUERY
  SELECT p.id, p.name, p.category_id, sum(si.quantity)::bigint, sum(si.total), sum(si.quantity * p.cost_price),
         sum(si.total) - sum(si.quantity * p.cost_price),
         CASE WHEN sum(si.total) > 0
              THEN ((sum(si.total) - sum(si.quantity * p.cost_price)) / sum(si.total)) * 100
              ELSE 0 END
  FROM public.sale_items si
  JOIN public.sales s ON s.id = si.sale_id
  JOIN public.products p ON p.id = si.product_id
  WHERE s.store_id = p_store_id
    AND s.status = 'COMPLETED'
    AND (p_start_date IS NULL OR s.completed_at::date >= p_start_date)
    AND (p_end_date IS NULL OR s.completed_at::date <= p_end_date)
  GROUP BY p.id, p.name, p.category_id
  ORDER BY margin_value DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_profitability_by_product(uuid,date,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_profitability_by_product(uuid,date,date) TO authenticated;
ALTER FUNCTION public.get_profitability_by_product(uuid,date,date) SET search_path = public;

-- 5) get_profitability_by_category
CREATE OR REPLACE FUNCTION public.get_profitability_by_category(
  p_store_id uuid,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS TABLE(
  category_id uuid,
  category_name text,
  total_quantity bigint,
  total_revenue numeric,
  total_cost numeric,
  margin_value numeric,
  margin_percentage numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;
  IF public.current_user_role() IS NULL THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;
  IF p_store_id IS NULL OR NOT public.has_store_access(p_store_id) THEN
    RAISE EXCEPTION 'Acesso negado à loja.';
  END IF;

  RETURN QUERY
  SELECT c.id, COALESCE(c.name, 'Sem Categoria'), sum(si.quantity)::bigint, sum(si.total), sum(si.quantity * p.cost_price),
         sum(si.total) - sum(si.quantity * p.cost_price),
         CASE WHEN sum(si.total) > 0
              THEN ((sum(si.total) - sum(si.quantity * p.cost_price)) / sum(si.total)) * 100
              ELSE 0 END
  FROM public.sale_items si
  JOIN public.sales s ON s.id = si.sale_id
  JOIN public.products p ON p.id = si.product_id
  LEFT JOIN public.categories c ON c.id = p.category_id
  WHERE s.store_id = p_store_id
    AND s.status = 'COMPLETED'
    AND (p_start_date IS NULL OR s.completed_at::date >= p_start_date)
    AND (p_end_date IS NULL OR s.completed_at::date <= p_end_date)
  GROUP BY c.id, c.name
  ORDER BY margin_value DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_profitability_by_category(uuid,date,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_profitability_by_category(uuid,date,date) TO authenticated;
ALTER FUNCTION public.get_profitability_by_category(uuid,date,date) SET search_path = public;

COMMIT;
