-- CoreSys Audit Security & Backend Hardening Migration
-- Date: 2026-10-04
-- Scope: Remediate findings from SUPABASE_REANALISE_2026-09-28 & CoreSys Backend Security Audit
-- Key fixes:
-- 1) Explicit fail-closed role checks (v_role IS NULL OR v_role NOT IN (...))
-- 2) Strict search_path = public on all SECURITY DEFINER functions
-- 3) Multi-tenant store_id and access validation on report RPCs
-- 4) Fail-closed actor validation on approve_physical_inventory

BEGIN;

-- 1) Revoke legacy complete_sale signature without store_id
DO $$
BEGIN
  IF to_regprocedure('public.complete_sale(uuid,text,text,jsonb,text,integer,numeric,numeric,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.complete_sale(uuid,text,text,jsonb,text,integer,numeric,numeric,text) FROM PUBLIC, anon, authenticated';
  END IF;
END $$;

-- 2) Harden approve_physical_inventory with strict actor validation & fail-closed role check
CREATE OR REPLACE FUNCTION public.approve_physical_inventory(p_inventory_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_profile_active boolean := false;
  v_store_id uuid;
  v_store_active boolean := false;
  v_role text;
  v_status text;
  v_item_count integer := 0;
  v_incomplete_count integer := 0;
  v_item record;
  v_before integer;
  v_divergence integer;
  v_after integer;
BEGIN
  IF v_actor IS NULL OR p_user_id IS NULL OR p_user_id <> v_actor THEN
    RAISE EXCEPTION 'Usuário de aprovação inválido.';
  END IF;

  SELECT p.is_active INTO v_profile_active
  FROM public.profiles p
  WHERE p.id = v_actor;

  IF COALESCE(v_profile_active, false) = false THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;

  IF p_inventory_id IS NULL THEN
    RAISE EXCEPTION 'Inventário é obrigatório.';
  END IF;

  SELECT pi.status, pi.store_id INTO v_status, v_store_id
  FROM public.physical_inventories pi
  WHERE pi.id = p_inventory_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventário não encontrado.';
  END IF;

  SELECT s.is_active INTO v_store_active
  FROM public.stores s
  WHERE s.id = v_store_id;

  IF COALESCE(v_store_active, false) = false THEN
    RAISE EXCEPTION 'Loja inválida ou inativa.';
  END IF;

  v_role := public.get_user_store_role(v_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER') THEN
    RAISE EXCEPTION 'Permissão negada para aprovar inventário.';
  END IF;

  IF v_status = 'APPROVED' THEN
    RETURN true;
  END IF;

  IF v_status <> 'OPEN' THEN
    RAISE EXCEPTION 'Apenas inventários OPEN podem ser aprovados.';
  END IF;

  SELECT count(*),
         count(*) FILTER (
           WHERE product_variant_id IS NULL
              OR expected_quantity < 0
              OR counted_quantity < 0
              OR counted_quantity IS NULL
         )
    INTO v_item_count, v_incomplete_count
  FROM public.physical_inventory_items
  WHERE inventory_id = p_inventory_id;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Inventário sem itens não pode ser aprovado.';
  END IF;

  IF v_incomplete_count > 0 THEN
    RAISE EXCEPTION 'Inventário contém itens incompletos ou inválidos.';
  END IF;

  FOR v_item IN
    SELECT product_variant_id, expected_quantity, counted_quantity, reason
    FROM public.physical_inventory_items
    WHERE inventory_id = p_inventory_id
    ORDER BY product_variant_id
    FOR UPDATE
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.product_variants pv
      JOIN public.products p ON p.id = pv.product_id
      WHERE pv.id = v_item.product_variant_id
        AND pv.is_active = true
        AND p.is_active = true
    ) THEN
      RAISE EXCEPTION 'Variação inválida no inventário.';
    END IF;

    SELECT quantity INTO v_before
    FROM public.store_inventory
    WHERE store_id = v_store_id AND product_variant_id = v_item.product_variant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.store_inventory(store_id, product_variant_id, quantity, minimum_stock)
      VALUES(v_store_id, v_item.product_variant_id, 0, 0);
      v_before := 0;
    END IF;

    v_divergence := v_item.counted_quantity - v_item.expected_quantity;
    v_after := v_item.counted_quantity;

    IF v_divergence <> 0 THEN
      UPDATE public.store_inventory
      SET quantity = v_after
      WHERE store_id = v_store_id AND product_variant_id = v_item.product_variant_id;

      INSERT INTO public.inventory_movements(
        store_id, product_variant_id, type, quantity, quantity_before,
        quantity_after, reference_type, reference_id, user_id, reason, notes
      )
      VALUES(
        v_store_id, v_item.product_variant_id, 'ADJUSTMENT', v_divergence,
        v_before, v_after, 'INVENTORY', p_inventory_id, v_actor,
        COALESCE(v_item.reason, 'Ajuste de inventário físico'),
        'Ajuste de inventário físico'
      );
    END IF;

    UPDATE public.product_variants pv
    SET stock_quantity = (
      SELECT COALESCE(sum(si.quantity), 0)
      FROM public.store_inventory si
      WHERE si.product_variant_id = pv.id
    )
    WHERE pv.id = v_item.product_variant_id;
  END LOOP;

  UPDATE public.physical_inventories
  SET status = 'APPROVED', approved_by = v_actor, updated_at = now()
  WHERE id = p_inventory_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_physical_inventory(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_physical_inventory(uuid,uuid) TO authenticated;
ALTER FUNCTION public.approve_physical_inventory(uuid,uuid) SET search_path = public;

-- 3) Harden report_stock_status, report_top_selling_products, report_inventory_movements_summary,
--    get_profitability_by_product, and get_profitability_by_category with store validation and fail-closed roles
DROP FUNCTION IF EXISTS public.report_stock_status(uuid);
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
DECLARE
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;

  IF p_store_id IS NULL THEN
    RAISE EXCEPTION 'Loja obrigatória.';
  END IF;

  v_role := public.get_user_store_role(p_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER','CASHIER','EMPLOYEE') THEN
    RAISE EXCEPTION 'Acesso negado à loja.';
  END IF;

  RETURN QUERY
  SELECT p.id AS product_id,
         p.name AS product_name,
         pv.id AS variant_id,
         pv.sku AS variant_sku,
         si.quantity AS stock_quantity,
         pv.reserved_quantity,
         pv.minimum_stock,
         CASE WHEN si.quantity = 0 THEN 'OUT_OF_STOCK'
              WHEN si.quantity <= pv.minimum_stock THEN 'LOW_STOCK'
              ELSE 'OK' END AS status
  FROM public.products p
  JOIN public.product_variants pv ON pv.product_id = p.id
  JOIN public.store_inventory si ON si.product_variant_id = pv.id AND si.store_id = p_store_id
  WHERE p.is_active = true AND pv.is_active = true
  ORDER BY CASE WHEN si.quantity = 0 THEN 1
                WHEN si.quantity <= pv.minimum_stock THEN 2
                ELSE 3 END,
           si.quantity;
END;
$$;

DROP FUNCTION IF EXISTS public.report_top_selling_products(integer,uuid);
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
DECLARE
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;

  IF p_store_id IS NULL THEN
    RAISE EXCEPTION 'Loja obrigatória.';
  END IF;

  v_role := public.get_user_store_role(p_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER','CASHIER') THEN
    RAISE EXCEPTION 'Acesso negado à loja.';
  END IF;

  IF COALESCE(p_limit, 0) < 1 OR COALESCE(p_limit, 0) > 100 THEN
    RAISE EXCEPTION 'Limite inválido.';
  END IF;

  RETURN QUERY
  SELECT p.id AS product_id,
         p.name AS product_name,
         sum(si.quantity)::bigint AS total_quantity_sold,
         sum(si.total)::numeric AS total_revenue
  FROM public.sale_items si
  JOIN public.sales s ON s.id = si.sale_id
  JOIN public.products p ON p.id = si.product_id
  WHERE s.store_id = p_store_id AND s.status = 'COMPLETED'
  GROUP BY p.id, p.name
  ORDER BY total_quantity_sold DESC
  LIMIT p_limit;
END;
$$;

DROP FUNCTION IF EXISTS public.report_inventory_movements_summary(timestamptz,timestamptz,uuid);
CREATE OR REPLACE FUNCTION public.report_inventory_movements_summary(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_store_id uuid
)
RETURNS TABLE(
  movement_type text,
  total_quantity bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;

  IF p_store_id IS NULL THEN
    RAISE EXCEPTION 'Loja obrigatória.';
  END IF;

  v_role := public.get_user_store_role(p_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER') THEN
    RAISE EXCEPTION 'Acesso negado à loja.';
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Período inválido.';
  END IF;

  RETURN QUERY
  SELECT im.type AS movement_type,
         sum(im.quantity)::bigint AS total_quantity
  FROM public.inventory_movements im
  WHERE im.store_id = p_store_id
    AND im.created_at >= p_start_date
    AND im.created_at <= p_end_date
  GROUP BY im.type
  ORDER BY total_quantity DESC;
END;
$$;

DROP FUNCTION IF EXISTS public.get_profitability_by_product(uuid,date,date);
CREATE OR REPLACE FUNCTION public.get_profitability_by_product(
  p_store_id uuid,
  start_date date,
  end_date date
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
DECLARE
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;

  IF p_store_id IS NULL THEN
    RAISE EXCEPTION 'Loja obrigatória.';
  END IF;

  v_role := public.get_user_store_role(p_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER') THEN
    RAISE EXCEPTION 'Acesso negado à loja.';
  END IF;

  RETURN QUERY
  SELECT p.id AS product_id,
         p.name AS product_name,
         p.category_id,
         sum(si.quantity)::bigint AS total_quantity,
         sum(si.total) AS total_revenue,
         sum(si.quantity * p.cost_price) AS total_cost,
         sum(si.total) - sum(si.quantity * p.cost_price) AS margin_value,
         CASE WHEN sum(si.total) > 0
              THEN ((sum(si.total) - sum(si.quantity * p.cost_price)) / sum(si.total)) * 100
              ELSE 0 END AS margin_percentage
  FROM public.sale_items si
  JOIN public.sales s ON s.id = si.sale_id
  JOIN public.products p ON p.id = si.product_id
  WHERE s.store_id = p_store_id
    AND s.status = 'COMPLETED'
    AND (start_date IS NULL OR s.completed_at::date >= start_date)
    AND (end_date IS NULL OR s.completed_at::date <= end_date)
  GROUP BY p.id, p.name, p.category_id
  ORDER BY margin_value DESC;
END;
$$;

DROP FUNCTION IF EXISTS public.get_profitability_by_category(uuid,date,date);
CREATE OR REPLACE FUNCTION public.get_profitability_by_category(
  p_store_id uuid,
  start_date date,
  end_date date
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
DECLARE
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;

  IF p_store_id IS NULL THEN
    RAISE EXCEPTION 'Loja obrigatória.';
  END IF;

  v_role := public.get_user_store_role(p_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER') THEN
    RAISE EXCEPTION 'Acesso negado à loja.';
  END IF;

  RETURN QUERY
  SELECT c.id AS category_id,
         COALESCE(c.name, 'Sem Categoria') AS category_name,
         sum(si.quantity)::bigint AS total_quantity,
         sum(si.total) AS total_revenue,
         sum(si.quantity * p.cost_price) AS total_cost,
         sum(si.total) - sum(si.quantity * p.cost_price) AS margin_value,
         CASE WHEN sum(si.total) > 0
              THEN ((sum(si.total) - sum(si.quantity * p.cost_price)) / sum(si.total)) * 100
              ELSE 0 END AS margin_percentage
  FROM public.sale_items si
  JOIN public.sales s ON s.id = si.sale_id
  JOIN public.products p ON p.id = si.product_id
  LEFT JOIN public.categories c ON c.id = p.category_id
  WHERE s.store_id = p_store_id
    AND s.status = 'COMPLETED'
    AND (start_date IS NULL OR s.completed_at::date >= start_date)
    AND (end_date IS NULL OR s.completed_at::date <= end_date)
  GROUP BY c.id, c.name
  ORDER BY margin_value DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.report_stock_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_stock_status(uuid) TO authenticated;
ALTER FUNCTION public.report_stock_status(uuid) SET search_path = public;

REVOKE ALL ON FUNCTION public.report_top_selling_products(integer,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_top_selling_products(integer,uuid) TO authenticated;
ALTER FUNCTION public.report_top_selling_products(integer,uuid) SET search_path = public;

REVOKE ALL ON FUNCTION public.report_inventory_movements_summary(timestamptz,timestamptz,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_inventory_movements_summary(timestamptz,timestamptz,uuid) TO authenticated;
ALTER FUNCTION public.report_inventory_movements_summary(timestamptz,timestamptz,uuid) SET search_path = public;

REVOKE ALL ON FUNCTION public.get_profitability_by_product(uuid,date,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_profitability_by_product(uuid,date,date) TO authenticated;
ALTER FUNCTION public.get_profitability_by_product(uuid,date,date) SET search_path = public;

REVOKE ALL ON FUNCTION public.get_profitability_by_category(uuid,date,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_profitability_by_category(uuid,date,date) TO authenticated;
ALTER FUNCTION public.get_profitability_by_category(uuid,date,date) SET search_path = public;

COMMIT;
