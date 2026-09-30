BEGIN;
DROP VIEW public.inventory_reconciliation;
CREATE VIEW public.inventory_reconciliation AS
WITH store_totals AS (
 SELECT product_variant_id,SUM(quantity)::integer store_inventory_quantity FROM public.store_inventory GROUP BY product_variant_id
), movement_totals AS (
 SELECT product_variant_id,SUM(CASE WHEN type IN ('ENTRY','PURCHASE','RETURN','TRANSFER_IN','INITIAL','CORRECTION','ADJUSTMENT') THEN quantity WHEN type IN ('SALE','LOSS','TRANSFER_OUT','CANCELLATION') THEN -quantity ELSE 0 END)::integer movement_net_quantity
 FROM public.inventory_movements GROUP BY product_variant_id
)
SELECT pv.id product_variant_id,pv.sku,pv.stock_quantity legacy_stock_quantity,COALESCE(st.store_inventory_quantity,0) store_inventory_quantity,COALESCE(pv.reserved_quantity,0) reserved_quantity,COALESCE(mt.movement_net_quantity,0) movement_net_quantity,(pv.stock_quantity=COALESCE(st.store_inventory_quantity,0)) legacy_matches_store_inventory
FROM public.product_variants pv LEFT JOIN store_totals st ON st.product_variant_id=pv.id LEFT JOIN movement_totals mt ON mt.product_variant_id=pv.id;
REVOKE ALL ON public.inventory_reconciliation FROM anon;
GRANT SELECT ON public.inventory_reconciliation TO authenticated;
COMMIT;
