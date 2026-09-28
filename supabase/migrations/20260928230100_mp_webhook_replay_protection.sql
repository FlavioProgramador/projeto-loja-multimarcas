BEGIN;

CREATE TABLE IF NOT EXISTS public.mp_webhook_events (
  request_id text PRIMARY KEY,
  provider_payment_id text NOT NULL,
  signature_ts bigint NOT NULL,
  received_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_mp_webhook_events_received_at
  ON public.mp_webhook_events (received_at);

ALTER TABLE public.mp_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mp_webhook_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.mp_webhook_events TO service_role;

DROP POLICY IF EXISTS "mp_webhook_events deny all" ON public.mp_webhook_events;
CREATE POLICY "mp_webhook_events deny all"
  ON public.mp_webhook_events
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

COMMIT;
