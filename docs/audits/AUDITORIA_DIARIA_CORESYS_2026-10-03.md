# Relatório de Auditoria Técnica Diária — CoreSys (2026-10-03)

**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Data:** 03 de Outubro de 2026
**Auditor:** Engenheiro de Software Sênior (CoreSys Tech Audit)

---

## 1. Visão Geral e Resumo Executivo

Esta auditoria técnica diária analisou o estado atual do codebase e do Supabase do ecossistema **CoreSys (Vestra ERP/PDV)**, cobrindo:
- Segurança de Autenticação (Supabase Auth, RLS e RPCs `SECURITY DEFINER`);
- Isolamento Multi-tenant (`store_id`, `has_store_access`, `user_store_access`);
- Inexistência de vazamentos cross-tenant (IDOR/BOLA);
- Resiliência e idempotência nas transações de venda e estoque (`complete_sale`, `create_mp_pix_sale`, `cancel_sale`, `process_return`);
- Performance e paginação server-side (`get_customer_directory_page`, `get_finance_page`, `report_commercial_summary`);
- Qualidade do código frontend React/TypeScript, warnings de linter e código não utilizado.

---

## 2. Quadro de Achados por Severidade

| Severidade | Quantidade | Foco Principal |
| :--- | :--- | :--- |
| 🔴 **CRÍTICO** | 0 | *Nenhuma falha crítica aberta (todas remediadas nas migrações recentes).* |
| 🟠 **ALTO** | 1 | Ausência de filtro `store_id` em operações diretas do cliente de mutação (`update`/`delete` de clientes e despesas). |
| 🟡 **MÉDIO** | 2 | Fallbacks legados em memória com busca de tabelas inteiras caso RPCs falhem; Warnings de dependências em `useEffect` e variáveis não utilizadas. |
| 🟢 **BAIXO** | 2 | Exportações que acionam alerta de Fast Refresh no React; Dependências não utilizadas no `package.json`. |

---

## 3. Detalhamento dos Achados

### 🟠 ALTO-01 — Ausência de Filtro Explícito de `store_id` no Cliente em Mutação de Clientes e Despesas (Defesa em Profundidade / BOLA)

- **Severidade:** ALTO
- **Explicação:**
  Apesar de o Row Level Security (RLS) no PostgreSQL garantir que updates sejam bloqueados se o usuário não possuir acesso à loja daquele registro, métodos client-side como `CustomersService.update(uuid, customer)`, `CustomersService.remove(uuid)` e `FinanceService.toggleExpensePaid(uuid, state)` executam queries do tipo `.update(payload).eq('id', uuid)` sem incluir `.eq('store_id', storeId)`.
  Caso ocorra alguma falha na política RLS ou alteração acidental no banco, a query client-side não impõe a barreira de tenant.
- **Arquivos / Tabelas / Funções Afetados:**
  - `src/services/customers.service.ts` (`update`, `remove`)
  - `src/services/finance.service.ts` (`toggleExpensePaid`)
  - Tabelas: `public.customers`, `public.fixed_expenses`
- **Sugestão de Correção:**
  Passar `storeId` obrigatoriamente para as assinaturas dos métodos `update` e `remove` em `CustomersService` e `FinanceService`, e adicionar `.eq('store_id', storeId)` em todas as mutações no Supabase client.

---

### 🟡 MÉDIO-01 — Fallback Legado Client-Side com Carregamento de Tabelas Inteiras

- **Severidade:** MÉDIO
- **Explicação:**
  Os serviços de Clientes (`CustomersService`), Financeiro (`FinanceService`) e Devoluções (`ReturnsService`) implementam um mecanismo de fallback chamando `getLegacyAll()` quando a RPC server-side (`get_customer_directory_page`, `get_finance_page`, etc.) retorna erro `PGRST202`. O fallback busca todos os registros da tabela sem limitação de quantidade e realiza filtros, ordenações e agregações em memória JavaScript. Em ambientes com milhares de vendas e clientes, isso acarreta alto consumo de memória e latência de rede.
- **Arquivos / Tabelas / Funções Afetados:**
  - `src/services/customers.service.ts` (`getLegacyAll`, `legacyStats`)
  - `src/services/finance.service.ts` (`getTransactionRecords`, `legacyFilter`)
  - `src/services/returns.service.ts` (`getLegacyReturnsPage`)
- **Sugestão de Correção:**
  Garantir que as migrações SQL com as RPCs paginadas estejam sempre aplicadas no ambiente de produção e descontinuar o fallback client-side `getLegacyAll` após estabilização do banco.

---

### 🟡 MÉDIO-02 — Warnings de Linter por Variáveis Não Utilizadas e Array de Dependências do `useEffect`

- **Severidade:** MÉDIO
- **Explicação:**
  A execução de `npm run lint` reporta 26 avisos (warnings) de ESLint referentes a ícones/variáveis importados e não utilizados (ex: `CreditCard` em `DashboardView.tsx`, `ChevronDown` e `Trash2` em `InventoryView.tsx`, `PlusCircle` em `NewProductModal.tsx`), estados declarados sem uso em `PdvView.tsx` (`setSelectedColecao`, `setSelectedEstacao`), e dependências omitidas em `useEffect` nos componentes de gráfico (`RevenueChart.tsx`, `TopProductsChart.tsx`) e telas (`FinanceView.tsx`, `MovementsView.tsx`).
- **Arquivos / Tabelas / Funções Afetados:**
  - `src/components/dashboard/DashboardView.tsx`
  - `src/components/dashboard/RevenueChart.tsx`
  - `src/components/dashboard/TopProductsChart.tsx`
  - `src/components/finance/FinanceView.tsx`
  - `src/components/inventory/InventoryView.tsx`
  - `src/components/pdv/PdvView.tsx`
- **Sugestão de Correção:**
  Limpar as variáveis e imports não utilizados e ajustar as dependências do `useEffect` envolvidas em `useCallback` ou memoização para garantir conformidade total com as regras do `eslint-plugin-react-hooks`.

---

### 🟢 BAIXO-01 — Alertas de Fast Refresh no Export de Constantes nos Contextos React

- **Severidade:** BAIXO
- **Explicação:**
  Os arquivos de Contexto (`AuthContext.tsx`, `CartContext.tsx`, `StoreContext.tsx`, `ThemeContext.tsx`) exportam utilitários e constantes junto aos componentes e custom hooks, o que dispara o aviso do plugin `react-refresh/only-export-components`.
- **Arquivos / Tabelas / Funções Afetados:**
  - `src/contexts/AuthContext.tsx`
  - `src/contexts/CartContext.tsx`
  - `src/contexts/StoreContext.tsx`
  - `src/contexts/ThemeContext.tsx`
- **Sugestão de Correção:**
  Mover tipos, constantes e funções utilitárias para arquivos auxiliares dedicados (ex: `src/types/auth.ts`, `src/lib/cart-utils.ts`).

---

### 🟢 BAIXO-02 — Dependências Mortas no `package.json`

- **Severidade:** BAIXO
- **Explicação:**
  A dependência `express` está presente em `package.json`, mas não é importada pelo código do frontend ou pelas Edge Functions Deno.
- **Arquivos / Tabelas / Funções Afetados:**
  - `package.json`
- **Sugestão de Correção:**
  Executar `npm uninstall express` para reduzir a árvore de dependências e a superfície de auditoria.

---

## 4. Avaliação de Módulos Críticos

### A. Isolamento Multi-Tenant e RLS
- **Status:** **APROVADO**
- Todas as tabelas transacionais (`sales`, `inventory_movements`, `financial_transactions`, `fixed_expenses`, `customers`, `returns`, `store_inventory`, `user_store_access`) possuem a coluna `store_id` indexada.
- As políticas de RLS dependem de `public.has_store_access(store_id)` e `public.get_user_store_role(store_id)`.
- RPCs críticas como `complete_sale`, `create_mp_pix_sale`, `cancel_sale`, `process_return` e `report_commercial_summary` validam rigidamente o acesso à loja informado via `get_user_store_role(p_store_id)`.

### B. Funções SECURITY DEFINER e Práticas de Banco
- **Status:** **APROVADO**
- Todas as funções `SECURITY DEFINER` nas migrações recentes possuem a instrução `SET search_path = public` ou `public, pg_temp`, prevenindo ataques de *search_path hijacking*.
- Os privilégios de execução (`GRANT EXECUTE`) foram revogados para `PUBLIC` e `anon`, sendo permitidos apenas para a role `authenticated` (ou executados estritamente via Service Role nas Edge Functions).

### C. Integrações e Edge Functions (Mercado Pago PIX)
- **Status:** **APROVADO**
- A Edge Function `mp-webhook` realiza validação criptográfica de assinatura HMAC SHA-256 (`x-signature` e `x-request-id`) com `MERCADOPAGO_WEBHOOK_SECRET`.
- O processamento de webhook conta com proteção contra replay através de `claim_mp_webhook_event`.
- A Edge Function `create-mp-pix` utiliza `Deno.env.get` corretamente para obter as variáveis de ambiente.

---

## 5. Próximos Passos Recomendados

1. **Defesa em Profundidade Client-side:**
   Adicionar o parâmetro `storeId` nos métodos de alteração/exclusão em `CustomersService` e `FinanceService`.
2. **Refatoração dos Linter Warnings:**
   Remover as 26 ocorrências de código/imports sem uso e ajustar as dependências do React.
3. **Execução Contínua de Testes:**
   Manter a pipeline de CI rodando `npm run test:all` (`typecheck`, `lint`, `vitest`).

---
*Relatório assinado digitalmente pelo sistema de auditoria automatizada CoreSys.*
