BEGIN;
SELECT plan(7);
SELECT has_view('public', 'inventory_reconciliation', 'inventory reconciliation view exists');
SELECT results_eq(
  $$SELECT count(*)::bigint FROM public.inventory_reconciliation WHERE NOT legacy_matches_store_inventory$$,
  ARRAY[0::bigint],
  'legacy stock matches store inventory for current variants'
);
SELECT results_eq(
  $$SELECT count(*)::bigint FROM public.financial_transactions WHERE type NOT IN ('INCOME','EXPENSE')$$,
  ARRAY[0::bigint],
  'financial transaction types are normalized'
);
SELECT results_eq(
  $$SELECT count(*)::bigint FROM public.payments WHERE method NOT IN ('PIX','CREDIT_CARD','DEBIT_CARD','CASH')$$,
  ARRAY[0::bigint],
  'payment methods use canonical values'
);
SELECT results_eq(
  $$SELECT count(*)::bigint FROM public.store_inventory WHERE quantity < 0$$,
  ARRAY[0::bigint],
  'store inventory has no negative quantities'
);
SELECT results_eq(
  $$SELECT count(*)::bigint FROM public.product_variants WHERE stock_quantity < 0$$,
  ARRAY[0::bigint],
  'product variants have no negative stock'
);
SELECT results_eq(
  $$SELECT count(*)::bigint FROM public.inventory_movements WHERE quantity <= 0$$,
  ARRAY[0::bigint],
  'inventory movements have positive quantities'
);
SELECT * FROM finish();
ROLLBACK;
