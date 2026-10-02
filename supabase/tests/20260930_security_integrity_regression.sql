-- CoreSys Security / Integrity regression checks.
-- Intended for an isolated Supabase test database.
-- This file is also used as the source for non-destructive smoke checks.

BEGIN;

DO $$
DECLARE
  v_fn record;
BEGIN
  -- Privileged sale/return RPCs must require an authenticated caller.
  FOR v_fn IN SELECT p.oid::regprocedure fn FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('complete_sale','create_mp_pix_sale','process_return')
  LOOP
    ASSERT has_function_privilege('anon', v_fn.fn, 'EXECUTE') = false,
      'anon must not execute privileged sales/returns RPCs';
  END LOOP;

  ASSERT has_function_privilege('authenticated', 'public.complete_sale(uuid,uuid,text,text,jsonb,text,integer,numeric,numeric,text)'::regprocedure, 'EXECUTE');
  ASSERT has_function_privilege('authenticated', 'public.create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric,uuid,text)'::regprocedure, 'EXECUTE');
  ASSERT has_function_privilege('authenticated', 'public.process_return(uuid,uuid,uuid,text,text,jsonb,text,text)'::regprocedure, 'EXECUTE');
END $$;

DO $$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.process_return(uuid,uuid,uuid,text,text,jsonb,text,text)'::regprocedure);
  ASSERT position('for update' IN lower(v_def)) > 0, 'process_return must retain transaction row locking';
  ASSERT position('group by x.variant_id' IN lower(v_def)) > 0, 'process_return must aggregate duplicate variants before validation';
  ASSERT position('sum(x.quantity::bigint)' IN lower(v_def)) > 0, 'process_return must validate aggregated quantity';
END $$;

DO $$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.complete_sale(uuid,uuid,text,text,jsonb,text,integer,numeric,numeric,text)'::regprocedure);
  ASSERT position('hashtextextended' IN v_def) > 0, 'complete_sale must serialize idempotency attempts';
  ASSERT position('sale_idempotency' IN v_def) > 0, 'complete_sale must use sale_idempotency';
  ASSERT position('v_scoped_key' IN v_def) > 0, 'complete_sale must use scoped idempotency keys';

  v_def := pg_get_functiondef('public.create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric,uuid,text)'::regprocedure);
  ASSERT position('hashtextextended' IN v_def) > 0, 'create_mp_pix_sale must serialize idempotency attempts';
  ASSERT position('sale_idempotency' IN v_def) > 0, 'create_mp_pix_sale must use sale_idempotency';
  ASSERT position('v_scoped_key' IN v_def) > 0, 'create_mp_pix_sale must use scoped idempotency keys';
END $$;

DO $$
DECLARE
  v_bucket record;
BEGIN
  SELECT file_size_limit,allowed_mime_types INTO v_bucket
  FROM storage.buckets WHERE id='product-images';
  ASSERT v_bucket.file_size_limit = 5242880, 'product-images must be capped at 5 MiB';
  ASSERT v_bucket.allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']::text[], 'product-images MIME allowlist mismatch';

  SELECT file_size_limit,allowed_mime_types INTO v_bucket
  FROM storage.buckets WHERE id='brand-logos';
  ASSERT v_bucket.file_size_limit = 2097152, 'brand-logos must be capped at 2 MiB';
  ASSERT v_bucket.allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/svg+xml']::text[], 'brand-logos MIME allowlist mismatch';
END $$;

DO $$
DECLARE
  v_policy record;
BEGIN
  SELECT with_check INTO v_policy FROM pg_policies
  WHERE schemaname='storage' AND tablename='objects' AND policyname='Authenticated Upload Product Images';
  ASSERT v_policy.with_check ILIKE '%storage.foldername(name)%', 'product upload must be path-scoped';

  SELECT with_check INTO v_policy FROM pg_policies
  WHERE schemaname='storage' AND tablename='objects' AND policyname='Authenticated Upload Brand Logos';
  ASSERT v_policy.with_check ILIKE '%storage.foldername(name)%', 'logo upload must be path-scoped';
END $$;


DO $$
DECLARE
  v_rls boolean;
BEGIN
  SELECT relrowsecurity INTO v_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'data_export_audit';
  ASSERT v_rls, 'data_export_audit must keep RLS enabled';

  SELECT relrowsecurity INTO v_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'privacy_requests';
  ASSERT v_rls, 'privacy_requests must keep RLS enabled';

  ASSERT has_table_privilege('authenticated', 'public.data_export_audit', 'SELECT') = false,
    'authenticated must not read export audit directly';
  ASSERT has_table_privilege('authenticated', 'public.privacy_requests', 'SELECT') = false,
    'authenticated must not read privacy requests directly';
END $$;

DO $$
BEGIN
  ASSERT has_function_privilege('anon', 'public.log_data_export(uuid,text,text,integer,boolean,jsonb)'::regprocedure, 'EXECUTE') = false;
  ASSERT has_function_privilege('anon', 'public.export_customer_personal_data(uuid,uuid)'::regprocedure, 'EXECUTE') = false;
  ASSERT has_function_privilege('anon', 'public.create_privacy_request(uuid,uuid,text,text)'::regprocedure, 'EXECUTE') = false;
  ASSERT has_function_privilege('anon', 'public.check_customer_anonymization_eligibility(uuid,uuid)'::regprocedure, 'EXECUTE') = false;
  ASSERT has_function_privilege('anon', 'public.resolve_privacy_request(uuid,uuid,text,text)'::regprocedure, 'EXECUTE') = false;

  ASSERT has_function_privilege('authenticated', 'public.log_data_export(uuid,text,text,integer,boolean,jsonb)'::regprocedure, 'EXECUTE');
  ASSERT has_function_privilege('authenticated', 'public.export_customer_personal_data(uuid,uuid)'::regprocedure, 'EXECUTE');
  ASSERT has_function_privilege('authenticated', 'public.create_privacy_request(uuid,uuid,text,text)'::regprocedure, 'EXECUTE');
  ASSERT has_function_privilege('authenticated', 'public.check_customer_anonymization_eligibility(uuid,uuid)'::regprocedure, 'EXECUTE');
  ASSERT has_function_privilege('authenticated', 'public.resolve_privacy_request(uuid,uuid,text,text)'::regprocedure, 'EXECUTE');
END $$;

DO $$
BEGIN
  ASSERT has_function_privilege('anon', 'public.get_pix_operational_health(integer)'::regprocedure, 'EXECUTE') = false;
  ASSERT has_function_privilege('authenticated', 'public.get_pix_operational_health(integer)'::regprocedure, 'EXECUTE') = false;
  ASSERT has_function_privilege('service_role', 'public.get_pix_operational_health(integer)'::regprocedure, 'EXECUTE');

  ASSERT has_function_privilege('anon', 'public.get_database_operational_health()'::regprocedure, 'EXECUTE') = false;
  ASSERT has_function_privilege('authenticated', 'public.get_database_operational_health()'::regprocedure, 'EXECUTE') = false;
  ASSERT has_function_privilege('service_role', 'public.get_database_operational_health()'::regprocedure, 'EXECUTE');

  ASSERT has_function_privilege('anon', 'public.get_slow_query_metrics(integer)'::regprocedure, 'EXECUTE') = false;
  ASSERT has_function_privilege('authenticated', 'public.get_slow_query_metrics(integer)'::regprocedure, 'EXECUTE') = false;
  ASSERT has_function_privilege('service_role', 'public.get_slow_query_metrics(integer)'::regprocedure, 'EXECUTE');
END $$;

DO $$
DECLARE
  v_def text;
BEGIN
  ASSERT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'customers'
      AND indexname = 'idx_customers_store_id'
  ), 'customers.store_id index must exist';

  v_def := pg_get_functiondef('public.list_stale_pix_reconciliation_candidates(integer)'::regprocedure);
  ASSERT position('MERCADO_PAGO' IN v_def) > 0, 'PIX reconciliation candidates must be provider-scoped';
  ASSERT position('provider_transaction_id' IN v_def) > 0, 'PIX reconciliation candidates must require provider transaction id';
END $$;

ROLLBACK;
