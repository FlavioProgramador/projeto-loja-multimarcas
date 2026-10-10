-- CoreSys Audit Remediation Migration v2
-- Date: 2026-10-04
-- Scope: Harden approve_physical_inventory RPC and physical_inventories RLS policy

BEGIN;

-- 0) Update physical_inventories status constraint to allow all valid workflow statuses
ALTER TABLE public.physical_inventories DROP CONSTRAINT IF EXISTS physical_inventories_status_check;
ALTER TABLE public.physical_inventories ADD CONSTRAINT physical_inventories_status_check
  CHECK (status IN ('OPEN', 'DRAFT', 'IN_PROGRESS', 'APPROVED', 'COMPLETED', 'CANCELLED'));

-- 1) Harden approve_physical_inventory RPC
CREATE OR REPLACE FUNCTION public.approve_physical_inventory(p_inventory_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_status text;
  v_store_id uuid;
  v_actor uuid := auth.uid();
  v_profile_active boolean := false;
  v_store_active boolean := false;
  v_role text;
  item record;
  v_before integer;
  v_after integer;
  v_divergence integer;
BEGIN
  IF v_actor IS NULL OR p_user_id IS NULL OR p_user_id <> v_actor THEN
    RAISE EXCEPTION 'Usuário de aprovação inválido ou não autenticado.';
  END IF;

  SELECT p.is_active INTO v_profile_active
  FROM public.profiles p
  WHERE p.id = v_actor;

  IF COALESCE(v_profile_active, false) = false THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;

  SELECT status, store_id INTO v_status, v_store_id
  FROM public.physical_inventories
  WHERE id = p_inventory_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventário não encontrado.';
  END IF;

  SELECT s.is_active INTO v_store_active
  FROM public.stores s
  WHERE s.id = v_store_id;

  IF COALESCE(v_store_active, false) = false THEN
    RAISE EXCEPTION 'Loja do inventário inválida ou inativa.';
  END IF;

  v_role := public.get_user_store_role(v_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','MANAGER') THEN
    RAISE EXCEPTION 'Permissão negada para aprovar inventário.';
  END IF;

  IF v_status IN ('APPROVED', 'COMPLETED') THEN
    RETURN true;
  END IF;

  IF v_status NOT IN ('OPEN', 'IN_PROGRESS', 'DRAFT') THEN
    RAISE EXCEPTION 'Apenas inventários em andamento ou rascunho podem ser aprovados.';
  END IF;

  FOR item IN
    SELECT product_variant_id, expected_quantity, counted_quantity, reason
    FROM public.physical_inventory_items
    WHERE inventory_id = p_inventory_id AND counted_quantity IS NOT NULL
    FOR UPDATE
  LOOP
    IF item.product_variant_id IS NULL OR item.counted_quantity < 0 THEN
      RAISE EXCEPTION 'Item de inventário inválido.';
    END IF;

    SELECT quantity INTO v_before
    FROM public.store_inventory
    WHERE store_id = v_store_id AND product_variant_id = item.product_variant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.store_inventory(store_id, product_variant_id, quantity, minimum_stock)
      VALUES(v_store_id, item.product_variant_id, 0, 0);
      v_before := 0;
    END IF;

    v_divergence := item.counted_quantity - item.expected_quantity;
    v_after := item.counted_quantity;

    IF v_divergence <> 0 THEN
      UPDATE public.store_inventory
      SET quantity = v_after
      WHERE store_id = v_store_id AND product_variant_id = item.product_variant_id;

      INSERT INTO public.inventory_movements(
        store_id, product_variant_id, type, quantity, quantity_before,
        quantity_after, reference_type, reference_id, user_id, reason, notes
      )
      VALUES(
        v_store_id, item.product_variant_id, 'ADJUSTMENT', v_divergence, v_before, v_after,
        'INVENTORY', p_inventory_id, v_actor, item.reason, 'Ajuste de inventário físico'
      );

      UPDATE public.product_variants pv
      SET stock_quantity = (
        SELECT COALESCE(SUM(si.quantity), 0)
        FROM public.store_inventory si
        WHERE si.product_variant_id = pv.id
      )
      WHERE pv.id = item.product_variant_id;
    END IF;
  END LOOP;

  UPDATE public.physical_inventories
  SET status = 'APPROVED', approved_by = v_actor, updated_at = now()
  WHERE id = p_inventory_id;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.approve_physical_inventory(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_physical_inventory(uuid,uuid) TO authenticated;

-- 2) Harden physical_inventories RLS policy for UPDATE
DROP POLICY IF EXISTS "Physical inventories update by store managers" ON public.physical_inventories;

CREATE POLICY "Physical inventories update by store managers"
ON public.physical_inventories FOR UPDATE
TO authenticated
USING (
  store_id IS NOT NULL AND
  public.get_user_store_role(store_id) IN ('ADMIN','MANAGER')
)
WITH CHECK (
  store_id IS NOT NULL AND
  public.get_user_store_role(store_id) IN ('ADMIN','MANAGER') AND
  EXISTS (
    SELECT 1
    FROM public.physical_inventories old_pi
    WHERE old_pi.id = physical_inventories.id
      AND old_pi.store_id = physical_inventories.store_id
      AND old_pi.created_by IS NOT DISTINCT FROM physical_inventories.created_by
  )
);

COMMIT;
