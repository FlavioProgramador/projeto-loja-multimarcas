# Relatório de Auditoria Técnica Diária - CoreSys (VESTRA)
**Data da Auditoria:** 13 de Outubro de 2026
**Auditor:** Engenheiro de Software Sênior (Jules / CoreSys Tech Audit)
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`

---

##  EXECUTIVE SUMMARY & VISÃO GERAL

O sistema **CoreSys (VESTRA)** passou por uma auditoria técnica profunda cobrindo:
1. **Segurança e RLS (Row Level Security):** Avaliação de RLS, funções `SECURITY DEFINER`, políticas de acesso e segurança de colunas sensíveis (ex: custo do produto).
2. **Isolamento Multi-Tenant (`store_id`):** Garantia de isolamento rigoroso entre lojas para evitar IDOR (Insecure Direct Object Reference) e BOLA (Broken Object Level Authorization).
3. **Qualidade do Frontend e Inconsistências:** Verificação de tratamento de erros, dependências de hooks React, variáveis sem uso e sincronização de estado com o Supabase.
4. **Performance do Banco de Dados:** Análise de índices compostos, consultas com paginação/filtros por `store_id` e views materializadas/RPCs.
5. **Integrações e Funções de Borda (Edge Functions):** Análise do webhook Mercado Pago, criação de PIX e idempotência de transações.

---

## 1. QUADRO RESUMO DOS ACHADOS POR SEVERIDADE

| ID | Severidade | Categoria | Descrição Sumária |
|---|---|---|---|
| **SEC-01** | **CRÍTICO** | Segurança / Multi-Tenant | Riscos de IDOR em inserções diretas do Frontend em tabelas financeiras e cadastrais sem validação de `store_id` vinculada à sessão no payload |
| **SEC-02** | **ALTO** | Segurança / Auth | Funções `SECURITY DEFINER` e triggers legados requerem revisão contínua de privilégios de execução (`REVOKE EXECUTE FROM public/anon`) |
| **FE-01** | **MÉDIO** | Frontend / Ciclo de Vida | Desatualização de dependências em Hooks React (`useEffect` / `useCallback`) em telas críticas (`PdvView`, `FinanceView`, `MovementsView`) gerando potenciais re-renders desnecessários ou chamadas com estado desatualizado |
| **FE-02** | **MÉDIO** | Frontend / Código Morto | Presença de 26 avisos de Linter referentes a variáveis e importações não utilizadas em componentes de UI |
| **PERF-01** | **MÉDIO** | Banco de Dados / Performance | Necessidade de monitoramento contínuo de índices compostos `(store_id, created_at)` e `(store_id, status)` para tabelas de alto volume (`sales`, `financial_transactions`, `stock_movements`) |
| **INT-01** | **BAIXO** | Integrações / Resiliência | Tratamento de erros no recebimento de Webhooks do Mercado Pago exige garantia de resposta 200 OK imediata para evitar retentativas excessivas |

---

## 2. DETALHAMENTO DOS ACHADOS E RECOMENDAÇÕES

---

### 🔴 SEC-01 [CRÍTICO]: Inserção direta no Supabase via Frontend em Tabelas Multi-tenant sem validação RLS do `store_id` no lado do Servidor

- **Severidade:** **CRÍTICO**
- **Explicação do Problema:**
  Em alguns serviços do frontend (`finance.service.ts`, `customers.service.ts`), chamadas de inserção/atualização direta do cliente Supabase enviam o `store_id` vindo do estado local (`useStoreData` / `StoreContext`). Embora existam políticas de RLS no PostgreSQL checando `current_user_has_store_access(store_id)`, se o frontend for manipulado para enviar um `store_id` arbitrária pertencente a outra loja para a qual o usuário também possua acesso (ou se RLS falhar), a operação poderá afetar o tenant incorreto. Operações financeiras e de estoque devem preferencialmente ser transacionadas via RPCs `SECURITY DEFINER` atômicas.
- **Arquivos/Tabelas/Funções Afetados:**
  - `src/services/finance.service.ts` (`addTransaction`, `addExpense`)
  - `src/services/customers.service.ts` (`createCustomer`)
  - Tabelas `financial_transactions`, `expenses`, `customers`
- **Sugestão de Correção:**
  1. Padronizar todas as mutações sensíveis de dados (especialmente financeiro e estoque) via RPCs PostgreSQL dedicadas (ex: `add_financial_transaction_rpc`), onde a função valida no PostgreSQL se `auth.uid()` tem acesso ativo à loja informada antes de executar o `INSERT`.
  2. Manter as políticas de RLS restritivas com `WITH CHECK (current_user_has_store_access(store_id))` ativas em todas as tabelas com `store_id`.

---

### 🟠 SEC-02 [ALTO]: Manutenção e Controle de Privilégios em RPCs `SECURITY DEFINER`

- **Severidade:** **ALTO**
- **Explicação do Problema:**
  O sistema possui diversas funções com o atributo `SECURITY DEFINER` (ex: `complete_sale`, `process_return`, `cancel_sale`, `register_stock_entry`, `server_pagination_*`). Funções `SECURITY DEFINER` executam com as permissões do criador da função (normalmente `postgres` / `service_role`). Se o acesso a essas RPCs não for explicitamente revogado da role `anon` ou `public`, usuários não autenticados poderiam invocar essas rotinas.
- **Arquivos/Tabelas/Funções Afetados:**
  - `supabase/migrations/20261003000000_coresys_audit_final_remediation.sql`
  - Funções `complete_sale`, `process_return`, `cancel_sale`, `register_stock_entry`, `report_commercial_summary`
- **Sugestão de Correção:**
  1. Garantir que todas as migrations contenham explicitamente:
     ```sql
     REVOKE EXECUTE ON FUNCTION public.nome_da_funcao FROM PUBLIC, anon;
     GRANT EXECUTE ON FUNCTION public.nome_da_funcao TO authenticated;
     ```
  2. Garantir que toda função `SECURITY DEFINER` defina `SET search_path = public` para evitar ataques de manipulação de `search_path`.

---

### 🟡 FE-01 [MÉDIO]: Dependências ausentes em Hooks React (`useEffect` e `useCallback`)

- **Severidade:** **MÉDIO**
- **Explicação do Problema:**
  Diversos componentes principais da interface possuem alertas de Linter referentes ao `react-hooks/exhaustive-deps`. Por exemplo, no `PdvView.tsx`, a função `handleConfirmSale` é redefinida a cada render sem `useCallback`, provocando potenciais acoplamentos e disparos indesejados no `useEffect`. No `FinanceView.tsx` e `MovementsView.tsx`, funções de carregamento de dados não estão incluídas no array de dependências do `useEffect`.
- **Arquivos Afetados:**
  - `src/components/pdv/PdvView.tsx`
  - `src/components/finance/FinanceView.tsx`
  - `src/components/movements/MovementsView.tsx`
  - `src/components/dashboard/RevenueChart.tsx`
  - `src/components/dashboard/TopProductsChart.tsx`
- **Sugestão de Correção:**
  1. Envolver funções assíncronas de busca e manipuladores de eventos em `useCallback` mantendo dependências limpas.
  2. Ajustar os arrays de dependências dos `useEffect` para evitar chamadas de API duplicadas ou dados obsoletos (*stale closure*).

---

### 🟡 FE-02 [MÉDIO]: Limpeza de Código Morto e Variáveis Não Utilizadas (26 Warnings de Linter)

- **Severidade:** **MÉDIO**
- **Explicação do Problema:**
  O comando de linter (`npm run lint`) aponta 26 avisos referentes a importações e variáveis declaradas mas não utilizadas (ex: `CreditCard`, `formatPaymentMethod` em `DashboardView`, `PlusCircle` em `NewProductModal`, `Trash2` em `InventoryView`). Embora não quebrem o build, aumentam o tamanho do bundle e poluem o código fonte.
- **Arquivos Afetados:**
  - `src/components/dashboard/DashboardView.tsx`
  - `src/components/inventory/InventoryView.tsx`
  - `src/components/inventory/NewProductModal.tsx`
  - `src/components/inventory/StockEntryModal.tsx`
  - `src/components/returns/NewReturnModal.tsx`
  - `src/components/suppliers/SupplierForm.tsx`
  - `src/contexts/AuthContext.tsx`, `CartContext.tsx`, `StoreContext.tsx`, `ThemeContext.tsx`
- **Sugestão de Correção:**
  Remover os componentes e variáveis não utilizados ou prefixá-los com `_` conforme convenção configurada nas regras do ESLint.

---

### 🟡 PERF-01 [MÉDIO]: Otimização de Índices no Banco de Dados para Consultas Multi-tenant

- **Severidade:** **MÉDIO**
- **Explicação do Problema:**
  Tabelas de movimentação contínua como `sales`, `stock_movements`, `financial_transactions` e `automations_execution_history` crescem rapidamente. Filtros realizados pelo frontend quase sempre combinam `store_id` com intervalo de datas (`created_at`) ou status (`status`). A ausência de índices compostos adequados pode causar *Seq Scan* em grandes volumes de dados.
- **Arquivos/Tabelas Afetados:**
  - Tabelas: `sales`, `financial_transactions`, `stock_movements`, `customers`
  - Migrations: `supabase/migrations/*_performance_indexes.sql`
- **Sugestão de Correção:**
  Garantir a existência de índices compostos btree:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_sales_store_created ON public.sales(store_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_fin_tx_store_created ON public.financial_transactions(store_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_stock_mov_store_created ON public.stock_movements(store_id, created_at DESC);
  ```

---

### 🟢 INT-01 [BAIXO]: Resiliência e Idempotência do Webhook Mercado Pago (`mp-webhook`)

- **Severidade:** **BAIXO**
- **Explicação do Problema:**
  A Edge Function `mp-webhook` processa eventos de pagamento via PIX. Caso ocorra uma falha temporária no banco de dados durante o processamento, se a função lançar exceção não capturada, o gateway continuará reenviando notificações.
- **Arquivos Afetados:**
  - `supabase/functions/mp-webhook/index.ts`
  - Tabela `mp_processed_events`
- **Sugestão de Correção:**
  Garantir bloco `try/catch` robusto na Edge Function gravando falhas e retornando HTTP 200/202 para o gateway do Mercado Pago quando o evento for processado ou descartado por idempotência.

---

## 3. RECOMENDAÇÕES FINAIS E PRÓXIMOS PASSOS

1. **Reforço de RPCs Transacionais:** Migrar mutações diretas do frontend em `financial_transactions` para RPCs transacionais no Supabase.
2. **Higiene de Linter e Refatoração de Hooks:** Corrigir os 26 avisos de linter e refatorar `useEffect`/`useCallback` nos componentes de UI apontados.
3. **Monitoramento Contínuo:** Manter a rotina diária de auditoria técnica e execução do pipeline de testes (`npm run test:all`).

---
*Relatório gerado em compliance com os padrões de arquitetura e segurança do CoreSys (VESTRA).*
