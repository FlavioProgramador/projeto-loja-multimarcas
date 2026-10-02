-- CoreSys Phase 2.5C pagination regression checks.

BEGIN;

SELECT plan(1);

DO $$
DECLARE
  v_def text;
BEGIN
  ASSERT to_regprocedure('public.get_customer_directory_page(uuid,text,text,text,integer,integer)') IS NOT NULL;
  ASSERT to_regprocedure('public.get_customer_detail(uuid,uuid)') IS NOT NULL;
  ASSERT to_regprocedure('public.get_finance_page(uuid,timestamptz,text,text,text,integer,integer)') IS NOT NULL;
  ASSERT to_regprocedure('public.get_returns_page(uuid,text,text,integer,integer)') IS NOT NULL;
  ASSERT to_regprocedure('public.resolve_sale_customer_link()') IS NOT NULL;

  ASSERT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.sales'::regclass
      AND tgname = 'trg_resolve_sale_customer_link'
      AND NOT tgisinternal
  ), 'sales must resolve/validate customer linkage on write';

  ASSERT has_function_privilege(
    'anon',
    'public.get_customer_directory_page(uuid,text,text,text,integer,integer)'::regprocedure,
    'EXECUTE'
  ) = false;
  ASSERT has_function_privilege(
    'authenticated',
    'public.get_customer_directory_page(uuid,text,text,text,integer,integer)'::regprocedure,
    'EXECUTE'
  );

  ASSERT has_function_privilege(
    'anon',
    'public.get_finance_page(uuid,timestamptz,text,text,text,integer,integer)'::regprocedure,
    'EXECUTE'
  ) = false;
  ASSERT has_function_privilege(
    'authenticated',
    'public.get_finance_page(uuid,timestamptz,text,text,text,integer,integer)'::regprocedure,
    'EXECUTE'
  );

  ASSERT has_function_privilege(
    'anon',
    'public.get_returns_page(uuid,text,text,integer,integer)'::regprocedure,
    'EXECUTE'
  ) = false;
  ASSERT has_function_privilege(
    'authenticated',
    'public.get_returns_page(uuid,text,text,integer,integer)'::regprocedure,
    'EXECUTE'
  );

  v_def := pg_get_functiondef(
    'public.get_customer_directory_page(uuid,text,text,text,integer,integer)'::regprocedure
  );
  ASSERT position('has_store_access' IN v_def) > 0;
  ASSERT position('LIMIT p_limit OFFSET p_offset' IN v_def) > 0;

  v_def := pg_get_functiondef(
    'public.get_finance_page(uuid,timestamptz,text,text,text,integer,integer)'::regprocedure
  );
  ASSERT position('get_user_store_role' IN v_def) > 0;
  ASSERT position('ADMIN' IN v_def) > 0 AND position('MANAGER' IN v_def) > 0;
  ASSERT position('LIMIT p_limit OFFSET p_offset' IN v_def) > 0;

  v_def := pg_get_functiondef(
    'public.get_returns_page(uuid,text,text,integer,integer)'::regprocedure
  );
  ASSERT position('get_user_store_role' IN v_def) > 0;
  ASSERT position('return_items' IN v_def) > 0;
  ASSERT position('LIMIT p_limit OFFSET p_offset' IN v_def) > 0;

  v_def := pg_get_functiondef('public.resolve_sale_customer_link()'::regprocedure);
  ASSERT position('c.store_id = NEW.store_id' IN v_def) > 0,
    'sale customer link must be store-scoped';
  ASSERT position('v_matches = 1' IN v_def) > 0,
    'CPF fallback must only link an unambiguous customer';
END $;

SELECT pass('phase 2.5C pagination assertions completed');
SELECT * FROM finish();

ROLLBACK;
