-- CoreSys Audit Security Regression Test
-- Date: 2026-10-03
-- Validates legacy complete_sale revocation, fail-closed role checks, RPC permissions, and search_path enforcement.

BEGIN;

SELECT plan(1);

-- 1) Test privileged RPC execution privileges for authenticated users and revocation from anon
DO $$
DECLARE
  v_fn record;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure AS fn
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'complete_sale',
        'create_mp_pix_sale',
        'process_return',
        'approve_physical_inventory',
        'manage_product',
        'register_stock_entry',
        'cancel_sale'
      )
  LOOP
    ASSERT has_function_privilege('anon', v_fn.fn, 'EXECUTE') = false,
      'anon must not execute privileged RPCs';
  END LOOP;

  ASSERT has_function_privilege('authenticated', 'public.approve_physical_inventory(uuid,uuid)'::regprocedure, 'EXECUTE');
  ASSERT has_function_privilege('authenticated', 'public.manage_product(uuid,text,text,text,numeric,numeric,jsonb)'::regprocedure, 'EXECUTE');
END;
$$;

-- 2) Test search_path and fail-closed role check definitions
DO $$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.approve_physical_inventory(uuid,uuid)'::regprocedure);
  ASSERT position('search_path = public' IN lower(v_def)) > 0, 'approve_physical_inventory must have fixed search_path';
  ASSERT position('v_role is null or v_role not in' IN lower(v_def)) > 0, 'approve_physical_inventory must have fail-closed role check';

  v_def := pg_get_functiondef('public.manage_product(uuid,text,text,text,numeric,numeric,jsonb)'::regprocedure);
  ASSERT position('search_path = public, extensions' IN lower(v_def)) > 0 OR position('search_path = public' IN lower(v_def)) > 0, 'manage_product must have fixed search_path';
  ASSERT position('v_role is null or v_role not in' IN lower(v_def)) > 0, 'manage_product must have fail-closed role check';
END;
$$;

SELECT pass('audit security assertions completed');
SELECT * FROM finish();
ROLLBACK;
