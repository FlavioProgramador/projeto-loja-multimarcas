-- CoreSys Audit Hardening & Reconciliation Migration
-- Date: 2026-10-03
-- Scope: Remediate findings related to physical_inventory authorization, report multi-tenant store isolation, and fail-closed security guards.

BEGIN;

-- 1) Harden approve_physical_inventory with strict auth & store role validation
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
    RAISE EXCEPTION 'Usuário de aprovação inválido ou divergente do usuário autenticado.';
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

  SELECT pi.status, pi.store_id
    INTO v_status, v_store_id
  FROM public.physical_inventories pi
  WHERE pi.id = p_inventory_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventário não encontrado.';
  END IF;

  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'Inventário sem loja associada.';
  END IF;

  SELECT s.is_active INTO v_store_active
  FROM public.stores s
  WHERE s.id = v_store_id;

  IF COALESCE(v_store_active, false) = false THEN
    RAISE EXCEPTION 'Loja do inventário é inválida ou está inativa.';
  END IF;

  v_role := public.get_user_store_role(v_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER') THEN
    RAISE EXCEPTION 'Permissão negada para aprovar inventário nesta loja.';
  END IF;

  IF v_status = 'APPROVED' THEN
    RETURN true;
  END IF;

  IF v_status <> 'OPEN' THEN
    RAISE EXCEPTION 'Apenas inventários OPEN podem ser aprovados.';
  END IF;

  SELECT count(*)::integer INTO v_item_count
  FROM public.physical_inventory_items
  WHERE inventory_id = p_inventory_id;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Inventário não possui itens para aprovação.';
  END IF;

  SELECT count(*)::integer INTO v_incomplete_count
  FROM public.physical_inventory_items
  WHERE inventory_id = p_inventory_id
    AND (counted_quantity IS NULL OR counted_quantity < 0);

  IF v_incomplete_count > 0 THEN
    RAISE EXCEPTION 'Existem itens com contagem pendente ou inválida.';
  END IF;

  FOR v_item IN
    SELECT pii.product_variant_id, pii.counted_quantity
    FROM public.physical_inventory_items pii
    WHERE pii.inventory_id = p_inventory_id
    ORDER BY pii.product_variant_id
  LOOP
    SELECT quantity INTO v_before
    FROM public.store_inventory
    WHERE store_id = v_store_id AND product_variant_id = v_item.product_variant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.store_inventory(store_id, product_variant_id, quantity, minimum_stock)
      VALUES(v_store_id, v_item.product_variant_id, 0, 0);
      v_before := 0;
    END IF;

    v_divergence := v_item.counted_quantity - v_before;
    v_after := v_item.counted_quantity;

    IF v_divergence <> 0 THEN
      UPDATE public.store_inventory
      SET quantity = v_after
      WHERE store_id = v_store_id AND product_variant_id = v_item.product_variant_id;

      INSERT INTO public.inventory_movements(
        store_id, product_variant_id, type, quantity, quantity_before, quantity_after,
        reference_type, reference_id, user_id, notes, reason
      )
      VALUES(
        v_store_id, v_item.product_variant_id,
        CASE WHEN v_divergence > 0 THEN 'INVENTORY_ADJUSTMENT_IN' ELSE 'INVENTORY_ADJUSTMENT_OUT' END,
        abs(v_divergence), v_before, v_after,
        'PHYSICAL_INVENTORY', p_inventory_id, v_actor,
        'Ajuste por inventário físico aprovado', 'Inventário Físico'
      );

      UPDATE public.product_variants pv
      SET stock_quantity = (
        SELECT COALESCE(sum(si.quantity), 0)
        FROM public.store_inventory si
        WHERE si.product_variant_id = pv.id
      )
      WHERE pv.id = v_item.product_variant_id;
    END IF;
  END LOOP;

  UPDATE public.physical_inventories
  SET status = 'APPROVED',
      approved_by = v_actor,
      updated_at = now()
  WHERE id = p_inventory_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_physical_inventory(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_physical_inventory(uuid,uuid) TO authenticated;
ALTER FUNCTION public.approve_physical_inventory(uuid,uuid) SET search_path = public;

-- 2) Ensure physical_inventories immutable identity trigger & RLS update policy
CREATE OR REPLACE FUNCTION public.prevent_physical_inventory_identity_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.store_id IS DISTINCT FROM NEW.store_id
     OR OLD.created_by IS DISTINCT FROM NEW.created_by THEN
    RAISE EXCEPTION 'store_id e created_by de inventário físico são imutáveis.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_physical_inventory_identity_change ON public.physical_inventories;
CREATE TRIGGER trg_prevent_physical_inventory_identity_change
BEFORE UPDATE ON public.physical_inventories
FOR EACH ROW
EXECUTE FUNCTION public.prevent_physical_inventory_identity_change();

DROP POLICY IF EXISTS "Physical inventories update by store managers" ON public.physical_inventories;
CREATE POLICY "Physical inventories update by store managers"
ON public.physical_inventories
FOR UPDATE TO authenticated
USING (
  store_id IS NOT NULL
  AND public.get_user_store_role(store_id) IN ('ADMIN','MANAGER')
)
WITH CHECK (
  store_id IS NOT NULL
  AND public.get_user_store_role(store_id) IN ('ADMIN','MANAGER')
);

-- 3) Harden report_stock_status
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

REVOKE ALL ON FUNCTION public.report_stock_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_stock_status(uuid) TO authenticated;
ALTER FUNCTION public.report_stock_status(uuid) SET search_path = public;

-- 4) Harden report_top_selling_products
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

REVOKE ALL ON FUNCTION public.report_top_selling_products(integer,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_top_selling_products(integer,uuid) TO authenticated;
ALTER FUNCTION public.report_top_selling_products(integer,uuid) SET search_path = public;

-- 5) Harden report_inventory_movements_summary
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

REVOKE ALL ON FUNCTION public.report_inventory_movements_summary(timestamptz,timestamptz,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_inventory_movements_summary(timestamptz,timestamptz,uuid) TO authenticated;
ALTER FUNCTION public.report_inventory_movements_summary(timestamptz,timestamptz,uuid) SET search_path = public;

-- 6) Harden get_profitability_by_product
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
    AND (start_date IS NULL OR s.completed_at::date >= start_date)
    AND (end_date IS NULL OR s.completed_at::date <= end_date)
  GROUP BY p.id, p.name, p.category_id
  ORDER BY margin_value DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_profitability_by_product(uuid,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profitability_by_product(uuid,date,date) TO authenticated;
ALTER FUNCTION public.get_profitability_by_product(uuid,date,date) SET search_path = public;

-- 7) Harden get_profitability_by_category
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
  SELECT c.id, c.name, sum(si.quantity)::bigint, sum(si.total), sum(si.quantity * p.cost_price),
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

REVOKE ALL ON FUNCTION public.get_profitability_by_category(uuid,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profitability_by_category(uuid,date,date) TO authenticated;
ALTER FUNCTION public.get_profitability_by_category(uuid,date,date) SET search_path = public;

COMMIT;
