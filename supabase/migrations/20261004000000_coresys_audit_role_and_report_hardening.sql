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
-- Drop existing function first because changing return type (from boolean to jsonb) requires DROP in PostgreSQL
DROP FUNCTION IF EXISTS public.approve_physical_inventory(uuid, uuid);

CREATE OR REPLACE FUNCTION public.approve_physical_inventory(p_inventory_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_active boolean := false;
  v_role text;
  v_status text;
  v_store_id uuid;
  v_item record;
  v_before integer;
  v_diff integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;

  SELECT p.is_active INTO v_actor_active
  FROM public.profiles p
  WHERE p.id = v_actor;

  IF COALESCE(v_actor_active, false) = false THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;

  IF p_user_id IS NOT NULL AND p_user_id <> v_actor THEN
    RAISE EXCEPTION 'O usuário solicitante deve ser o mesmo usuário autenticado.';
  END IF;

  SELECT pi.status, pi.store_id INTO v_status, v_store_id
  FROM public.physical_inventories pi
  WHERE pi.id = p_inventory_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventário físico não encontrado.';
  END IF;

  IF v_status = 'COMPLETED' THEN
    RETURN jsonb_build_object('success', true, 'message', 'Inventário já concluído (idempotente).');
  END IF;

  IF v_status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Inventário não está em andamento.';
  END IF;

  v_role := public.get_user_store_role(v_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER') THEN
    RAISE EXCEPTION 'Permissão negada para aprovar inventário nesta loja.';
  END IF;

  FOR v_item IN
    SELECT pii.product_variant_id, pii.counted_quantity, pii.system_quantity
    FROM public.physical_inventory_items pii
    WHERE pii.inventory_id = p_inventory_id
    ORDER BY pii.product_variant_id
  LOOP
    SELECT si.quantity INTO v_before
    FROM public.store_inventory si
    WHERE si.store_id = v_store_id
      AND si.product_variant_id = v_item.product_variant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.store_inventory(store_id, product_variant_id, quantity, minimum_stock)
      VALUES(v_store_id, v_item.product_variant_id, 0, 0);
      v_before := 0;
    END IF;

    v_diff := v_item.counted_quantity - v_before;

    UPDATE public.store_inventory
    SET quantity = v_item.counted_quantity
    WHERE store_id = v_store_id
      AND product_variant_id = v_item.product_variant_id;

    UPDATE public.product_variants
    SET stock_quantity = (
      SELECT COALESCE(sum(si.quantity), 0)
      FROM public.store_inventory si
      WHERE si.product_variant_id = v_item.product_variant_id
    )
    WHERE id = v_item.product_variant_id;

    INSERT INTO public.inventory_movements(
      store_id, product_variant_id, type, quantity, quantity_before, quantity_after,
      reference_type, reference_id, user_id, notes, reason
    )
    VALUES(
      v_store_id, v_item.product_variant_id, 'ADJUSTMENT', abs(v_diff), v_before, v_item.counted_quantity,
      'PHYSICAL_INVENTORY', p_inventory_id, v_actor,
      'Ajuste de inventário físico #' || p_inventory_id::text, 'Aprovação de Inventário Físico'
    );
  END LOOP;

  UPDATE public.physical_inventories
  SET status = 'COMPLETED',
      approved_by = v_actor,
      updated_at = now()
  WHERE id = p_inventory_id;

  RETURN jsonb_build_object('success', true, 'message', 'Inventário físico aprovado e estoque ajustado com sucesso.');
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
  SELECT p.id, p.name, pv.id, pv.sku, si.quantity, pv.reserved_quantity, pv.minimum_stock,
         CASE WHEN si.quantity = 0 THEN 'OUT_OF_STOCK'
              WHEN si.quantity <= pv.minimum_stock THEN 'LOW_STOCK'
              ELSE 'OK' END
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
  SELECT im.type, sum(im.quantity)::bigint
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
