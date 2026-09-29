# Auditoria do Banco de Dados — Vestra ERP (Supabase/PostgreSQL)

Escopo: `supabase/migrations/*.sql` (26 arquivos) e `supabase/functions/*`. A auditoria é estática, baseada nas migrações.

## Achados

### CRÍTICOS

**1. Migrações não são reproduzíveis do zero (schema drift) — CRÍTICO**
Tabelas `physical_inventories`, `physical_inventory_items`, `returns`, `return_items`, `customer_credit_movements` **nunca são criadas em nenhuma migração**, mas são referenciadas por índices, RLS e RPCs em `20260927184000_hardening_supabase_final.sql`, `20260927190000_seguranca_rpcs_privilegios_e_indices_20260927.sql`, etc. (`CREATE INDEX ... ON public.physical_inventories(...)` falha). Igualmente, `ALTER FUNCTION public.cancel_sale(uuid)`, `process_return`, `report_*` referenciam funções só criadas nas migrações de 28/09 (aplicadas depois). Um `supabase db reset` quebra na migração 20260927184000.
→ Criar migração consolidada com essas tabelas/funções ou reordenar; montar o schema exclusivamente via migrações.

**2. Idempotência com "armadilha" gera venda órfã COMPLETED — CRÍTICO**
`20260828000003_multi_store.sql` (`complete_sale`, linhas ~322–378): o `INSERT INTO public.sales` acontece **antes** do bloco `BEGIN ... INSERT INTO sale_idempotency ... EXCEPTION WHEN unique_violation`. Como a exceção é capturada num sub-bloco, o INSERT da venda **não é desfeito**: em retry com a mesma chave, a função retorna a venda antiga mas deixa uma venda COMPLETED duplicada (sem itens/pagamento, consumindo `sale_number_seq`). A versão posterior `20260924000005_integridade_vendas.sql` faz INSERT direto (a exceção aborta a transação toda — correto), mas coexistem duas definições de `complete_sale` conflitantes (ver #4).
→ Alinhar com a versão de `integridade_vendas` (ou inserir idempotência antes da venda).

**3. Cadastro de usuário com role vinda dos metadados do signup — CRÍTICO (mitigado tarde)**
`20260101000000_setup.sql` (`handle_new_user`, linha 46): `COALESCE(NEW.raw_user_meta_data->>'role', 'EMPLOYEE')` — qualquer usuário que se cadastre enviando `role: 'ADMIN'` nos metadados vira ADMIN. Somente corrigido em `20260928240000_provision_new_user_store_access.sql` (hardcode `'EMPLOYEE'`). Em qualquer ambiente provisionado antes/até essa migração, o vetor existia.
→ Confirmar a versão final em produção e auditar `profiles` existentes por roles indevidos.

**4. Definições conflitantes/sobrepostas da mesma RPC em migrações — ALTO**
`complete_sale` é (re)definida 4 vezes com assinaturas e lógicas diferentes: `setup.sql` (aceita `unit_price` do cliente — preço arbitrário!) → `20260828000000_hardening_rpcs.sql` (idem) → `20260828000003_multi_store.sql` (multi-loja, bug #2) → `20260924000005_integridade_vendas.sql` (mais correta). `cancel_mp_pix_sale` 3 vezes; `register_stock_entry` 3 vezes; `get_variant_stock_by_store` 2 vezes (`20260927190200` sem filtro de loja ativa do usuário vs `20260928230400` correto). A versão vigente depende da ordem lexicográfica — funciona por acidente; qualquer `CREATE OR REPLACE` de assinatura antiga ainda viva expõe comportamento preço-cliente (só mitigado por REVOKE tardio em `20260928230000`).
→ Consolidar em uma definição final por função e usar `DROP FUNCTION` das assinaturas legadas (hoje só há REVOKE).

**5. Migrações gigantes duplicadas: `20260928000001_hardening_auth_integrity.sql` (54 KB) vs `20260928230000_auth_integrity_hardening.sql` (47 KB) — ALTO**
~70% de linhas idênticas; ambas recriam as mesmas dezenas de funções (`complete_sale`, `create_mp_pix_sale`, `process_return`, `approve_physical_inventory`, relatórios). Em caso de diferença sutil entre elas (existem, ex.: assinaturas de `report_*`), o estado final é o da segunda, mas manutenção duplicada é fonte de regressão: corrigir um arquivo e não o outro é exatamente o tipo de falha que reintroduz o bug #3/#2.
→ Fundir em uma migração e deletar a outra.

**6. Timestamp `20260928240000` usado por dois arquivos — MÉDIO/ALTO**
`20260928240000_admin_store_access_management.sql` e `20260928240000_provision_new_user_store_access.sql`. O Supabase versiona por timestamp; timestamps iguais violam unicidade (o CLI rejeita/ordena por nome alfabético). `admin_store_access_management` cria RPC que depende de `user_store_access` — ordem ok por sorte alfabética, mas `db push` novo em projeto limpo pode falhar por versão duplicada.
→ Renomear um para `20260928240100`.

### INTEGRIDADE REFERENCIAL E CHECKS

**7. Deleção de loja inconsistente: CASCADE em `sales.store_id` vs RESTRICT em `sale_items.sale_id` — ALTO**
`20260828000003` (linha 50): `sales.store_id ... ON DELETE CASCADE`, mas `20260825000000_fase1_integridade.sql` mudou `sale_items`/`payments` → `sales` para `ON DELETE RESTRICT`. Resultado: deletar uma loja com vendas gera erro (comportamento não intencional); sem vendas, deleta o histórico. Decidir política explícita: preferir `RESTRICT` na loja e desativação (`is_active=false`).

**8. `inventory_movements.store_id` e derivações sem índice nas FKs — MÉDIO**
FKs criadas em `20260828000003` (`sales.store_id`, `inventory_movements.store_id`, `financial_transactions.store_id`, `fixed_expenses.store_id`) **não têm índice**. Igualmente `store_inventory.product_variant_id` só ganhou índice em 20260927 (confirmar presença), e `sale_items.product_id` tem índice criado **duas vezes** (`20260828000002` e `20260927190000` — ambos `idx_sale_items_product_id`, segunda é no-op) e `idx_sales_user_id`/`idx_inventory_movements_user_id` também duplicados.
→ Adicionar índices faltantes em `*.store_id`; remover duplicados.

**9. Colunas `is_active` de soft delete mortas/inconsistentes — MÉDIO**
`20260828000004_soft_delete_and_fixes.sql` adiciona `is_active` a `sales`, `sale_items`, `payments`, `inventory_movements`, `financial_transactions`, mas nenhuma RPC/view/policy filtra essa coluna (cancelamentos usam `status='CANCELLED'`). Não há `deleted_at` em lugar nenhum (padrão "soft delete" é apenas `is_active`). Risco: algum código futuro setar `is_active=false` e relatórios continuarem somando. Nota conflitante: `20260927190400` usa status de inventário `'IN_PROGRESS'/'DRAFT'`, enquanto `20260928230500` exige status `'OPEN'` nos itens — **inconsistência de enum de status**: item só editável com `OPEN`, mas aprovação só aceita `IN_PROGRESS`/`DRAFT` (um dos caminhos é intransitável).
→ Padronizar enum de status e remover/acionar de fato o soft delete.

**10. `payments.amount` pode divergir e sem CHECK de valor por venda — MÉDIO**
Não há CHECK/trigger garantindo `SUM(payments.amount) = sales.total` nem unicidade de um pagamento aprovado por venda; `complete_sale`/`create_mp_pix_sale` inserem pagamento presume-se único, mas `approve_mp_pix_sale` pega "o mais recente" com `ORDER BY created_at DESC LIMIT 1` — pagamentos duplicados (retry) passam despercebidos. Falta também CHECK `discount <= subtotal` em `sales` (mitigado na RPC por `LEAST`, mas INSERT direto via outras vias não é coberto; só há proteção por trigger de role, não de valores).

### FUNÇÕES / RPCs

**11. Lock FOR UPDATE sem ordenação determinística — risco de deadlock — MÉDIO**
Em `complete_sale` (todas as versões) e `create_mp_pix_sale`, o primeiro loop faz `SELECT ... FOR UPDATE` na ordem dos itens do JSON do cliente. Duas vendas simultâneas com as mesmas variantes em ordens diferentes → deadlock. A versão `cancel_sale` de `20260928000001` corretamente usa `ORDER BY product_variant_id`; aplicar o mesmo nos loops de venda.

**12. `current_setting('request.jwt.claims', true)::json` sem tratamento — MÉDIO**
`cancel_mp_pix_sale` (`hardening_rpcs`, linha 282) e `enforce_sale_store_role` fazem cast direto de `request.jwt.claims` para `::json`; em contexto sem JWT (ex.: service via SQL direto, `NULL`), retorna NULL e `->>'role'` é NULL — ok —, mas se a setting estiver presente e malformada, quebra com erro. Recomenda-se `COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::json, '{}')`. Melhor ainda: em chamadas service_role via PostgREST a claim existe; em jobs internos, padronizar.

**13. `sales.completed_at` com DEFAULT now() — venda PENDING nasce "concluída" — BAIXO/MÉDIO**
`setup.sql` linha 246: `completed_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())`. Vendas PIX criadas como `PENDING` recebem `completed_at` preenchido até o cancelamento (que o zera). Relatórios por `completed_at` incluem vendas pendentes. Falta CHECK (`status='COMPLETED' => completed_at IS NOT NULL`).

### TIPOS DE DADOS

**14. Monetários em NUMERIC(12,2) — OK; porém teto de R$ 9.999.999.999,99 e sem moeda — INFO**
Adequado o uso de `NUMERIC` (nenhum FLOAT/REAL encontrado). Ressalvas: `products.sale_price NUMERIC(12,2)` limite baixo para expansão; `customers.cpf/document` como TEXT UNIQUE sem CHECK de formato/dígitos (CPF inválido entra); `TIMESTAMP` vs `TIMESTAMPTZ`: consistente em TIMESTAMPTZ, exceto defaults via `TIMEZONE('utc', NOW())` misturados com `NOW()` (sem `'utc'`) nas RPCs — ambos gravam timestamptz, mas o fuso de sessão afeta `NOW()` exibido; padronizar.

### EDGE FUNCTIONS

**15. `mp-webhook`: bom replay guard, mas falta verificação de que `data.id` é pagamento; `create-mp-pix` sem idempotência no provedor — MÉDIO**
`mp-webhook/index.ts`: assinatura HMAC e `mp_webhook_events` por `x-request-id` — correto. Porém não valida `paymentInfo.external_reference` contra o formato/esperado (aceita qualquer sale_id de conta MP, permitindo aprovar venda alheia com pagamento de valor diferente — **falta conferir `transaction_amount` vs `sales.total`**; um PIX de R$1 aprova venda de R$1000). `create-mp-pix/index.ts`: gera `providerIdempotencyKey = pix-${idempotencyKey}` mas **nunca o envia ao Mercado Pago** (falta header `X-Idempotency-Key`) — retry no POST ao MP cria cobrança duplicada. Além disso, se o POST ao MP falhar após criar a venda PENDING, o estoque fica reservado indefinidamente (não há job de expiração no repo).
→ Validar valor no webhook e enviar o X-Idempotency-Key ao MP; criar rotina de expiração de PIX PENDING.

## Resumo de prioridade

| # | Achado | Severidade |
|---|--------|-----------|
| 1 | Migrações não reproduzíveis (tabelas ausentes) | Crítico |
| 2 | Idempotência gera venda órfã COMPLETED | Crítico |
| 3 | Role via metadados no `handle_new_user` | Crítico |
| 4 | RPCs redefinidas 3–4x, assinatura antiga com preço do cliente | Alto |
| 5 | Duas migrações gigantes ~70% duplicadas | Alto |
| 6 | Timestamp duplicado 20260928240000 | Médio/Alto |
| 7 | CASCADE x RESTRICT inconsistente (store→sales→items) | Alto |
| 8 | FKs `store_id` sem índice; índices duplicados | Médio |
| 9 | Soft delete `is_active` morto; status inventário OPEN vs IN_PROGRESS | Médio |
| 10 | Sem CHECK de coerência pagamento×venda | Médio |
| 11 | Locks FOR UPDATE sem ORDER BY (deadlock) | Médio |
| 12 | `request.jwt.claims` cast sem COALESCE | Médio |
| 13 | `completed_at` default em venda PENDING | Baixo/Médio |
| 14 | NUMERIC ok; CPF sem CHECK; fuso inconsistente | Info |
| 15 | Webhook não confere valor; idempotency-key não enviada ao MP | Médio |
