BEGIN;

ALTER TABLE public.mp_webhook_events
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text;

COMMENT ON COLUMN public.mp_webhook_events.processed_at IS 'UTC timestamp when webhook business processing completed successfully.';
COMMENT ON COLUMN public.mp_webhook_events.processing_started_at IS 'UTC timestamp when this delivery was claimed for processing.';
COMMENT ON COLUMN public.mp_webhook_events.attempts IS 'Number of processing attempts for this webhook delivery.';
COMMENT ON COLUMN public.mp_webhook_events.last_error IS 'Last sanitized processing error, when applicable.';

CREATE OR REPLACE FUNCTION public.claim_mp_webhook_event(
  p_request_id text,
  p_provider_payment_id text,
  p_signature_ts bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event public.mp_webhook_events;
BEGIN
  IF NULLIF(btrim(p_request_id), '') IS NULL
     OR NULLIF(btrim(p_provider_payment_id), '') IS NULL
     OR p_signature_ts IS NULL THEN
    RAISE EXCEPTION 'Dados do webhook inválidos.';
  END IF;

  INSERT INTO public.mp_webhook_events(
    request_id, provider_payment_id, signature_ts, processing_started_at, attempts
  )
  VALUES(
    btrim(p_request_id),
    btrim(p_provider_payment_id),
    p_signature_ts,
    timezone('utc', now()),
    1
  )
  ON CONFLICT (request_id) DO NOTHING;

  SELECT *
    INTO v_event
  FROM public.mp_webhook_events
  WHERE request_id = btrim(p_request_id)
  FOR UPDATE;

  IF v_event.processed_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'processed');
  END IF;

  IF v_event.processing_started_at IS NOT NULL
     AND v_event.processing_started_at > timezone('utc', now()) - interval '10 minutes'
     AND v_event.attempts > 0
     AND v_event.last_error IS NULL THEN
    RETURN jsonb_build_object('status', 'in_progress');
  END IF;

  UPDATE public.mp_webhook_events
  SET
    provider_payment_id = btrim(p_provider_payment_id),
    signature_ts = p_signature_ts,
    processing_started_at = timezone('utc', now()),
    attempts = attempts + CASE WHEN processing_started_at IS NULL THEN 0 ELSE 1 END,
    last_error = NULL
  WHERE request_id = btrim(p_request_id)
  RETURNING * INTO v_event;

  RETURN jsonb_build_object('status', 'claimed');
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_mp_webhook_event(
  p_request_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.mp_webhook_events
  SET processed_at = timezone('utc', now()),
      processing_started_at = NULL,
      last_error = NULL
  WHERE request_id = btrim(p_request_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evento de webhook não encontrado.';
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_mp_webhook_event(
  p_request_id text,
  p_error text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.mp_webhook_events
  SET
    processing_started_at = NULL,
    last_error = left(coalesce(NULLIF(btrim(p_error), ''), 'Webhook processing failed'), 500)
  WHERE request_id = btrim(p_request_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evento de webhook não encontrado.';
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_mp_webhook_event(text,text,bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_mp_webhook_event(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_mp_webhook_event(text,text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_mp_webhook_event(text,text,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_mp_webhook_event(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_mp_webhook_event(text,text) TO service_role;

ALTER FUNCTION public.claim_mp_webhook_event(text,text,bigint) SET search_path = public;
ALTER FUNCTION public.complete_mp_webhook_event(text) SET search_path = public;
ALTER FUNCTION public.fail_mp_webhook_event(text,text) SET search_path = public;

COMMIT;