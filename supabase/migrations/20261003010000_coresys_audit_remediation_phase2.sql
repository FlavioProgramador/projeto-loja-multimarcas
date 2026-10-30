-- CoreSys Audit Remediation Phase 2 Migration
-- Date: 2026-10-03
-- Scope: Harden approve_physical_inventory, manage_product, process_return, and register_stock_entry with fail-closed role checks, strict grants, and explicit search_path

BEGIN;

-- 1) Harden approve_physical_inventory with explicit fail-closed role check and search_path
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

  SELECT p.is_active INTO v_profile_active FROM public.profiles p WHERE p.id = v_actor;
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

  SELECT s.is_active INTO v_store_active FROM public.stores s WHERE s.id = v_store_id;
  IF COALESCE(v_store_active, false) = false THEN
    RAISE EXCEPTION 'Loja inválida ou inativa.';
  END IF;

  v_role := public.get_user_store_role(v_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN', 'MANAGER') THEN
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
      INSERT INTO public.store_inventory(
        store_id, product_variant_id, quantity, minimum_stock
      ) VALUES (v_store_id, v_item.product_variant_id, 0, 0);
      v_before := 0;
    END IF;

    v_divergence := v_item.counted_quantity - v_item.expected_quantity;
    v_after := v_item.counted_quantity;

    IF v_divergence <> 0 THEN
      UPDATE public.store_inventory
      SET quantity = v_after
      WHERE store_id = v_store_id AND product_variant_id = v_item.product_variant_id;

      INSERT INTO public.inventory_movements(
        store_id, product_variant_id, type, quantity, quantity_before, quantity_after,
        reference_type, reference_id, user_id, reason, notes
      ) VALUES (
        v_store_id, v_item.product_variant_id, 'ADJUSTMENT', v_divergence, v_before, v_after,
        'INVENTORY', p_inventory_id, v_actor, v_item.reason, 'Ajuste de inventário físico'
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
  SET status = 'APPROVED', approved_by = v_actor, updated_at = now()
  WHERE id = p_inventory_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_physical_inventory(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_physical_inventory(uuid, uuid) TO authenticated;
ALTER FUNCTION public.approve_physical_inventory(uuid, uuid) SET search_path = public;

-- 2) Harden manage_product with explicit fail-closed role check and search_path
CREATE OR REPLACE FUNCTION public.manage_product(
  p_product_id uuid,
  p_name text,
  p_brand_name text,
  p_category_name text,
  p_sale_price numeric,
  p_cost_price numeric,
  p_variants jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_profile_active boolean;
  v_role text;
  v_brand_id uuid;
  v_category_id uuid;
  v_product_id uuid;
  v_variant record;
  v_variant_ids uuid[] := '{}';
  v_generated_sku text;
  v_idx int := 1;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;

  SELECT is_active INTO v_profile_active FROM public.profiles WHERE id = v_user;
  IF COALESCE(v_profile_active, false) = false THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;

  v_role := public.current_user_role();
  IF v_role IS NULL OR v_role NOT IN ('ADMIN', 'MANAGER') THEN
    RAISE EXCEPTION 'Permissão negada.';
  END IF;

  IF NULLIF(btrim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Nome do produto é obrigatório.';
  END IF;

  IF COALESCE(p_sale_price, 0) < 0 OR COALESCE(p_cost_price, 0) < 0 THEN
    RAISE EXCEPTION 'Preços inválidos.';
  END IF;

  IF NULLIF(btrim(p_brand_name), '') IS NOT NULL THEN
    SELECT id INTO v_brand_id FROM public.brands WHERE name ILIKE btrim(p_brand_name);
    IF v_brand_id IS NULL THEN
      INSERT INTO public.brands (name) VALUES (btrim(p_brand_name)) RETURNING id INTO v_brand_id;
    END IF;
  END IF;

  IF NULLIF(btrim(p_category_name), '') IS NOT NULL THEN
    SELECT id INTO v_category_id FROM public.categories WHERE name ILIKE btrim(p_category_name);
    IF v_category_id IS NULL THEN
      INSERT INTO public.categories (name) VALUES (btrim(p_category_name)) RETURNING id INTO v_category_id;
    END IF;
  END IF;

  IF p_product_id IS NOT NULL THEN
    UPDATE public.products
    SET name = btrim(p_name),
        brand_id = v_brand_id,
        category_id = v_category_id,
        sale_price = p_sale_price,
        cost_price = p_cost_price,
        updated_at = now()
    WHERE id = p_product_id AND is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto não encontrado ou inativo.';
    END IF;
    v_product_id := p_product_id;
  ELSE
    INSERT INTO public.products (name, brand_id, category_id, sale_price, cost_price, is_active)
    VALUES (btrim(p_name), v_brand_id, v_category_id, p_sale_price, p_cost_price, true)
    RETURNING id INTO v_product_id;
  END IF;

  IF jsonb_typeof(COALESCE(p_variants, '[]'::jsonb)) = 'array' AND jsonb_array_length(p_variants) > 0 THEN
    FOR v_variant IN SELECT * FROM jsonb_to_recordset(p_variants) AS x(
      id uuid,
      sku text,
      color text,
      size text,
      barcode text,
      minimum_stock integer
    )
    LOOP
      v_generated_sku := NULLIF(btrim(v_variant.sku), '');
      IF v_generated_sku IS NULL THEN
        v_generated_sku := upper(regexp_replace(btrim(p_name), '\s+', '', 'g')) || '-' ||
                           upper(COALESCE(NULLIF(btrim(v_variant.size), ''), 'UNI')) || '-' ||
                           upper(COALESCE(NULLIF(btrim(v_variant.color), ''), 'PAD'));

        WHILE EXISTS (
          SELECT 1 FROM public.product_variants
          WHERE sku = v_generated_sku AND (v_variant.id IS NULL OR id <> v_variant.id)
        ) LOOP
          v_generated_sku := v_generated_sku || '-' || v_idx::text;
          v_idx := v_idx + 1;
        END LOOP;
      END IF;

      IF v_variant.id IS NOT NULL THEN
        UPDATE public.product_variants
        SET sku = v_generated_sku,
            color = v_variant.color,
            size = v_variant.size,
            barcode = v_variant.barcode,
            minimum_stock = COALESCE(v_variant.minimum_stock, 0),
            is_active = true,
            updated_at = now()
        WHERE id = v_variant.id AND product_id = v_product_id;

        v_variant_ids := array_append(v_variant_ids, v_variant.id);
      ELSE
        INSERT INTO public.product_variants (
          product_id, sku, color, size, barcode, minimum_stock, stock_quantity, reserved_quantity, is_active
        ) VALUES (
          v_product_id, v_generated_sku, v_variant.color, v_variant.size, v_variant.barcode,
          COALESCE(v_variant.minimum_stock, 0), 0, 0, true
        )
        RETURNING id INTO v_variant.id;

        v_variant_ids := array_append(v_variant_ids, v_variant.id);
      END IF;
    END LOOP;

    UPDATE public.product_variants
    SET is_active = false
    WHERE product_id = v_product_id AND NOT (id = ANY(v_variant_ids));
  END IF;

  RETURN jsonb_build_object('success', true, 'product_id', v_product_id);
END;
$$;

REVOKE ALL ON FUNCTION public.manage_product(uuid, text, text, text, numeric, numeric, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_product(uuid, text, text, text, numeric, numeric, jsonb) TO authenticated;
ALTER FUNCTION public.manage_product(uuid, text, text, text, numeric, numeric, jsonb) SET search_path = public, extensions;

-- 3) Revoke EXECUTE from PUBLIC and anon for process_return and register_stock_entry
DO $$
BEGIN
  IF to_regprocedure('public.process_return(uuid,uuid,uuid,text,text,jsonb,text,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.process_return(uuid,uuid,uuid,text,text,jsonb,text,text) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.process_return(uuid,uuid,uuid,text,text,jsonb,text,text) TO authenticated';
    EXECUTE 'ALTER FUNCTION public.process_return(uuid,uuid,uuid,text,text,jsonb,text,text) SET search_path = public';
  END IF;

  IF to_regprocedure('public.register_stock_entry(uuid,integer,numeric,text,uuid,text,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.register_stock_entry(uuid,integer,numeric,text,uuid,text,text) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.register_stock_entry(uuid,integer,numeric,text,uuid,text,text) TO authenticated';
    EXECUTE 'ALTER FUNCTION public.register_stock_entry(uuid,integer,numeric,text,uuid,text,text) SET search_path = public';
  END IF;
END $$;

COMMIT;
