-- Fase 3: checks that can run in CI/read-only environments.
-- These assertions intentionally inspect authorization and locking primitives
-- without mutating production business data.

DO $$
DECLARE
  fn text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO fn
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.oid::regprocedure::text = 'complete_sale(uuid,uuid,text,text,jsonb,text,integer,numeric,numeric,text)';

  IF fn IS NULL THEN RAISE EXCEPTION 'Scoped complete_sale RPC missing'; END IF;
  IF position('get_user_store_role(p_store_id)' IN fn) = 0 THEN
    RAISE EXCEPTION 'complete_sale does not authorize by store role';
  END IF;
  IF position('FOR UPDATE' IN fn) = 0 THEN
    RAISE EXCEPTION 'complete_sale lost row locking';
  END IF;
  IF position('pg_advisory_xact_lock' IN fn) = 0 THEN
    RAISE EXCEPTION 'complete_sale lost idempotency lock';
  END IF;
END $$;

DO $$
DECLARE
  fn text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO fn
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.oid::regprocedure::text = 'create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric,uuid,text)';

  IF fn IS NULL THEN RAISE EXCEPTION 'Scoped create_mp_pix_sale RPC missing'; END IF;
  IF position('get_user_store_role(p_store_id)' IN fn) = 0 THEN
    RAISE EXCEPTION 'create_mp_pix_sale does not authorize by store role';
  END IF;
  IF position('FOR UPDATE' IN fn) = 0 THEN
    RAISE EXCEPTION 'create_mp_pix_sale lost inventory locking';
  END IF;
  IF position('pg_advisory_xact_lock' IN fn) = 0 THEN
    RAISE EXCEPTION 'create_mp_pix_sale lost idempotency lock';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sale_idempotency'::regclass
      AND conname = 'sale_idempotency_pkey'
  ) THEN RAISE EXCEPTION 'sale_idempotency primary key missing'; END IF;
END $$;

DO $$
DECLARE
  pk text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO pk
  FROM pg_constraint
  WHERE conrelid = 'public.sale_idempotency'::regclass
    AND conname = 'sale_idempotency_pkey';
  IF pk NOT LIKE '%idempotency_key%store_id%user_id%' THEN
    RAISE EXCEPTION 'sale_idempotency key is not store/user scoped: %', pk;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.oid::regprocedure::text='list_stale_pix_reconciliation_candidates(integer)'
  ) THEN RAISE EXCEPTION 'PIX reconciliation candidate function missing'; END IF;
END $$;
