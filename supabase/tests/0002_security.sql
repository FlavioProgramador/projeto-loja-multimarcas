-- Testes de comportamento de segurança (pgTAP) — Vestra ERP
-- Valida invariantes de segurança que NÃO dependem de dados de exemplo.

BEGIN;
SELECT plan(5);

-- ============================================================
-- 1. mp_webhook_events: replay protection por PRIMARY KEY (2)
-- ============================================================
SELECT lives_ok(
  $$INSERT INTO public.mp_webhook_events (request_id, provider_payment_id, signature_ts)
    VALUES ('test-request-1', '12345', 0)$$,
  'primeira entrega do webhook é registrada'
);

SELECT throws_ok(
  $$INSERT INTO public.mp_webhook_events (request_id, provider_payment_id, signature_ts)
    VALUES ('test-request-1', '12345', 0)$$,
  '23505',
  NULL,
  'reenvio (replay) com mesmo request_id é rejeitado por unique_violation'
);

-- ============================================================
-- 2. Funções SECURITY DEFINER têm search_path fixo (2)
-- ============================================================
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'complete_sale' AND p.prosecdef
      AND EXISTS (SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%')
  ),
  'complete_sale (SECURITY DEFINER) tem search_path fixo'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.proname NOT LIKE 'pgtap%'
      AND NOT EXISTS (
        SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%'
      )
  ),
  'nenhuma função SECURITY DEFINER fica sem search_path fixo'
);

-- ============================================================
-- 3. Anônimo não lê dados de vendas (1)
-- ============================================================
SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*)::int FROM public.sales),
  0,
  'role anon não enxerga vendas (RLS)'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
