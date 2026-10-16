-- Migration: 20261004000000_coresys_audit_remediation.sql
-- Description: CoreSys audit remediation migration addressing multi-tenant isolation in reports, fail-closed role validation, search_path enforcement, and SECURITY DEFINER RPC hardening.

BEGIN;

-- 1. Ensure report_stock_status filters strictly by p_store_id and checks store permissions fail-closed
DROP FUNCTION IF EXISTS public.report_stock_status(uuid);

CREATE OR REPLACE FUNCTION public.report_stock_status(p_store_id uuid)
RETURNS TABLE (
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
  v_user_id uuid := auth.uid();
  v_profile_active boolean;
  v_store_active boolean;
  v_role text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Acesso não autenticado.';
  END IF;

  SELECT is_active INTO v_profile_active FROM public.profiles WHERE id = v_user_id;
  IF COALESCE(v_profile_active, false) = false THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;

  IF p_store_id IS NULL THEN
    RAISE EXCEPTION 'Loja é obrigatória.';
  END IF;

  IF NOT public.has_store_access(p_store_id) THEN
    RAISE EXCEPTION 'Acesso negado à loja.';
  END IF;

  SELECT is_active INTO v_store_active FROM public.stores WHERE id = p_store_id;
  IF COALESCE(v_store_active, false) = false THEN
    RAISE EXCEPTION 'Loja inválida ou inativa.';
  END IF;

  v_role := upper(COALESCE(public.get_user_store_role(p_store_id), ''));
  IF v_role NOT IN ('ADMIN', 'MANAGER', 'CASHIER', 'STOCKIST', 'EMPLOYEE') THEN
    RAISE EXCEPTION 'Permissão negada para consultar estoque desta loja.';
  END IF;

  RETURN QUERY
  SELECT
    p.id AS product_id,
    p.name AS product_name,
    pv.id AS variant_id,
    pv.sku AS variant_sku,
    COALESCE(si.quantity, 0)::integer AS stock_quantity,
    COALESCE(pv.reserved_quantity, 0)::integer AS reserved_quantity,
    COALESCE(si.minimum_stock, pv.minimum_stock, 0)::integer AS minimum_stock,
    CASE
      WHEN COALESCE(si.quantity, 0) <= 0 THEN 'OUT_OF_STOCK'
      WHEN COALESCE(si.quantity, 0) <= COALESCE(si.minimum_stock, pv.minimum_stock, 0) THEN 'LOW_STOCK'
      ELSE 'OK'
    END AS status
  FROM public.store_inventory si
  JOIN public.product_variants pv ON pv.id = si.product_variant_id
  JOIN public.products p ON p.id = pv.product_id
  WHERE si.store_id = p_store_id
    AND pv.is_active = true
    AND p.is_active = true
  ORDER BY p.name, pv.sku;
END;
$$;

REVOKE ALL ON FUNCTION public.report_stock_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_stock_status(uuid) TO authenticated;
ALTER FUNCTION public.report_stock_status(uuid) SET search_path = public;


-- 2. Ensure report_top_selling_products filters strictly by p_store_id
DROP FUNCTION IF EXISTS public.report_top_selling_products(uuid, integer, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.report_top_selling_products(
  p_store_id uuid,
  p_limit integer DEFAULT 10,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
)
RETURNS TABLE (
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
  v_user_id uuid := auth.uid();
  v_profile_active boolean;
  v_store_active boolean;
  v_role text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Acesso não autenticado.';
  END IF;

  SELECT is_active INTO v_profile_active FROM public.profiles WHERE id = v_user_id;
  IF COALESCE(v_profile_active, false) = false THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;

  IF p_store_id IS NULL THEN
    RAISE EXCEPTION 'Loja é obrigatória.';
  END IF;

  IF NOT public.has_store_access(p_store_id) THEN
    RAISE EXCEPTION 'Acesso negado à loja.';
  END IF;

  SELECT is_active INTO v_store_active FROM public.stores WHERE id = p_store_id;
  IF COALESCE(v_store_active, false) = false THEN
    RAISE EXCEPTION 'Loja inválida ou inativa.';
  END IF;

  v_role := upper(COALESCE(public.get_user_store_role(p_store_id), ''));
  IF v_role NOT IN ('ADMIN', 'MANAGER', 'CASHIER', 'EMPLOYEE') THEN
    RAISE EXCEPTION 'Permissão negada para consultar relatórios desta loja.';
  END IF;

  RETURN QUERY
  SELECT
    si.product_id,
    si.product_name,
    SUM(si.quantity)::bigint AS total_quantity_sold,
    SUM(si.total)::numeric AS total_revenue
  FROM public.sale_items si
  JOIN public.sales s ON s.id = si.sale_id
  WHERE s.store_id = p_store_id
    AND s.status = 'COMPLETED'
    AND (p_start_date IS NULL OR s.completed_at >= p_start_date)
    AND (p_end_date IS NULL OR s.completed_at <= p_end_date)
  GROUP BY si.product_id, si.product_name
  ORDER BY total_quantity_sold DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 100);
END;
$$;

REVOKE ALL ON FUNCTION public.report_top_selling_products(uuid, integer, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_top_selling_products(uuid, integer, timestamptz, timestamptz) TO authenticated;
ALTER FUNCTION public.report_top_selling_products(uuid, integer, timestamptz, timestamptz) SET search_path = public;


-- 3. Ensure approve_physical_inventory strictly checks user identity and store permissions
DROP FUNCTION IF EXISTS public.approve_physical_inventory(uuid, uuid);

CREATE OR REPLACE FUNCTION public.approve_physical_inventory(p_inventory_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_inventory record;
  v_profile_active boolean;
  v_store_active boolean;
  v_role text;
  v_item record;
  v_stock_before integer;
  v_divergence integer;
BEGIN
  IF v_auth_uid IS NULL OR p_user_id IS NULL OR p_user_id <> v_auth_uid THEN
    RAISE EXCEPTION 'Usuário de aprovação inválido.';
  END IF;

  SELECT is_active INTO v_profile_active FROM public.profiles WHERE id = v_auth_uid;
  IF COALESCE(v_profile_active, false) = false THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;

  SELECT * INTO v_inventory FROM public.physical_inventories WHERE id = p_inventory_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventário não encontrado.';
  END IF;

  IF v_inventory.status NOT IN ('IN_PROGRESS', 'OPEN', 'DRAFT') THEN
    RAISE EXCEPTION 'Apenas inventários em andamento ou rascunho podem ser aprovados.';
  END IF;

  SELECT is_active INTO v_store_active FROM public.stores WHERE id = v_inventory.store_id;
  IF COALESCE(v_store_active, false) = false THEN
    RAISE EXCEPTION 'Loja do inventário inválida ou inativa.';
  END IF;

  v_role := upper(COALESCE(public.get_user_store_role(v_inventory.store_id), ''));
  IF v_role NOT IN ('ADMIN', 'MANAGER') THEN
    RAISE EXCEPTION 'Permissão negada para aprovar inventário.';
  END IF;

  FOR v_item IN
    SELECT pii.product_variant_id, pii.expected_quantity, pii.counted_quantity, pii.reason
    FROM public.physical_inventory_items pii
    WHERE pii.inventory_id = p_inventory_id
      AND pii.counted_quantity IS NOT NULL
    FOR UPDATE
  LOOP
    IF v_item.product_variant_id IS NULL OR v_item.counted_quantity < 0 THEN
      RAISE EXCEPTION 'Item de inventário inválido.';
    END IF;

    SELECT quantity INTO v_stock_before
    FROM public.store_inventory
    WHERE store_id = v_inventory.store_id AND product_variant_id = v_item.product_variant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.store_inventory(store_id, product_variant_id, quantity, minimum_stock)
      VALUES(v_inventory.store_id, v_item.product_variant_id, 0, 0);
      v_stock_before := 0;
    END IF;

    v_divergence := v_item.counted_quantity - COALESCE(v_item.expected_quantity, v_stock_before);

    IF v_divergence <> 0 THEN
      UPDATE public.store_inventory
      SET quantity = v_item.counted_quantity
      WHERE store_id = v_inventory.store_id AND product_variant_id = v_item.product_variant_id;

      INSERT INTO public.inventory_movements(
        store_id, product_variant_id, type, quantity, quantity_before, quantity_after,
        reference_type, reference_id, user_id, notes, reason
      )
      VALUES(
        v_inventory.store_id, v_item.product_variant_id, 'ADJUSTMENT',
        v_divergence, COALESCE(v_stock_before, 0), v_item.counted_quantity,
        'INVENTORY', p_inventory_id, v_auth_uid,
        'Ajuste por inventário físico aprovado', COALESCE(v_item.reason, 'Inventário Físico')
      );

      UPDATE public.product_variants pv
      SET stock_quantity = (
        SELECT COALESCE(SUM(si.quantity), 0)
        FROM public.store_inventory si
        WHERE si.product_variant_id = pv.id
      )
      WHERE pv.id = v_item.product_variant_id;
    END IF;
  END LOOP;

  UPDATE public.physical_inventories
  SET status = 'APPROVED',
      approved_by = v_auth_uid,
      completed_at = now(),
      updated_at = now()
  WHERE id = p_inventory_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_physical_inventory(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_physical_inventory(uuid, uuid) TO authenticated;
ALTER FUNCTION public.approve_physical_inventory(uuid, uuid) SET search_path = public;

COMMIT;
