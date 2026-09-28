DROP POLICY IF EXISTS "Payments viewable by authenticated" ON public.payments;
CREATE POLICY "Payments viewable by sale store access"
  ON public.payments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.sales s
      WHERE s.id = payments.sale_id
        AND (public.has_store_access(s.store_id) OR public.current_user_role() = 'ADMIN')
    )
  );

DROP POLICY IF EXISTS "Sale items viewable by authenticated" ON public.sale_items;
CREATE POLICY "Sale items viewable by sale store access"
  ON public.sale_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.sales s
      WHERE s.id = sale_items.sale_id
        AND (public.has_store_access(s.store_id) OR public.current_user_role() = 'ADMIN')
    )
  );

DROP POLICY IF EXISTS "Movements insertable by Admin and Manager" ON public.inventory_movements;
CREATE POLICY "Movements insertable by store roles"
  ON public.inventory_movements
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.get_user_store_role(store_id) IN ('ADMIN','MANAGER')
  );