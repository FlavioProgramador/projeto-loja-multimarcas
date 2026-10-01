-- CoreSys Automation Engine V2 regression checks.
-- Runs only against the isolated local Supabase database used by CI.

BEGIN;

DO $$
DECLARE
  v_rls boolean;
BEGIN
  SELECT relrowsecurity INTO v_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relname='automation_rules';
  ASSERT v_rls, 'automation_rules must keep RLS enabled';

  SELECT relrowsecurity INTO v_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relname='automation_runs';
  ASSERT v_rls, 'automation_runs must keep RLS enabled';

  SELECT relrowsecurity INTO v_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relname='automation_events';
  ASSERT v_rls, 'automation_events must keep RLS enabled';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='automation_rules' AND column_name='archived_at'
  ), 'automation_rules.archived_at must exist';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='automation_events' AND column_name='automation_id'
  ), 'automation_events.automation_id must exist';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='automation_events' AND column_name='processed_at'
  ), 'automation_events.processed_at must exist';
END $$;

DO $$
BEGIN
  ASSERT to_regprocedure(
    'public.create_automation_rule(uuid,text,text,text,text,jsonb,jsonb,integer,integer,text)'
  ) IS NULL, 'legacy create_automation_rule overload must be removed';

  ASSERT to_regprocedure(
    'public.update_automation_rule(uuid,uuid,text,text,text,text,jsonb,jsonb,integer,integer,text)'
  ) IS NULL, 'legacy update_automation_rule overload must be removed';

  ASSERT has_function_privilege(
    'anon',
    'public.create_automation_rule(uuid,text,text,text,text,jsonb,jsonb,integer,integer,text,text)'::regprocedure,
    'EXECUTE'
  ) = false, 'anon must not create automation rules';

  ASSERT has_function_privilege(
    'authenticated',
    'public.create_automation_rule(uuid,text,text,text,text,jsonb,jsonb,integer,integer,text,text)'::regprocedure,
    'EXECUTE'
  ), 'authenticated managers/admins need the create RPC';

  ASSERT has_function_privilege(
    'anon',
    'public.test_automation_rule(uuid,uuid)'::regprocedure,
    'EXECUTE'
  ) = false, 'anon must not dry-run automation rules';

  ASSERT has_function_privilege(
    'authenticated',
    'public.test_automation_rule(uuid,uuid)'::regprocedure,
    'EXECUTE'
  ), 'authenticated managers/admins need the dry-run RPC';

  ASSERT has_function_privilege(
    'authenticated',
    'public.run_automation_cycle(uuid,text)'::regprocedure,
    'EXECUTE'
  ) = false, 'authenticated must not execute the automation worker';

  ASSERT has_function_privilege(
    'service_role',
    'public.run_automation_cycle(uuid,text)'::regprocedure,
    'EXECUTE'
  ), 'service_role must execute the automation worker';

  ASSERT has_function_privilege(
    'authenticated',
    'public.execute_automation_rule(uuid,text,text,uuid)'::regprocedure,
    'EXECUTE'
  ) = false, 'authenticated must not execute internal automation actions directly';

  ASSERT has_function_privilege(
    'authenticated',
    'public.enqueue_sales_automation_event()'::regprocedure,
    'EXECUTE'
  ) = false, 'trigger helper must not be exposed to authenticated';
END $$;

DO $$
DECLARE
  v_next timestamptz;
  v_def text;
BEGIN
  v_next := public.automation_next_run(
    'REPORT_DAILY',
    '14:12',
    'America/Sao_Paulo',
    '2026-10-01 16:00:00+00'::timestamptz
  );

  ASSERT v_next = '2026-10-01 17:12:00+00'::timestamptz,
    'scheduler must support times outside five-minute boundaries';

  v_def := pg_get_functiondef('public.run_automation_cycle(uuid,text)'::regprocedure);
  ASSERT position('next_run_at <= now()' IN v_def) > 0,
    'automation worker must use next_run_at rather than exact HH:MM matching';

  v_def := pg_get_functiondef('public.execute_automation_rule(uuid,text,text,uuid)'::regprocedure);
  ASSERT position('cooldown_minutes' IN v_def) > 0,
    'automation executor must enforce cooldown';
  ASSERT position('jsonb_array_elements' IN v_def) > 0,
    'automation executor must interpret configured actions';

  v_def := pg_get_functiondef('public.evaluate_automation_rule(uuid,jsonb)'::regprocedure);
  ASSERT position('store_inventory' IN v_def) > 0,
    'automation evaluator must inspect inventory';
  ASSERT position('fixed_expenses' IN v_def) > 0,
    'automation evaluator must inspect fixed expenses';
END $$;

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.sales'::regclass
      AND tgname='trg_sales_automation_event'
      AND NOT tgisinternal
  ), 'sales automation trigger must exist';

  ASSERT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.returns'::regclass
      AND tgname='trg_returns_automation_event'
      AND NOT tgisinternal
  ), 'returns automation trigger must exist';

  ASSERT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.store_inventory'::regclass
      AND tgname='trg_inventory_automation_event'
      AND NOT tgisinternal
  ), 'inventory automation trigger must exist';

  ASSERT has_table_privilege('authenticated', 'public.automation_rules', 'DELETE') = false,
    'authenticated must archive rules through the RPC instead of deleting history';
END $$;

DO $$
DECLARE
  v_job record;
BEGIN
  SELECT schedule, active INTO v_job
  FROM cron.job
  WHERE jobname='coresys-automation-engine';

  ASSERT v_job.schedule = '*/5 * * * *',
    'automation worker cron must remain scheduled every five minutes';
  ASSERT v_job.active,
    'automation worker cron must remain active';
END $$;

ROLLBACK;
