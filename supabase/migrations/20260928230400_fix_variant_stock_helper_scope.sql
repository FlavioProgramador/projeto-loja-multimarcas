-- The existing helper is OUT-parameter based; changing its return type requires DROP,
-- which is intentionally avoided. Recreate only with the exact existing row contract.

CREATE OR REPLACE FUNCTION public.get_variant_stock_by_store(p_variant_id uuid)
RETURNS TABLE(store_id uuid, store_name text, stock_quantity bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT s.id,
         s.name,
         COALESCE(si.quantity, 0)::bigint
  FROM public.stores s
  LEFT JOIN public.store_inventory si
    ON si.store_id = s.id
   AND si.product_variant_id = p_variant_id
  WHERE s.is_active = true
    AND EXISTS (
      SELECT 1
      FROM public.user_store_access usa
      JOIN public.profiles p ON p.id = usa.user_id
      WHERE usa.user_id = auth.uid()
        AND usa.store_id = s.id
        AND usa.is_active = true
        AND p.is_active = true
    )
  ORDER BY s.name;
$$;

REVOKE ALL ON FUNCTION public.get_variant_stock_by_store(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_variant_stock_by_store(uuid) TO authenticated;
