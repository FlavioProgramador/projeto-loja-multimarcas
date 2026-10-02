-- Review hardening for Automation Engine V2.
-- Keeps production-compatible signatures while closing direct table writes,
-- aligning RLS with frontend RBAC and making worker claims concurrency-safe.

-- 1) Automation tables are readable only by ADMIN/MANAGER of the active store.
DROP POLICY IF EXISTS automation_rules_select ON public.automation_rules;
CREATE POLICY automation_rules_select
ON public.automation_rules
FOR SELECT TO authenticated
USING (coalesce(public.get_user_store_role(store_id), '') IN ('ADMIN','MANAGER'));

DROP POLICY IF EXISTS automation_runs_select ON public.automation_runs;
CREATE POLICY automation_runs_select
ON public.automation_runs
FOR SELECT TO authenticated
USING (coalesce(public.get_user_store_role(store_id), '') IN ('ADMIN','MANAGER'));

DROP POLICY IF EXISTS automation_events_select ON public.automation_events;
CREATE POLICY automation_events_select
ON public.automation_events
FOR SELECT TO authenticated
USING (coalesce(public.get_user_store_role(store_id), '') IN ('ADMIN','MANAGER'));

-- Mutations must go through the audited RPC boundary.
DROP POLICY IF EXISTS automation_rules_insert ON public.automation_rules;
DROP POLICY IF EXISTS automation_rules_update ON public.automation_rules;
DROP POLICY IF EXISTS automation_rules_delete ON public.automation_rules;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.automation_rules FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.automation_runs FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.automation_events FROM authenticated;

GRANT SELECT ON public.automation_rules, public.automation_runs, public.automation_events
  TO authenticated;

-- 2) RPCs become the only mutation boundary and fail closed when auth/store role is absent.
CREATE OR REPLACE FUNCTION public.create_automation_rule(
  p_store_id uuid,
  p_name text,
  p_description text default '',
  p_category text default 'SISTEMA',
  p_trigger text default 'REPORT_DAILY',
  p_conditions jsonb default '[]'::jsonb,
  p_actions jsonb default '[]'::jsonb,
  p_priority integer default 100,
  p_cooldown_minutes integer default 0,
  p_schedule text default null,
  p_timezone text default 'America/Sao_Paulo'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  v_id uuid;
  v_next timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;

  v_role := public.get_user_store_role(p_store_id);
  IF coalesce(v_role, '') NOT IN ('ADMIN','MANAGER') THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  IF p_schedule IS NOT NULL THEN
    v_next := public.automation_next_run(p_trigger, p_schedule, p_timezone, now());
  END IF;

  INSERT INTO public.automation_rules(
    store_id,name,description,category,trigger_type,conditions,actions,status,priority,
    cooldown_minutes,schedule,timezone,created_by,updated_by,next_run_at
  )
  VALUES (
    p_store_id,btrim(p_name),coalesce(p_description,''),p_category,p_trigger,
    coalesce(p_conditions,'[]'::jsonb),coalesce(p_actions,'[]'::jsonb),'PAUSED',
    p_priority,p_cooldown_minutes,p_schedule,coalesce(nullif(p_timezone,''),'America/Sao_Paulo'),
    v_user_id,v_user_id,v_next
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success',true,'id',v_id,'next_run_at',v_next);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_automation_rule(
  p_store_id uuid,
  p_automation_id uuid,
  p_name text,
  p_description text,
  p_category text,
  p_trigger text,
  p_conditions jsonb,
  p_actions jsonb,
  p_priority integer,
  p_cooldown_minutes integer,
  p_schedule text,
  p_timezone text default 'America/Sao_Paulo'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  v_next timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;

  v_role := public.get_user_store_role(p_store_id);
  IF coalesce(v_role, '') NOT IN ('ADMIN','MANAGER') THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  IF p_schedule IS NOT NULL THEN
    v_next := public.automation_next_run(p_trigger, p_schedule, p_timezone, now());
  END IF;

  UPDATE public.automation_rules
  SET name=btrim(p_name),
      description=coalesce(p_description,''),
      category=p_category,
      trigger_type=p_trigger,
      conditions=coalesce(p_conditions,'[]'::jsonb),
      actions=coalesce(p_actions,'[]'::jsonb),
      priority=p_priority,
      cooldown_minutes=p_cooldown_minutes,
      schedule=p_schedule,
      timezone=coalesce(nullif(p_timezone,''),'America/Sao_Paulo'),
      next_run_at=v_next,
      updated_by=v_user_id,
      updated_at=now()
  WHERE id=p_automation_id
    AND store_id=p_store_id
    AND archived_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automação não encontrada.';
  END IF;

  RETURN jsonb_build_object('success',true,'id',p_automation_id,'next_run_at',v_next);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_automation_rule_status(
  p_store_id uuid,
  p_automation_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  r public.automation_rules%rowtype;
  v_next timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;

  v_role := public.get_user_store_role(p_store_id);
  IF coalesce(v_role, '') NOT IN ('ADMIN','MANAGER') THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  IF p_status NOT IN ('ACTIVE','PAUSED') THEN
    RAISE EXCEPTION 'Status inválido.';
  END IF;

  SELECT * INTO r
  FROM public.automation_rules
  WHERE id=p_automation_id
    AND store_id=p_store_id
    AND archived_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automação não encontrada.';
  END IF;

  IF p_status='ACTIVE' AND r.schedule IS NOT NULL THEN
    v_next := public.automation_next_run(r.trigger_type, r.schedule, r.timezone, now());
  END IF;

  UPDATE public.automation_rules
  SET status=p_status,
      next_run_at=CASE WHEN p_status='ACTIVE' THEN v_next ELSE NULL END,
      updated_by=v_user_id,
      updated_at=now()
  WHERE id=p_automation_id AND store_id=p_store_id;

  RETURN jsonb_build_object('success',true,'status',p_status,'next_run_at',v_next);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_automation_rule(
  p_store_id uuid,
  p_automation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;

  v_role := public.get_user_store_role(p_store_id);
  IF coalesce(v_role, '') <> 'ADMIN' THEN
    RAISE EXCEPTION 'Apenas administradores podem arquivar automações.';
  END IF;

  UPDATE public.automation_rules
  SET status='PAUSED',
      next_run_at=NULL,
      archived_at=now(),
      archived_by=v_user_id,
      updated_by=v_user_id,
      updated_at=now()
  WHERE id=p_automation_id
    AND store_id=p_store_id
    AND archived_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automação não encontrada.';
  END IF;

  RETURN jsonb_build_object('success',true,'id',p_automation_id,'archived',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.test_automation_rule(
  p_store_id uuid,
  p_automation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  r public.automation_rules%rowtype;
  v_event jsonb;
  v_eval jsonb;
  v_last_success timestamptz;
  v_in_cooldown boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;

  v_role := public.get_user_store_role(p_store_id);
  IF coalesce(v_role, '') NOT IN ('ADMIN','MANAGER') THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  SELECT * INTO r
  FROM public.automation_rules
  WHERE id=p_automation_id
    AND store_id=p_store_id
    AND archived_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automação não encontrada.';
  END IF;

  IF r.trigger_type IN ('SALE_COMPLETED','SALE_CANCELLED','RETURN_COMPLETED') THEN
    SELECT jsonb_build_object(
      'id',e.id,
      'event_type',e.event_type,
      'reference_id',e.reference_id,
      'payload',e.payload,
      'created_at',e.created_at
    )
    INTO v_event
    FROM public.automation_events e
    WHERE e.store_id=r.store_id
      AND e.event_type=r.trigger_type
      AND e.automation_id IS NULL
    ORDER BY e.created_at DESC
    LIMIT 1;
  END IF;

  v_eval := public.evaluate_automation_rule(r.id, v_event);

  SELECT max(finished_at) INTO v_last_success
  FROM public.automation_runs
  WHERE automation_id=r.id AND status='COMPLETED';

  v_in_cooldown := r.cooldown_minutes > 0
    AND v_last_success IS NOT NULL
    AND v_last_success > now() - make_interval(mins => r.cooldown_minutes);

  RETURN jsonb_build_object(
    'success',true,
    'dry_run',true,
    'rule_id',r.id,
    'eligible',coalesce((v_eval->>'eligible')::boolean,false),
    'matched_count',coalesce((v_eval->>'matched_count')::bigint,0),
    'evaluation',v_eval,
    'in_cooldown',v_in_cooldown,
    'next_run_at',r.next_run_at,
    'message',CASE
      WHEN v_in_cooldown THEN 'A regra atende às condições, mas está no intervalo de cooldown.'
      WHEN coalesce((v_eval->>'eligible')::boolean,false) THEN 'A regra seria executada. Nenhuma ação foi realizada.'
      ELSE 'A regra não seria executada com os dados atuais.'
    END
  );
END;
$$;

-- Keep the evaluator internal. The public dry-run RPC above is the authorized entrypoint.
REVOKE ALL ON FUNCTION public.evaluate_automation_rule(uuid,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_automation_rule(uuid,jsonb)
  TO service_role;

-- Explicit RPC grants after replacing the functions as SECURITY DEFINER.
REVOKE ALL ON FUNCTION public.create_automation_rule(uuid,text,text,text,text,jsonb,jsonb,integer,integer,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_automation_rule(uuid,text,text,text,text,jsonb,jsonb,integer,integer,text,text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.update_automation_rule(uuid,uuid,text,text,text,text,jsonb,jsonb,integer,integer,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_automation_rule(uuid,uuid,text,text,text,text,jsonb,jsonb,integer,integer,text,text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.set_automation_rule_status(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_automation_rule_status(uuid,uuid,text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.delete_automation_rule(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_automation_rule(uuid,uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.test_automation_rule(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.test_automation_rule(uuid,uuid)
  TO authenticated;

-- 3) Retry FAILED idempotent runs, while concurrent RUNNING/finished duplicates remain skipped.
CREATE OR REPLACE FUNCTION public.execute_automation_rule(
  p_automation_id uuid,
  p_idempotency_key text,
  p_mode text default 'scheduled',
  p_source_event_id uuid default null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.automation_rules%rowtype;
  v_run_id uuid;
  v_started timestamptz := clock_timestamp();
  v_last_success timestamptz;
  v_eval jsonb;
  v_source jsonb;
  v_action jsonb;
  v_action_type text;
  v_action_index int := 0;
  v_event_type text;
  v_status text := 'COMPLETED';
  v_reason text;
BEGIN
  SELECT * INTO r
  FROM public.automation_rules
  WHERE id=p_automation_id
    AND status='ACTIVE'
    AND archived_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'status','SKIPPED','reason','inactive_or_archived');
  END IF;

  INSERT INTO public.automation_runs(
    automation_id,store_id,event_type,event_id,reference_id,
    idempotency_key,status,result,started_at
  )
  VALUES (
    r.id,r.store_id,r.trigger_type,
    CASE WHEN p_source_event_id IS NOT NULL THEN p_source_event_id::text ELSE NULL END,
    NULL,p_idempotency_key,'RUNNING',
    jsonb_build_object('mode',p_mode),v_started
  )
  ON CONFLICT (automation_id,store_id,idempotency_key) DO UPDATE
    SET status='RUNNING',
        result=excluded.result,
        error_message=NULL,
        started_at=excluded.started_at,
        finished_at=NULL,
        duration_ms=NULL
    WHERE automation_runs.status = 'FAILED'
  RETURNING id INTO v_run_id;

  IF v_run_id IS NULL THEN
    RETURN jsonb_build_object('success',true,'status','SKIPPED','reason','duplicate');
  END IF;

  SELECT max(finished_at) INTO v_last_success
  FROM public.automation_runs
  WHERE automation_id=r.id
    AND id<>v_run_id
    AND status='COMPLETED';

  IF r.cooldown_minutes > 0
     AND v_last_success IS NOT NULL
     AND v_last_success > now() - make_interval(mins => r.cooldown_minutes) THEN
    v_status := 'SKIPPED';
    v_reason := 'cooldown';
  ELSE
    IF p_source_event_id IS NOT NULL THEN
      SELECT jsonb_build_object(
        'id',e.id,
        'event_type',e.event_type,
        'reference_id',e.reference_id,
        'payload',e.payload,
        'created_at',e.created_at
      )
      INTO v_source
      FROM public.automation_events e
      WHERE e.id=p_source_event_id;
    END IF;

    v_eval := public.evaluate_automation_rule(r.id,v_source);

    IF NOT coalesce((v_eval->>'eligible')::boolean,false) THEN
      v_status := 'SKIPPED';
      v_reason := 'conditions_not_met';
    ELSE
      FOR v_action IN
        SELECT value
        FROM jsonb_array_elements(coalesce(r.actions,'[]'::jsonb))
      LOOP
        v_action_index := v_action_index + 1;
        v_action_type := coalesce(v_action->>'type','AUDIT');

        v_event_type := CASE v_action_type
          WHEN 'CREATE_ALERT' THEN 'ALERT'
          WHEN 'CREATE_NOTIFICATION' THEN 'NOTIFICATION'
          WHEN 'REQUEST_INTERVENTION' THEN 'INTERVENTION'
          WHEN 'GENERATE_REPORT' THEN 'REPORT_READY'
          ELSE 'AUDIT'
        END;

        INSERT INTO public.automation_events(
          store_id,automation_id,event_type,reference_id,
          idempotency_key,payload,processed_at
        )
        VALUES (
          r.store_id,r.id,v_event_type,NULL,
          format('action:%s:%s',v_run_id,v_action_index),
          jsonb_build_object(
            'automation_id',r.id,
            'automation_name',r.name,
            'trigger',r.trigger_type,
            'action',v_action_type,
            'matched_count',coalesce((v_eval->>'matched_count')::bigint,0),
            'summary',coalesce(v_eval->'summary','{}'::jsonb),
            'source_event_id',p_source_event_id
          ),
          now()
        )
        ON CONFLICT DO NOTHING;
      END LOOP;
    END IF;
  END IF;

  UPDATE public.automation_runs
  SET status=v_status,
      result=jsonb_build_object(
        'success',v_status<>'FAILED',
        'mode',p_mode,
        'reason',v_reason,
        'evaluation',coalesce(v_eval,'{}'::jsonb)
      ),
      finished_at=clock_timestamp(),
      duration_ms=round(extract(epoch FROM (clock_timestamp()-v_started))*1000)::bigint
  WHERE id=v_run_id;

  UPDATE public.automation_rules
  SET last_run_at=now(),
      next_run_at=CASE
        WHEN schedule IS NULL THEN NULL
        ELSE public.automation_next_run(trigger_type,schedule,timezone,coalesce(next_run_at,now()))
      END,
      execution_count=execution_count + CASE WHEN v_status='COMPLETED' THEN 1 ELSE 0 END,
      updated_at=now()
  WHERE id=r.id;

  RETURN jsonb_build_object(
    'success',true,
    'status',v_status,
    'reason',v_reason,
    'run_id',v_run_id,
    'evaluation',coalesce(v_eval,'{}'::jsonb)
  );

EXCEPTION WHEN OTHERS THEN
  IF v_run_id IS NOT NULL THEN
    UPDATE public.automation_runs
    SET status='FAILED',
        error_message=sqlerrm,
        finished_at=clock_timestamp(),
        duration_ms=round(extract(epoch FROM (clock_timestamp()-v_started))*1000)::bigint
    WHERE id=v_run_id;
  END IF;

  UPDATE public.automation_rules
  SET failure_count=failure_count+1,
      last_run_at=now(),
      next_run_at=CASE
        WHEN schedule IS NULL THEN NULL
        ELSE public.automation_next_run(trigger_type,schedule,timezone,coalesce(next_run_at,now()))
      END,
      updated_at=now()
  WHERE id=p_automation_id;

  RETURN jsonb_build_object('success',false,'status','FAILED','error',sqlerrm);
END;
$$;

REVOKE ALL ON FUNCTION public.execute_automation_rule(uuid,text,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_automation_rule(uuid,text,text,uuid)
  TO service_role;

-- 4) Claim scheduled rules and input events so overlapping workers cannot finalize each other's work.
CREATE OR REPLACE FUNCTION public.run_automation_cycle(
  p_store_id uuid default null,
  p_mode text default 'scheduled'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.automation_rules%rowtype;
  e public.automation_events%rowtype;
  v_result jsonb;
  v_scheduled int := 0;
  v_events int := 0;
  v_failed int := 0;
  v_event_failed boolean;
BEGIN
  UPDATE public.automation_rules
  SET next_run_at=public.automation_next_run(trigger_type,schedule,timezone,now())
  WHERE status='ACTIVE'
    AND archived_at IS NULL
    AND schedule IS NOT NULL
    AND next_run_at IS NULL
    AND (p_store_id IS NULL OR store_id=p_store_id);

  FOR r IN
    SELECT *
    FROM public.automation_rules
    WHERE status='ACTIVE'
      AND archived_at IS NULL
      AND schedule IS NOT NULL
      AND next_run_at <= now()
      AND (p_store_id IS NULL OR store_id=p_store_id)
    ORDER BY priority DESC,next_run_at,created_at
    LIMIT 200
    FOR UPDATE SKIP LOCKED
  LOOP
    v_result := public.execute_automation_rule(
      r.id,
      format('schedule:%s:%s',r.id,to_char(r.next_run_at AT TIME ZONE 'UTC','YYYYMMDDHH24MISS')),
      p_mode,
      NULL
    );

    v_scheduled := v_scheduled+1;
    IF v_result->>'status'='FAILED' THEN
      v_failed := v_failed+1;
    END IF;
  END LOOP;

  FOR e IN
    SELECT *
    FROM public.automation_events
    WHERE automation_id IS NULL
      AND processed_at IS NULL
      AND event_type IN ('SALE_COMPLETED','SALE_CANCELLED','RETURN_COMPLETED','LOW_STOCK','OUT_OF_STOCK')
      AND (p_store_id IS NULL OR store_id=p_store_id)
    ORDER BY created_at
    LIMIT 200
    FOR UPDATE SKIP LOCKED
  LOOP
    v_event_failed := false;

    FOR r IN
      SELECT *
      FROM public.automation_rules
      WHERE store_id=e.store_id
        AND status='ACTIVE'
        AND archived_at IS NULL
        AND trigger_type=e.event_type
      ORDER BY priority DESC,created_at
    LOOP
      v_result := public.execute_automation_rule(
        r.id,
        format('event:%s:%s',e.id,r.id),
        'event',
        e.id
      );

      IF v_result->>'status'='FAILED' THEN
        v_event_failed := true;
        v_failed := v_failed+1;
      END IF;
    END LOOP;

    IF v_event_failed THEN
      UPDATE public.automation_events
      SET processing_error='Uma ou mais regras falharam no processamento.'
      WHERE id=e.id;
    ELSE
      UPDATE public.automation_events
      SET processed_at=now(),processing_error=NULL
      WHERE id=e.id;
    END IF;

    v_events := v_events+1;
  END LOOP;

  RETURN jsonb_build_object(
    'success',true,
    'mode',p_mode,
    'scheduled_processed',v_scheduled,
    'events_processed',v_events,
    'failed',v_failed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_automation_cycle(uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_automation_cycle(uuid,text)
  TO service_role;

-- 5) Final privilege reconciliation for sales/return RPCs recreated by historical migrations.
DO $$
DECLARE
  v_fn record;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure AS fn
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('complete_sale','create_mp_pix_sale','process_return')
  LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || v_fn.fn || ' FROM PUBLIC, anon, authenticated';
  END LOOP;

  IF to_regprocedure('public.complete_sale(uuid,uuid,text,text,jsonb,text,integer,numeric,numeric,text)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.complete_sale(uuid,uuid,text,text,jsonb,text,integer,numeric,numeric,text) TO authenticated';
  END IF;

  IF to_regprocedure('public.create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric,uuid,text)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_mp_pix_sale(uuid,text,text,jsonb,numeric,numeric,uuid,text) TO authenticated';
  END IF;

  IF to_regprocedure('public.process_return(uuid,uuid,uuid,text,text,jsonb,text,text)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.process_return(uuid,uuid,uuid,text,text,jsonb,text,text) TO authenticated';
  END IF;
END
$$;
