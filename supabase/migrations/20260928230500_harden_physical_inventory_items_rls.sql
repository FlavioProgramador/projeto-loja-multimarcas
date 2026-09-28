BEGIN;

DROP POLICY IF EXISTS "Physical inventory items insert by inventory managers" ON public.physical_inventory_items;
DROP POLICY IF EXISTS "Physical inventory items update by inventory managers" ON public.physical_inventory_items;
DROP POLICY IF EXISTS "Physical inventory items delete by inventory managers" ON public.physical_inventory_items;
DROP POLICY IF EXISTS "Physical inventory items view by inventory store access" ON public.physical_inventory_items;

CREATE POLICY "Physical inventory items insert by inventory managers"
ON public.physical_inventory_items
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.physical_inventories pi
    WHERE pi.id = physical_inventory_items.inventory_id
      AND pi.store_id IS NOT NULL
      AND pi.status = 'OPEN'
      AND public.get_user_store_role(pi.store_id) IN ('ADMIN','MANAGER')
  )
);

CREATE POLICY "Physical inventory items update by inventory managers"
ON public.physical_inventory_items
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.physical_inventories pi
    WHERE pi.id = physical_inventory_items.inventory_id
      AND pi.store_id IS NOT NULL
      AND pi.status = 'OPEN'
      AND public.get_user_store_role(pi.store_id) IN ('ADMIN','MANAGER')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.physical_inventories pi
    WHERE pi.id = physical_inventory_items.inventory_id
      AND pi.store_id IS NOT NULL
      AND pi.status = 'OPEN'
      AND public.get_user_store_role(pi.store_id) IN ('ADMIN','MANAGER')
  )
);

CREATE POLICY "Physical inventory items delete by inventory managers"
ON public.physical_inventory_items
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.physical_inventories pi
    WHERE pi.id = physical_inventory_items.inventory_id
      AND pi.store_id IS NOT NULL
      AND pi.status = 'OPEN'
      AND public.get_user_store_role(pi.store_id) IN ('ADMIN','MANAGER')
  )
);

CREATE POLICY "Physical inventory items view by inventory store access"
ON public.physical_inventory_items
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.physical_inventories pi
    WHERE pi.id = physical_inventory_items.inventory_id
      AND pi.store_id IS NOT NULL
      AND public.has_store_access(pi.store_id)
  )
);

COMMIT;
