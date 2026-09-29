# Auditoria Geral — Vestra ERP (2026-09-29)

Consolidação de 4 auditorias independentes (segurança, frontend, backend/SQL, qualidade/DevOps) executadas nesta data, mais verificações diretas (typecheck, secrets, estrutura).

Relatórios detalhados:
- [AUDITORIA_QUALIDADE_DEVOPS.md](AUDITORIA_QUALIDADE_DEVOPS.md)
- `relatorio-auditoria-banco.md` (raiz do projeto)
- Achados de segurança e frontend consolidados abaixo.

---

## 1. Resumo executivo

| Área | Nota | Principal problema |
|---|---|---|
| Segurança | ⚠️ | Vazamento multi-tenant: `customers`, `suppliers`, `coupons`, `fixed_expenses` com RLS `USING (true)` |
| Frontend | ⚠️ | Preço unitário de venda/PIX vem do cliente (adulterável); IDs por índice de array |
| Backend/SQL | ❌ | Migrações não reproduzíveis (`db reset` falha); bug de idempotência em `complete_sale` |
| Testes | ❌ | Zero testes automatizados (`"test"` é echo); smoke SQL não roda em CI |
| CI/CD | ⚠️ | Só typecheck+build; sem testes, lint ou deploy |
| Qualidade | ⚠️ | Sem ESLint/Prettier; tsconfig sem `strict`; typecheck **falhando** |

**Pontos fortes:** webhook MP com HMAC + replay protection corretos; edge function PIX bem construída; `search_path` fixo nas SECURITY DEFINER; RLS habilitado em todas as tabelas; venda via RPC atômica; dinheiro em `NUMERIC(12,2)` no banco; `.env` fora do Git; 19 migrações versionadas.

---

## 2. Achados CRÍTICOS

### C1. Venda/PIX com preço adulterável pelo cliente
- `src/services/sales.service.ts:78` e `src/components/pdv/PdvView.tsx:208-215`: `unit_price: item.preco` vai no payload da RPC `complete_sale` e da Edge Function `create-mp-pix`. Via DevTools, qualquer um altera o preço e o **valor do PIX gerado**.
- Agravante (backend): as primeiras versões de `complete_sale` aceitam `unit_price` do cliente e as assinaturas legadas nunca receberam DROP (só REVOKE tardio em `20260928230000`).
- Agravante (edge): `mp-webhook` **não confere `transaction_amount` do MP com `sales.total`** → PIX de valor menor aprova venda maior.
- **Correção:** servidor ignora preços do payload e consulta `products.sale_price`; validar `transaction_amount` no webhook; DROP das assinaturas legadas.

### C2. Vazamento multi-tenant (RLS permissivo)
- `customers` (com CPF), `suppliers`, `coupons`: SELECT/UPDATE com `USING (true)`, sem `store_id` (setup.sql:786,792,817,823; hardening_rls.sql:85).
- `fixed_expenses` ganhou `store_id NOT NULL` (multi_store.sql:53) mas a policy de leitura continua `USING (true)` → **despesas financeiras vazam entre lojas**.
- **Correção:** escopar políticas por `public.has_store_access(store_id)`; adicionar `store_id` onde fizer sentido.

### C3. Schema não reproduzível
- Tabelas `physical_inventories`, `physical_inventory_items`, `returns`, `return_items`, `customer_credit_movements` nunca são criadas em migração alguma, mas são referenciadas por índices/RLS/funções → `supabase db reset` falha; schema drift (criadas manualmente no dashboard).
- **Correção:** gerar migração de baseline a partir do schema de produção (`supabase db diff`).

### C4. Privilege escalation no signup
- `handle_new_user` (setup.sql) atribuía role de `raw_user_meta_data` — signup com `role:'ADMIN'` virava admin. Corrigido só em `20260928240000_provision_new_user_store_access`.
- **Ação:** auditar a tabela `profiles` em produção à procura de admins indevidos criados antes da correção.

### C5. Bug de idempotência em `complete_sale`
- `20260828000003_multi_store.sql`: INSERT em `sales` ocorre ANTES do bloco EXCEPTION que captura `unique_violation` da idempotency table → retry gera venda COMPLETED órfã duplicada (sem itens/pagamento).

### C6. IDs instáveis por índice de array
- `id: index + 1` em products/sales/finance/customers services (ex.: `products.service.ts:74`). Como `getAll` ordena por nome, inserir/renomear remapeia todos os IDs; `CartItem.produtoId` passa a apontar para o produto errado após refresh.

### C7. Zero testes + ambiguidade DEV/PROD
- `"test"` é echo placeholder; os 2 SQLs em `supabase/tests/` não rodam em pipeline.
- `.env` aponta para projeto `ndrjynlbwrugakjqtzwy` que o próprio README admite não saber se é DEV ou PRODUÇÃO; CI usa o mesmo secret para todos os ambientes.

---

## 3. Achados ALTOS

### Frontend
- **F1.** `toggleExpensePaid` sem rollback e ignorando retorno do service (`StoreContext.tsx:760-771`) — UI e banco divergem sem aviso.
- **F2.** Fallback silencioso para cache localStorage (`StoreContext.tsx:279-283`) — PDV vende com preço/estoque desatualizado sem avisar.
- **F3.** Closure de PIX no realtime (`PdvView.tsx:153-192`) — recibo usa `cart`/`calculatedTotal` do momento do subscribe; sem timeout/expiração do PIX.
- **F4.** `checkAlerts` com stale closure (`StoreContext.tsx:712`) — alerta de ruptura uma venda atrasado.
- **F5.** `JSON.parse` do localStorage sem try/catch (`StoreContext.tsx:115-153`) — cache corrompido = tela branca.
- **F6.** Saldo de crédito calculado no cliente somando histórico completo sem paginação (`customers.service.ts:62-85`).
- **F7.** Desconto sem teto: `% > 100` ou desconto > subtotal gera venda a R$ 0 (`PdvView.tsx:96-101`).
- **F8.** Custo do estoque inicial sempre 0: `prodData.custo` não existe no tipo (`StoreContext.tsx:372`) — **typecheck falhando**.
- **F9.** Dinheiro em float binário + `toFixed(2).replace('.', ',')` sem separador de milhar (`lib/utils.ts:3-5`).

### Backend/SQL
- **B1.** `complete_sale` redefinida 4× com lógicas divergentes; assinaturas legadas sem DROP.
- **B2.** `20260928000001` (54 KB) e `20260928230000` (47 KB) são ~70% duplicadas (901 linhas em comum).
- **B3.** Timestamp duplicado `20260928240000` em duas migrações (conflito potencial no `supabase migration up`).
- **B4.** CASCADE em `sales.store_id` vs RESTRICT em `sale_items`/`payments` — deleção de loja com vendas falha.
- **B5.** `create-mp-pix` monta `providerIdempotencyKey` mas **nunca envia o header `X-Idempotency-Key` ao Mercado Pago** → retry cria cobrança duplicada.
- **B6.** Falha no POST ao MP deixa estoque reservado (venda PENDING) sem job de expiração.

### Qualidade/CI
- **Q1.** CI roda apenas `npm ci → typecheck → build`; sem testes, lint ou deploy real; 2 workflows órfãos.
- **Q2.** Sem ESLint/Prettier; script `"lint"` é alias de `tsc` (enganoso); tsconfig sem `strict`.
- **Q3.** Drift: README cita Recharts/date-fns (não instalados) e branch `staging` (workflow usa `release/*`).

---

## 4. Achados MÉDIOS (seleção)

- Sessão Supabase em localStorage por padrão (risco XSS) — `src/lib/auth-storage.ts:13-33`.
- CORS do webhook reflete origem arbitrária (fallback `*`) — `mp-webhook/index.ts:7`.
- `qs` <6.16.0 vulnerável (GHSA-4mjr-xmp4-gh2g, GHSA-x5fp-wj9c-mxmx) via `body-parser`/`express`; express é dep direta possivelmente ociosa.
- FKs `store_id` sem índice (sales, inventory_movements, financial_transactions, fixed_expenses).
- Locks `FOR UPDATE` sem `ORDER BY` consistente → risco de deadlock entre vendas concorrentes.
- `sales.completed_at` com `DEFAULT now()` — venda PENDING nasce "concluída".
- Status de inventário inconsistente entre migrações 20260927190400 vs 20260928230500 (caminho intransitável).
- `addItem`/`updateQuantity` falham silenciosamente no limite de estoque (retornam success).
- Casts `any` e ausência de validação de payloads do banco (recomendação: zod).
- Timers sem cleanup e listener de teclado re-registrado a cada render no PDV.
- Venda local (modo offline) gravada como `'EXPENSE'`; devolução local sem estorno financeiro.
- Migração 20260928220700 faz DROP de policy que nunca existiu.
- Anon JWT com expiração ~2036 nos `.env` locais.
- cpf/cnpj sem CHECK de formato; misto `NOW()` vs `TIMEZONE('utc', NOW())`.
- docs/audits/ com 10 relatórios antigos acumulados; encoding não-UTF-8 (mojibake) em vários arquivos.

---

## 5. Plano de ação priorizado

### Semana 1 (críticos de dinheiro e dados)
1. **Corrigir RLS** de `customers`, `suppliers`, `coupons`, `fixed_expenses` → escopo por loja.
2. **Preço server-side**: RPC/edge ignoram `unit_price` do cliente; webhook confere `transaction_amount`.
3. Enviar `X-Idempotency-Key` ao Mercado Pago; corrigir ordem EXCEPTION/INSERT em `complete_sale`.
4. Auditar `profiles` em produção (admins indevidos).
5. Classificar o projeto Supabase (`ndrjynlbwrugakjqtzwy`) como DEV ou PROD antes de qualquer comando destrutivo.

### Semana 2 (estabilidade)
6. Migração de baseline (criar tabelas faltantes) para tornar `db reset` reproduzível.
7. IDs estáveis (UUID) na UI; remover `id: index + 1`.
8. Corrigir o erro de typecheck (`prodData.custo`) e ligar typecheck como portão real (já está no CI — atualmente falharia).
9. Validação de desconto (≤100%, ≤subtotal); teto e confirmação.
10. Banner "modo offline" + bloqueio de checkout quando Supabase falhar.

### Mês 1 (qualidade)
11. Stack de testes: Vitest + Testing Library (unit), Playwright (E2E PDV/PIX), `supabase test db`/pgTAP (SQL), Deno test (edge functions). Tornar `"test"` real e adicionar à CI.
12. ESLint + Prettier + `strict: true` no tsconfig (incremental).
13. Dinheiro em centavos (inteiros) + `Intl.NumberFormat('pt-BR')`.
14. Job de expiração de PIX/vendas PENDING; timeout no fluxo PIX do PDV.
15. GitHub Environment secrets por ambiente + gitleaks; rotacionar anon key junto com correção do RLS.

---

*Gerado automaticamente pela auditoria de 2026-09-29 (4 agentes + verificações diretas).*
