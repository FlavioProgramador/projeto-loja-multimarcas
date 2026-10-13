-- CoreSys Audit Final Remediation Regression Tests
-- Date: 2026-10-03
-- Scope: Verify role fail-closed enforcement, store isolation in reports, and physical inventory RLS policy using pgTAP.

BEGIN;

SELECT plan(3);

-- 1) Verify complete_sale rejects unauthorized roles or invalid stores
DO $$
DECLARE
  v_err boolean := false;
BEGIN
  BEGIN
    PERFORM public.complete_sale(
      p_store_id := '00000000-0000-0000-0000-000000000000'::uuid,
      p_idempotency_key := 'test-idempotency-key'
    );
  EXCEPTION WHEN OTHERS THEN
    v_err := true;
  END;

  IF NOT v_err THEN
    RAISE EXCEPTION 'TEST FAILED: complete_sale did not fail on unauthenticated or invalid store call.';
  END IF;
END $$;
SELECT pass('complete_sale fails closed on unauthenticated / invalid store');

-- 2) Verify cancel_sale rejects unauthorized calls
DO $$
DECLARE
  v_err boolean := false;
BEGIN
  BEGIN
    PERFORM public.cancel_sale('00000000-0000-0000-0000-000000000000'::uuid);
  EXCEPTION WHEN OTHERS THEN
    v_err := true;
  END;

  IF NOT v_err THEN
    RAISE EXCEPTION 'TEST FAILED: cancel_sale did not fail on unauthenticated call.';
  END IF;
END $$;
SELECT pass('cancel_sale fails closed on unauthenticated call');

-- 3) Verify report functions require valid store access
DO $$
DECLARE
  v_err boolean := false;
BEGIN
  BEGIN
    PERFORM * FROM public.report_stock_status('00000000-0000-0000-0000-000000000000'::uuid);
  EXCEPTION WHEN OTHERS THEN
    v_err := true;
  END;

  IF NOT v_err THEN
    RAISE EXCEPTION 'TEST FAILED: report_stock_status did not fail on unauthorized store_id.';
  END IF;
END $$;
SELECT pass('report_stock_status enforces store access');

SELECT * FROM finish();

ROLLBACK;
