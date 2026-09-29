-- Testes estruturais do schema (pgTAP) — Vestra ERP
-- Executados via `supabase test db` (local ou CI) em banco recriado do zero pelas migrações.
-- Não dependem de dados de exemplo: validam tabelas, colunas multi-loja, funções e RLS.

BEGIN;
SELECT plan(37);

-- ============================================================
-- 1. Tabelas centrais existem (19)
-- ============================================================
SELECT has_table('public', name, format('tabela public.%s existe', name))
FROM (VALUES
  ('profiles'),
  ('brands'),
  ('categories'),
  ('products'),
  ('product_variants'),
  ('customers'),
  ('suppliers'),
  ('inventory_movements'),
  ('coupons'),
  ('sales'),
  ('sale_items'),
  ('payments'),
  ('financial_transactions'),
  ('fixed_expenses'),
  ('stores'),
  ('user_store_access'),
  ('store_inventory'),
  ('sale_idempotency'),
  ('mp_webhook_events')
) AS t(name);

-- ============================================================
-- 2. Isolamento multi-loja: colunas store_id presentes (6)
--    (migração 20260828000003_multi_store.sql)
-- ============================================================
SELECT has_column('public', tbl, 'store_id', format('public.%s.store_id existe', tbl))
FROM (VALUES
  ('sales'),
  ('inventory_movements'),
  ('financial_transactions'),
  ('fixed_expenses'),
  ('user_store_access'),
  ('store_inventory')
) AS t(tbl);

-- ============================================================
-- 3. Funções de segurança/negócio existem (3)
-- ============================================================
SELECT has_function('public', 'has_store_access', 'função has_store_access existe');
SELECT has_function('public', 'get_user_store_role', 'função get_user_store_role existe');
SELECT has_function('public', 'complete_sale', 'função complete_sale existe');

-- ============================================================
-- 4. RLS habilitado nas tabelas sensíveis (9)
-- ============================================================
SELECT ok(c.relrowsecurity, format('RLS habilitado em public.%s', c.relname))
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'sales', 'sale_items', 'payments', 'customers', 'suppliers',
    'financial_transactions', 'stores', 'user_store_access', 'mp_webhook_events'
  )
ORDER BY c.relname;

SELECT * FROM finish();
ROLLBACK;
