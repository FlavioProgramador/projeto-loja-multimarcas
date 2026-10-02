-- CoreSys Phase 2.5B report aggregation regression checks.

BEGIN;

SELECT plan(1);

DO $$
DECLARE
  v_def text;
BEGIN
  ASSERT to_regprocedure('public.report_commercial_summary(uuid,date,date)') IS NOT NULL,
    'commercial summary RPC must exist';

  ASSERT has_function_privilege(
    'anon',
    'public.report_commercial_summary(uuid,date,date)'::regprocedure,
    'EXECUTE'
  ) = false, 'anon must not execute commercial summary';

  ASSERT has_function_privilege(
    'authenticated',
    'public.report_commercial_summary(uuid,date,date)'::regprocedure,
    'EXECUTE'
  ), 'authenticated users need the commercial summary RPC';

  SELECT pg_get_functiondef('public.report_commercial_summary(uuid,date,date)'::regprocedure)
    INTO v_def;

  ASSERT position('has_store_access' IN v_def) > 0,
    'commercial summary must enforce store access';

  ASSERT position('financial_transactions' IN v_def) > 0,
    'commercial summary must aggregate expenses server-side';

  ASSERT position('payments' IN v_def) > 0,
    'commercial summary must aggregate payment methods server-side';

  ASSERT position('store_inventory' IN v_def) > 0,
    'commercial summary must aggregate inventory server-side';
END $$;

SELECT pass('commercial report summary assertions completed');
SELECT * FROM finish();

ROLLBACK;
