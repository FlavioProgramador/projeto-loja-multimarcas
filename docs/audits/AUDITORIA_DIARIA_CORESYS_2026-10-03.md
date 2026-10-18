# 📊 Relatório de Auditoria Técnica Diária do CoreSys

**Data:** 03 de Outubro de 2026
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Escopo:** Frontend React/TypeScript, Serviços de Dados, Supabase Auth, RLS Policies e Transações/RPCs PostgreSQL
**Responsável:** Engenheiro de Software Sênior - Auditoria Técnica CoreSys

---

## 🎯 RESUMO DA AUDITORIA

A auditoria técnica diária analisou as alterações recentes na base de código, no fluxo multi-tenant, nas rotinas do PDV, serviços de dados e transações no Supabase. Foram identificados problemas críticos referentes à perda de persistência de crédito de clientes no banco, falta de isolamento tenant no módulo de fornecedores, riscos de vazamento de cache local e inconsistências transacionais.

---

## 🔴 PROBLEMAS CRÍTICOS (CRÍTICO)

### 1. BUG-01: Perda de Persistência e Inconsistência do Crédito de Cliente nas Vendas
- **Severidade:** CRÍTICO
- **Arquivos/Tabelas Afetados:**
  - `src/hooks/domains/useSalesDomain.ts`
  - `src/services/sales.service.ts`
  - RPC PostgreSQL: `public.complete_sale`
  - Tabela Supabase: `public.customer_credit_movements`
- **Descrição do Problema:**
  No PDV, quando uma venda utiliza crédito do cliente (`creditUsed > 0`), o hook `useSalesDomain` abate o crédito apenas no estado React local (`setCustomers`). Ao chamar a RPC `complete_sale`, o valor de crédito utilizado é somado ao parâmetro `p_discount_value`.
  A RPC `complete_sale` aplica o valor apenas como um desconto geral na venda e **NÃO realiza nenhuma gravação de débito na tabela `customer_credit_movements`**.
  Consequentemente, no banco de dados Supabase o saldo de crédito do cliente nunca é debitado. Assim que a aplicação recarrega ou executa `refreshDomains('customers')`, o saldo do cliente é restaurado ao valor original, permitindo o reuso infinito de créditos de troca/devolução.
- **Correção Sugerida:**
  Atualizar a RPC `complete_sale` (ou passar o parâmetro `p_credit_used`) para que, quando houver uso de crédito, a própria transação no PostgreSQL insira um registro do tipo `DEBIT` em `customer_credit_movements` debitando o saldo do cliente na loja correspondente de forma atômica.

### 2. BUG-02: Módulo de Fornecedores sem Isolamento Multi-Tenant
- **Severidade:** CRÍTICO
- **Arquivos/Tabelas Afetados:**
  - `src/services/suppliers.service.ts`
  - `src/hooks/domains/useSuppliersDomain.ts`
  - Tabela Supabase: `public.suppliers`
- **Descrição do Problema:**
  A tabela `suppliers` e a função `SuppliersService.getAll()` não possuem nem utilizam a coluna/filtro `store_id`. A consulta `SuppliersService.getAll()` busca todos os registros ativos sem restrição por loja (`supabase.from('suppliers').select('*').eq('is_active', true)`).
  Usuários autenticados de uma loja conseguem visualizar, editar e excluir fornecedores cadastrados por outras lojas da plataforma, violando diretamente o isolamento multi-tenant do CoreSys.
- **Correção Sugerida:**
  1. Criar uma migration adicionando a coluna `store_id uuid REFERENCES public.stores(id)` à tabela `suppliers`.
  2. Atualizar a policy RLS da tabela `suppliers` para filtrar por `store_id = public.get_user_store_id()`.
  3. Atualizar `SuppliersService` e `useSuppliersDomain` para exigirem e passarem o `activeStoreId` em todas as chamadas.

---

## 🟠 PROBLEMAS DE ALTA SEVERIDADE (ALTO)

### 3. SEC-01: Cache Unencrypted de Dados de Múltiplas Lojas no LocalStorage
- **Severidade:** ALTO
- **Arquivos/Tabelas Afetados:**
  - `src/contexts/StoreContext.tsx`
  - Chaves do LocalStorage: `erp_products`, `erp_suppliers`, `erp_fixed_expenses`, `erp_notifications`
- **Descrição do Problema:**
  O `StoreContext` armazena dados da loja ativa em chaves globais do `localStorage` do navegador. Ao alternar de loja (`setActiveStoreId`), as chaves do `localStorage` continuam contendo os dados da loja anterior em texto simples. Em dispositivos compartilhados ou navegação em abas concorrentes, os dados da loja A ficam expostos ou podem ser renderizados temporariamente para a loja B antes que o carregamento da rede seja concluído.
- **Correção Sugerida:**
  Eliminar o uso de `localStorage` para persistência de dados de domínio quando o Supabase estiver configurado (`isSupabaseConfigured === true`), mantendo as informações apenas no estado em memória da aplicação, ou incluir o `activeStoreId` nas chaves de cache (`erp_${activeStoreId}_products`).

### 4. BUG-03: Operação Não-Atômica na Criação de Produtos com Entrada de Estoque Inicial
- **Severidade:** ALTO
- **Arquivos/Tabelas Afetados:**
  - `src/hooks/domains/useProductsDomain.ts`
  - `src/services/products.service.ts`
  - `src/services/inventory.service.ts`
- **Descrição do Problema:**
  A função `addProduct` em `useProductsDomain` cria primeiro o produto no Supabase via `ProductsService.create()` (RPC `manage_product`) e em seguida itera pelos SKUs registrando as entradas de estoque via `InventoryService.registerStockEntry()`. Se ocorrer uma falha durante o registro do estoque (ex: oscilação na rede no 2º SKU), o bloco `catch` remove o produto do estado local do React, mas o registro do produto já foi gravado no banco de dados e permanece como um registro órfão ou com estoque zerado no Supabase.
- **Correção Sugerida:**
  Migrar o fluxo de cadastro com estoque inicial para uma única transação/RPC no banco de dados ou implementar um mecanismo de rollback na chamada do serviço (deletando o produto recém-criado no bloco `catch` caso a entrada de estoque falhe).

---

## 🟡 PROBLEMAS DE MÉDIA SEVERIDADE (MÉDIO)

### 5. SEC-02: Riscos de BOLA em Atualizações Diretas em Despesas Fixas e Clientes
- **Severidade:** MÉDIO
- **Arquivos/Tabelas Afetados:**
  - `src/services/finance.service.ts` (`toggleExpensePaid`)
  - `src/services/customers.service.ts` (`update`, `remove`)
- **Descrição do Problema:**
  Em `FinanceService.toggleExpensePaid(uuid, currentPaidState)`, a alteração é feita usando `.update({ paid: !currentPaidState }).eq('id', uuid)` sem especificar `.eq('store_id', storeId)`. Caso um usuário com acesso a múltiplas lojas passe o UUID de uma despesa de outra loja, a alteração pode afetar o registro incorreto se as políticas RLS permitirem a mutação por papel global.
- **Correção Sugerida:**
  Incluir `.eq('store_id', activeStoreId)` em todas as mutações diretas feitas nos serviços para reforçar a verificação de tenant na camada da aplicação além das políticas RLS.

### 6. PERF-01: Warnings do Linter e Ausência de Dependências em Hooks
- **Severidade:** MÉDIO
- **Arquivos/Tabelas Afetados:**
  - `src/components/dashboard/RevenueChart.tsx`
  - `src/components/dashboard/TopProductsChart.tsx`
  - `src/components/finance/FinanceView.tsx`
  - `src/components/movements/MovementsView.tsx`
  - `src/components/pdv/PdvView.tsx`
- **Descrição do Problema:**
  Foram identificados 26 avisos (warnings) do ESLint no projeto. Dentre eles, diversos `useEffect` apresentam dependências ausentes (`data`, `labels`, `loadTransactions`, `loadMovements`, `handleConfirmSale`). Isso pode provocar re-renders indesejados, execuções duplicadas de queries ou bugs em atualizações de estado.
- **Correção Sugerida:**
  Envolver as funções passadas para `useEffect` em `useCallback` e declarar todas as dependências requeridas conforme indicado pelas regras do React Hooks.

---

## 🔵 PROBLEMAS DE BAIXA SEVERIDADE (BAIXO)

### 7. ARCH-01: Renderização Temporária de Mock Data na Inicialização
- **Severidade:** BAIXO
- **Arquivos/Tabelas Afetados:**
  - `src/contexts/StoreContext.tsx`
  - `src/data/initialData.ts`
- **Descrição do Problema:**
  Mesmo com o Supabase ativo e configurado, os estados iniciais no `StoreContext` usam fallbacks para `INITIAL_PRODUCTS`, `INITIAL_SUPPLIERS` e `INITIAL_FIXED_EXPENSES` quando o `localStorage` está limpo. Isso faz com que dados fictícios da inicialização sejam brevemente exibidos na tela antes de a busca oficial no Supabase retornar.
- **Correção Sugerida:**
  Inicializar os estados com arrays vazios `[]` quando `isSupabaseConfigured === true`.

---

## 📊 RESUMO DE RECOMENDAÇÕES E PRÓXIMAS ETAPAS

1. **Sprint I (P0):** Corrigir a RPC `complete_sale` para registrar débitos de crédito em `customer_credit_movements` e adicionar a coluna `store_id` com RLS na tabela `suppliers`.
2. **Sprint II (P1):** Remover o armazenamento em `localStorage` para modos conectados e adicionar suporte a rollback na criação de produtos com estoque.
3. **Sprint III (P2):** Ajustar dependências do ESLint/React Hooks nos componentes do Dashboard, Financeiro e PDV.
