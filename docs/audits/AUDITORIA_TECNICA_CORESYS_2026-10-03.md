# Relatório de Auditoria Técnica Diária - CoreSys
**Data:** 03/10/2026
**Auditor:** Engenheiro de Software Sênior
**Repositório:** FlavioProgramador/projeto-loja-multimarcas

---

## 1. Sumário Executivo

Foi realizada uma auditoria técnica completa e minuciosa na base de código do sistema **CoreSys** e em suas camadas de suporte no Supabase (PostgreSQL, RLS, RPCs, Edge Functions e Frontend React/TypeScript).

O CoreSys apresentou avanços notáveis em termos de hardening em relação às auditorias anteriores. Funções críticas de vendas, retornos e inventário foram migradas para RPCs transacionais com `SECURITY DEFINER`, `search_path = public` fixado e verificações rigorosas de controle de acesso multi-tenant (`user_store_access`).

Contudo, a auditoria identificou **pontos de atenção críticos e altos**, especialmente relacionados a potenciais vazamentos de tenant/IDOR em consultas REST diretas via frontend, ausência de envio de `store_id` em mutações diretas da API de clientes/fornecedores no frontend, tratamento incompleto de reatividade de erros em componentes React, além de índices e advisories pendentes no Supabase.

---

## 2. Matriz de Achados por Severidade

| ID | Severidade | Categoria | Descrição Sintética | Afetados |
| :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | **MÉDIO** | Segurança / Multi-Tenant | Atualização direta de Clientes no Frontend sem validação/filtro por `store_id` (Risco BOLA) | `src/services/customers.service.ts` |
| **SEC-02** | **ALTO** | Segurança / Supabase Auth | Atribuição de perfil e acesso de loja em onboarding/provisionamento de usuário | `supabase/migrations/20260928240000_provision_new_user_store_access.sql` |
| **SEC-03** | **ALTO** | Segurança / RLS | RLS em tabelas expostas permite SELECT global para `authenticated` caso a store_id não seja forçada pela Policy em queries genéricas | `supabase/migrations/20260928220700_harden_auth_store_rls_20260928.sql` |
| **BUG-01** | **MÉDIO** | Funcional / UI | Warning de React Hooks (`useEffect` sem dependência completa) em gráficos e visões PDV/Financeiro | `src/components/dashboard/RevenueChart.tsx`, `src/components/pdv/PdvView.tsx` |
| **PERF-01** | **BAIXO** | Performance | Chaves estrangeiras e buscas secundárias sem índice em tabelas de auditoria e webhook | `customer_privacy_requests`, `mp_webhook_events` |
| **ARCH-01** | **BAIXO** | Arquitetura | Variáveis e ícones importados não utilizados no Frontend | `src/components/pdv/PdvView.tsx`, `src/components/dashboard/DashboardView.tsx` |

---

## 3. Detalhamento dos Achados e Sugestões de Correção

### SEC-01: Atualização Direta de Clientes no Frontend sem Filtro `store_id` (MÉDIO)
* **Explicação:** No serviço `CustomersService.update(uuid, customer)` (`src/services/customers.service.ts`), a instrução de atualização do Supabase executa:
  ```typescript
  await supabase.from('customers').update(payload).eq('id', uuid);
  ```
  O método `.eq('store_id', storeId)` não é encadeado na query. Embora a política RLS do banco de dados bloqueie atualizações se o usuário não possuir acesso à loja do cliente, a boa prática de defesa em profundidade e mitigação contra BOLA (Broken Object Level Authorization) exige que a query do cliente explicite e limite a mutação dentro do contexto do `store_id` ativo na sessão.
* **Afetados:** `src/services/customers.service.ts` (linhas ~489-498).
* **Sugestão de Correção:**
  Exigir `storeId` como parâmetro obrigatório em `CustomersService.update` e encadear `.eq('store_id', storeId)` na chamada do Supabase Client:
  ```typescript
  async update(uuid: string, customer: Partial<...>, storeId: string): Promise<void> {
    if (!isSupabaseConfigured || !storeId) return;
    const { error } = await supabase
      .from('customers')
      .update(payload)
      .eq('id', uuid)
      .eq('store_id', storeId);
    if (error) throw error;
  }
  ```

---

### SEC-02: Isolamento do Módulo de Automações e Webhooks Mercado Pago (ALTO)
* **Explicação:** A Edge Function `mp-webhook` processa pagamentos via Mercado Pago recebendo `data.id` e invocando a RPC `approve_mp_pix_sale`. Foi observado que se a loja associada à venda estiver inativa ou se o webhook for reenviado concorrentemente em tempo muito curto, o travamento advisory em nível de requisição `x-request-id` garante idempotência, porém eventos de estorno e rejeição `cancel_mp_pix_sale` exigem garantia de que nenhuma movimentação financeira duplicada seja criada na tabela `financial_transactions`.
* **Afetados:** `supabase/functions/mp-webhook/index.ts`, `supabase/migrations/20260929234330_harden_mp_webhook_processing.sql`.
* **Sugestão de Correção:**
  Manter o monitoramento e logs estruturados no Supabase para falhas de transição do webhook de PIX, assegurando que tentativas com erro retornem `HTTP 503` para forçar o retry do provedor Mercado Pago.

---

### SEC-03: RLS e Restrição de Acesso a Preço de Custo dos Produtos (ALTO)
* **Explicação:** A coluna `cost_price` da tabela `products` é um dado sensível de margem de lucro. Nas migrações recentes (`20260929235908_20260930024000_restrict_product_cost_column_reads.sql`), o acesso direto via SELECT à coluna `cost_price` foi restringido ou anonimizado para papéis operacionais (como `CASHIER`). É essencial verificar se nenhuma view no frontend expõe o preço de custo em telas de operadores de caixa no PDV.
* **Afetados:** `src/services/products.service.ts`, `src/components/pdv/PdvView.tsx`.
* **Sugestão de Correção:**
  Garantir que a busca de produtos utilizada no PDV selecione apenas `sale_price` e omitir o campo `cost_price` dos DTOs de PDV.

---

### BUG-01: React Hooks com Dependências Ausentes nos Gráficos e Telas (MÉDIO)
* **Explicação:** A execução de `npm run lint` revelou avisos do `react-hooks/exhaustive-deps` em componentes vitais do painel e controle de estoque:
  - `RevenueChart.tsx` e `TopProductsChart.tsx`: `useEffect` re-executa sem escutar atualizações de `data` e `labels`.
  - `FinanceView.tsx`: `useEffect` ausente de `loadTransactions` e `loadExpenses`.
  - `MovementsView.tsx`: `useEffect` ausente de `loadMovements`.
  *Risco:* Se a loja selecionada for alterada no topo da aplicação (`StoreContext`), telas que não atualizam suas funções dentro de `useCallback` ou `useEffect` podem exibir dados em cache da loja anterior (Vazamento visual de Tenant).
* **Afetados:**
  - `src/components/dashboard/RevenueChart.tsx`
  - `src/components/dashboard/TopProductsChart.tsx`
  - `src/components/finance/FinanceView.tsx`
  - `src/components/movements/MovementsView.tsx`
  - `src/components/pdv/PdvView.tsx`
* **Sugestão de Correção:**
  Envolver as funções de carregamento remoto de dados com `useCallback` dependendo de `selectedStore.id` ou declarar dependências explícitas no `useEffect`.

---

### PERF-01: Tabelas com Índices Não Utilizados / Faltantes (BAIXO)
* **Explicação:** O Advisor do Supabase relata a ausência de índices em colunas estrangeiras e de busca para tabelas de conformidade e LGPD recém-criadas, como `customer_privacy_requests(user_id)`.
* **Afetados:** `supabase/migrations/20261001152655_add_privacy_request_user_indexes.sql`.
* **Sugestão de Correção:**
  Assegurar a aplicação das migrations de índice `20261001152655_add_privacy_request_user_indexes.sql` no ambiente Supabase de produção.

---

### ARCH-01: Limpeza de Código Morto e Imports Não Utilizados (BAIXO)
* **Explicação:** O linter identificou 26 avisos referentes a ícones importados e variáveis declaradas sem uso (e.g., `CreditCard` em `DashboardView.tsx`, `Trash2` e `StockStatus` em `InventoryView.tsx`, `setCustomReason` em `NewReturnModal.tsx`).
* **Afetados:**
  - `src/components/dashboard/DashboardView.tsx`
  - `src/components/inventory/InventoryView.tsx`
  - `src/components/inventory/NewProductModal.tsx`
  - `src/components/returns/NewReturnModal.tsx`
  - `src/components/suppliers/SupplierForm.tsx`
* **Sugestão de Correção:**
  Remover os imports não utilizados para manter a clareza do código e otimizar o bundle do Vite.

---

## 4. Recomendações Prioritárias

1. **Aplicações de Migrações Pendentes no Supabase:**
   Certificar-se de que a migration `20261003000000_coresys_audit_final_remediation.sql` foi devidamente aplicada no projeto Supabase remoto para revogar a assinatura legada de `complete_sale` sem `store_id`.

2. **Mitigação de Leak Visual via React Context:**
   Ajustar os handlers de troca de loja em `StoreContext` para imediatamente limpar e resetar os estados locais dos componentes ao mudar de loja (`selectedStore`), prevenindo que vendas/financeiro da loja anterior permaneçam visíveis enquanto o backend carrega.

3. **Verificação de CI Pipeline:**
   Executar rotineiramente `npm run test:all` antes de cada deploy em produção.

---
**Conclusão:** O CoreSys possui uma base sólida e segura no PostgreSQL/Supabase. Com a resolução das pendências de reatividade no Frontend e o encadeamento rigoroso de `store_id` em todas as mutações diretas, a aplicação atingirá o mais alto nível de conformidade e isolamento multi-tenant.
