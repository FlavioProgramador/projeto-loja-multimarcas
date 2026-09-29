# Testes do banco de dados

## Estrutura

- `0001_structure.sql`, `0002_security.sql` — testes **pgTAP**, rodados por `supabase test db`
  sobre um banco recriado do zero pelas migrações (local ou CI).
- `manual/` — smoke/regressão transacionais que **precisam de dados existentes**
  (admin, loja, variante ativos). Rode manualmente contra staging:

  ```powershell
  psql "$env:STAGING_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/manual/20260928_auth_integrity_smoke.sql
  ```

## Como rodar localmente

```powershell
npm run test:db        # equivale a: supabase test db
```

> **Pré-requisito conhecido (auditoria 2026-09-29, achado C3):** as tabelas
> `physical_inventories`, `physical_inventory_items`, `returns`, `return_items` e
> `customer_credit_movements` nunca foram criadas em migração (foram criadas à mão
> no dashboard), então `supabase db reset`/`supabase test db` falham até que uma
> migração de baseline seja criada (`supabase db diff`). Por isso o job
> `database.yml` na CI está com `continue-on-error: true` temporariamente.

## Convenções

- Todo teste pgTAP roda dentro de `BEGIN; ... ROLLBACK;` — nenhum dado persiste.
- Declare `SELECT plan(N);` com o número exato de asserções.
- Testes de comportamento que alteram dados devem usar fixtures dentro da própria
  transação (ver exemplos em `manual/`).
