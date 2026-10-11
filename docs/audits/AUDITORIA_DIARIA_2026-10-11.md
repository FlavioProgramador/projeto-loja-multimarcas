# Relatório de Auditoria Técnica Diária — CoreSys (11/10/2026)

**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Data:** 11/10/2026
**Auditor:** Engenharia de Software Sênior (CoreSys)

---

## 1. Visão Geral da Auditoria

Esta auditoria técnica diária analisou a arquitetura do CoreSys em busca de vulnerabilidades de segurança, falhas no isolamento multi-tenant, regressões, vazamento de dados, IDOR/BOLA, funções `SECURITY DEFINER` inseguras, problemas de performance e inconsistências no frontend/backend.

Nesta etapa, de acordo com as diretrizes do projeto, **não foram realizadas alterações no código da aplicação nem no schema do banco**, concentrando o esforço no mapeamento completo e classificação dos achados.

---

## 2. Sumário Executivo dos Achados

| ID | Item / Descrição | Severidade | Módulo |
|---|---|---|---|
| **SEC-01** | Risco BOLA/IDOR na reversão de vendas PIX usando `service_role` em Edge Function | **CRÍTICO** | Edge Functions / Backend |
| **SEC-02** | Risco de estado inconsistente de estoque em falhas de comunicação com Mercado Pago | **ALTO** | Edge Functions / PDV |
| **FE-01** | Efeitos colaterais (`useEffect`) no React sem dependências completas durante troca de loja | **MÉDIO** | Frontend / React Hooks |
| **FE-02** | Avisos de Fast Refresh devido a exportação mista nos arquivos de Contexto | **MÉDIO** | Frontend / Contexts |
| **CODE-01**| Presença de imports e variáveis não utilizadas (`no-unused-vars`) | **BAIXO** | Frontend / Code Quality |

---

## 3. Detalhamento dos Achados e Sugestões de Correção

### SEC-01: Risco BOLA/IDOR na reversão de vendas PIX usando `service_role` (CRÍTICO)

* **Descrição:**
  A Edge Function `create-mp-pix` intercepta a resposta da API do Mercado Pago. Caso ocorra uma rejeição ou falha da requisição, a função invoca `cancel_mp_pix_sale` utilizando um cliente Supabase de `service_role` (que contorna o RLS). Embora o `sale_id` venha do resultado da criação da venda no mesmo escopo da requisição, caso ocorra manipulação externa ou se o fluxo for modificado para aceitar parâmetros remotos, o uso de `service_role` sem checagem de escopo explícito no SQL pode permitir cancelamento de vendas de outros tenants.
* **Afetados:**
  - Arquivo: `supabase/functions/create-mp-pix/index.ts`
  - RPC: `public.cancel_mp_pix_sale`
* **Sugestão de Correção:**
  Garantir que a RPC `cancel_mp_pix_sale` ou qualquer RPC invocada via `service_role` valide que o `sale_id` obrigatoriamente pertence ao `store_id` e ao usuário do contexto autenticado original, impedindo cancelamentos transversais entre lojas.

---

### SEC-02: Possível estado inconsistente de estoque em timeouts de rede na geração de PIX (ALTO)

* **Descrição:**
  Quando um pagamento PIX é iniciado no PDV, a RPC `create_mp_pix_sale` reserva o estoque do produto e gera a venda no status `PENDING`. Se a comunicação HTTP entre a Edge Function e o Mercado Pago falhar por timeout de socket ou queda de conexão (antes de receber uma resposta `!ok`), o cancelamento automático `cancel_mp_pix_sale` não é executado e a venda permanece travando a reserva de estoque indefiro.
* **Afetados:**
  - Arquivo: `supabase/functions/create-mp-pix/index.ts`
  - Tabela: `public.sales`, `public.store_inventory`
  - Worker: `supabase/functions/mp-pix-reconciliation-worker`
* **Sugestão de Correção:**
  Implementar ou refinar a rotina do worker de reconciliação para cancelar automaticamente reservas de vendas PIX `PENDING` sem confirmação após 15 minutos, liberando o estoque de forma resiliente.

---

### FE-01: Dependências ausentes em `useEffect` nos componentes visuais (MÉDIO)

* **Descrição:**
  Componentes principais como `FinanceView`, `MovementsView`, `RevenueChart` e `TopProductsChart` possuem ganchos `useEffect` com dependências omitidas (ex: `loadTransactions`, `loadExpenses`, `loadMovements`, `data`, `labels`). Em cenários onde o usuário altera a loja ativa através do seletor de lojas (`StoreContext`), existe o risco de o componente continuar exibindo dados filtrados pela loja anterior.
* **Afetados:**
  - `src/components/finance/FinanceView.tsx`
  - `src/components/movements/MovementsView.tsx`
  - `src/components/dashboard/RevenueChart.tsx`
  - `src/components/dashboard/TopProductsChart.tsx`
  - `src/components/pdv/PdvView.tsx`
* **Sugestão de Correção:**
  Refatorar as funções de busca de dados para usarem `useCallback` com dependência em `storeId` ou incluir as dependências corretas nos vetores de dependência do `useEffect`.

---

### FE-02: Avisos de Fast Refresh devido a exportação mista nos arquivos de Contexto (MÉDIO)

* **Descrição:**
  Os arquivos `AuthContext.tsx`, `CartContext.tsx`, `StoreContext.tsx` e `ThemeContext.tsx` exportam componentes React e simultaneamente exportam constantes/funções utilitárias de auxílio. O ESLint emite alertas referente ao React Fast Refresh (`react-refresh/only-export-components`).
* **Afetados:**
  - `src/contexts/AuthContext.tsx`
  - `src/contexts/CartContext.tsx`
  - `src/contexts/StoreContext.tsx`
  - `src/contexts/ThemeContext.tsx`
* **Sugestão de Correção:**
  Mover funções de auxílio e constantes para arquivos dedicados na pasta `src/lib/` ou `src/utils/`, mantendo os arquivos dos contextos focados unicamente na exportação do Provider e do Custom Hook.

---

### CODE-01: Imports e variáveis declaradas sem uso (BAIXO)

* **Descrição:**
  O linter do projeto apontou 26 avisos referentes a ícones e variáveis importadas que não estão sendo utilizadas nos componentes.
* **Afetados:**
  - `src/components/dashboard/DashboardView.tsx`
  - `src/components/inventory/InventoryView.tsx`
  - `src/components/inventory/NewProductModal.tsx`
  - `src/components/inventory/StockEntryModal.tsx`
  - `src/components/returns/NewReturnModal.tsx`
  - `src/components/suppliers/SupplierForm.tsx`
  - `src/services/store.service.ts`
* **Sugestão de Correção:**
  Remover todas as declarações sem uso para manter a base limpa e reduzir o tempo de compilação.

---

## 4. Próximos Passos Recomendados

1. Priorizar a implementação de correções para os itens **SEC-01 (CRÍTICO)** e **SEC-02 (ALTO)** na próxima sprint.
2. Agendar a limpeza de alertas de lint e acerto de hooks no frontend.
