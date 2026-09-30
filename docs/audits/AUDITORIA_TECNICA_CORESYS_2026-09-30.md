# Relatório de Auditoria Técnica Diária — CoreSys (ERP/PDV Multi-Tenant)
**Data:** 30/09/2026
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Projeto Supabase:** `ndrjynlbwrugakjqtzwy`
**Auditor:** Engenharia de Software Sênior (Jules)

---

## 1. Visão Geral e Resumo Executivo

Nesta auditoria técnica diária do sistema **CoreSys**, foi realizada uma análise aprofundada da arquitetura multi-tenant, segurança RLS (Row Level Security) e Supabase Auth, integridade de dados e transações, funções `SECURITY DEFINER`, conectividade e performance no banco PostgreSQL, além do fluxo de estado e serviços no frontend React/TypeScript.

Em conformidade com a orientação estratégica, **nenhuma alteração automática de código de aplicação ou migration no banco foi aplicada nesta etapa de auditoria**. Todos os achados foram documentados com classificação de risco, causa raiz, componentes afetados e plano detalhado para remediação.

### Resumo dos Achados
- **Críticos (2)**: Brechas graves de isolamento multi-tenant via RLS nas tabelas `customers` e `fixed_expenses`, permitindo vazamento/modificação de dados cross-tenant.
- **Altos (3)**: Tabela `customer_credit_movements` sem RLS ativado; erro de permissão no frontend ao registrar estoque via client devido ao `REVOKE SELECT` de `cost_price`; e potencial vulnerabilidade BOLA/IDOR nas operações diretas de clientes/fornecedores.
- **Médios (2)**: Filtro aninhado insuficiente de `sales` em `CustomersService.getAll` e falta de índices compostos em movimentações de crédito de clientes.
- **Baixos (1)**: Duplicação de estado financeiro entre `StoreContext` e `FinanceView`.

---

## 2. Detalhamento dos Achados por Severidade

### 🔴 SEVERIDADE: CRÍTICO

#### 1. Isolamento Multi-Tenant Incompleto na Tabela `public.customers` (RLS Permissiva)
- **Classificação:** CRÍTICO
- **Categoria:** Segurança / Isolamento Multi-Tenant
- **Arquivos/Tabelas/Funções Afetados:**
  - Tabela: `public.customers`
  - Migrations: `supabase/migrations/20260101000000_setup.sql`, `supabase/migrations/20260828000001_hardening_rls.sql`
  - Serviços Frontend: `src/services/customers.service.ts`
- **Explicação do Problema:**
  Embora a coluna `store_id` tenha sido adicionada à tabela `customers` para isolar os clientes de cada loja, as políticas de RLS ativas em `public.customers` permanecem com expressões genéricas:
  - `Customers viewable by authenticated`: `FOR SELECT TO authenticated USING (true)`
  - `Customers updatable by authenticated`: `FOR UPDATE TO authenticated USING (true)`
  Consequentemente, qualquer usuário autenticado no sistema com acesso apenas à **Loja A** pode consultar e alterar dados pessoais (nome, CPF, telefone, endereço, saldo de crédito) de clientes cadastrados na **Loja B** diretamente via PostgREST/Supabase client.
- **Sugestão de Correção:**
  Criar nova migration para atualizar a RLS da tabela `customers`:
  ```sql
  DROP POLICY IF EXISTS "Customers viewable by authenticated" ON public.customers;
  DROP POLICY IF EXISTS "Customers updatable by authenticated" ON public.customers;

  CREATE POLICY "Customers viewable by store access"
    ON public.customers FOR SELECT TO authenticated
    USING (public.has_store_access(store_id));

  CREATE POLICY "Customers updatable by store roles"
    ON public.customers FOR UPDATE TO authenticated
    USING (public.has_store_access(store_id) AND public.get_user_store_role(store_id) IN ('ADMIN', 'MANAGER', 'CASHIER'))
    WITH CHECK (public.has_store_access(store_id) AND public.get_user_store_role(store_id) IN ('ADMIN', 'MANAGER', 'CASHIER'));
  ```

---

#### 2. Ausência de Validação de Tenant nas Políticas RLS da Tabela `public.fixed_expenses`
- **Classificação:** CRÍTICO
- **Categoria:** Segurança / Isolamento Multi-Tenant
- **Arquivos/Tabelas/Funções Afetados:**
  - Tabela: `public.fixed_expenses`
  - Migrations: `supabase/migrations/20260828000003_multi_store.sql`, `supabase/migrations/20260828000001_hardening_rls.sql`
  - Serviços Frontend: `src/services/finance.service.ts`
- **Explicação do Problema:**
  A migration `20260828000003_multi_store.sql` associou `store_id` obrigatoriamente à tabela `fixed_expenses`. Contudo, as políticas de RLS criadas para a tabela exigem apenas que o papel global ou da função seja `ADMIN` ou `MANAGER` (`public.current_user_role() IN ('ADMIN', 'MANAGER')`), **sem verificar se o usuário pertence à loja dona da despesa** (`has_store_access(store_id)`). Com isso, um Gerente da Loja A consegue listar, alterar o status de pagamento e excluir contas a pagar da Loja B.
- **Sugestão de Correção:**
  Reescrever as políticas RLS de `fixed_expenses` vinculando explicitamente o `store_id`:
  ```sql
  DROP POLICY IF EXISTS "Fixed expenses viewable by authenticated" ON public.fixed_expenses;
  DROP POLICY IF EXISTS "Fixed expenses manageable by Admin and Manager" ON public.fixed_expenses;

  CREATE POLICY "Fixed expenses viewable by store access"
    ON public.fixed_expenses FOR SELECT TO authenticated
    USING (public.has_store_access(store_id));

  CREATE POLICY "Fixed expenses manageable by store managers"
    ON public.fixed_expenses FOR ALL TO authenticated
    USING (public.has_store_access(store_id) AND public.get_user_store_role(store_id) IN ('ADMIN', 'MANAGER'))
    WITH CHECK (public.has_store_access(store_id) AND public.get_user_store_role(store_id) IN ('ADMIN', 'MANAGER'));
  ```

---

### 🟠 SEVERIDADE: ALTO

#### 3. Tabela `public.customer_credit_movements` Sem Habilitação de RLS
- **Classificação:** ALTO
- **Categoria:** Segurança / Supabase RLS
- **Arquivos/Tabelas/Funções Afetados:**
  - Tabela: `public.customer_credit_movements`
  - Migrations: `supabase/migrations/20260928000001_hardening_auth_integrity.sql`, `supabase/migrations/20260930002500_fase3_harden_returns_and_pdv_integrity.sql`
- **Explicação do Problema:**
  A tabela `customer_credit_movements` (responsável pelo ledger de créditos e vale-trocas emitidos em devoluções) foi criada nas migrations sem a instrução `ALTER TABLE public.customer_credit_movements ENABLE ROW LEVEL SECURITY;`. Como consequência, requisições diretas efetuadas pela API REST por qualquer usuário autenticado ignoram qualquer restrição e podem consultar movimentações financeiras de crédito de outras lojas.
- **Sugestão de Correção:**
  Habilitar RLS na tabela e aplicar a política restritiva de acesso à loja:
  ```sql
  ALTER TABLE public.customer_credit_movements ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "Customer credit movements viewable by store access"
    ON public.customer_credit_movements FOR SELECT TO authenticated
    USING (public.has_store_access(store_id));
  ```

---

#### 4. Erro de Permissão no Client ao Inserir/Atualizar Produtos na Entrada de Estoque (`cost_price` Revogado)
- **Classificação:** ALTO
- **Categoria:** Bugs Funcionais / Erros de Permissão
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivo Frontend: `src/services/inventory.service.ts` (método `registerStockEntry`)
  - Migration: `supabase/migrations/20260930024000_restrict_product_cost_column_reads.sql`
- **Explicação do Problema:**
  A migration `20260930024000_restrict_product_cost_column_reads.sql` restringiu as colunas de leitura de `products` para omitir `cost_price` do cliente frontend (`REVOKE SELECT ON public.products ... GRANT SELECT (id, name, sale_price, ...) ON public.products TO anon, authenticated`).
  Porém, no fallback client-side de `InventoryService.registerStockEntry`, quando um produto novo é criado diretamente via client, o código executa:
  ```ts
  const { data: newProd, error: prodErr } = await supabase
    .from('products')
    .insert({ name: params.productName.trim(), ..., cost_price: custoUnitario })
    .select()
    .single();
  ```
  A chamada `.select()` sem especificar colunas tenta realizar `SELECT *`, solicitando inclusive a coluna `cost_price` cujo SELECT foi revogado para o papel `authenticated`. O Postgres rejeita a operação com erro HTTP `42501 permission denied for table products`.
- **Sugestão de Correção:**
  Refatorar `InventoryService.registerStockEntry` para canalizar toda criação/gerenciamento de produtos exclusivamente via RPC `manage_product` ou ajustar a cláusula `.select('id, name, sale_price')` para solicitar apenas colunas autorizadas.

---

#### 5. Risco de IDOR/BOLA em Atualizações e Exclusões de Clientes e Fornecedores
- **Classificação:** ALTO
- **Categoria:** IDOR / BOLA / Validação Insuficiente
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivos Frontend: `src/services/customers.service.ts`, `src/services/suppliers.service.ts`
- **Explicação do Problema:**
  Nas rotas de atualização (`update`) e remoção (`remove` / `delete`) do `CustomersService` e `SuppliersService`, as queries executam mutações diretas filtrando apenas por `.eq('id', uuid)` sem incluir obrigatoriamente o contexto `.eq('store_id', activeStoreId)`.
  Caso a política RLS do banco apresente qualquer brecha ou falha de contexto, um usuário com UUID de cliente de outra loja conseguiria desativar ou alterar dados arbitrariamente.
- **Sugestão de Correção:**
  Incluir a verificação defensiva de `store_id` em todas as mutações no frontend:
  ```ts
  const { error } = await supabase
    .from('customers')
    .update(payload)
    .eq('id', uuid)
    .eq('store_id', storeId);
  ```

---

### 🟡 SEVERIDADE: MÉDIO

#### 6. Vendas Aninhadas em `CustomersService.getAll` Não Filtram por `store_id`
- **Classificação:** MÉDIO
- **Categoria:** Inconsistência de Dados Multi-Tenant / Performance
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivo Frontend: `src/services/customers.service.ts` (método `getAll`)
- **Explicação do Problema:**
  Ao buscar os clientes da loja ativa, `CustomersService.getAll` executa uma sub-query para carregar o histórico de compras:
  ```ts
  .select(`
    id, name, cpf, ...,
    sales ( id, sale_number, store_id, total, created_at, sale_items ( product_name, quantity ) )
  `)
  ```
  No PostgREST, consultas aninhadas em relacionamentos filho (`sales`) não herdam automaticamente o filtro `.eq('store_id', storeId)` aplicado na tabela pai (`customers`). Se um mesmo cliente possuir histórico de compras registrado em mais de uma loja da rede, o histórico de compras exibido no perfil do cliente na Loja A listará indevidamente vendas realizadas na Loja B.
- **Sugestão de Correção:**
  Filtrar programmaticamente o array `c.sales` no frontend (`sales.filter(s => s.store_id === storeId)`) ou criar RPC/View otimizada para carregar o perfil de histórico do cliente restrito à loja ativa.

---

#### 7. Ausência de Índice Composto em `customer_credit_movements(store_id, customer_id)`
- **Classificação:** MÉDIO
- **Categoria:** Performance do Banco de Dados
- **Arquivos/Tabelas/Funções Afetados:**
  - Tabela: `public.customer_credit_movements`
  - Migration: `supabase/migrations/20260927184000_hardening_supabase_final.sql`
- **Explicação do Problema:**
  Na migration `20260927184000_hardening_supabase_final.sql`, foi criado apenas o índice simples `idx_customer_credit_movements_customer_id ON customer_credit_movements(customer_id)`. Como todas as listagens de clientes do PDV e extratos financeiros agregam créditos por `store_id` e `customer_id`, a ausência de um índice composto causará scans desnecessários conforme o histórico de devoluções cresça.
- **Sugestão de Correção:**
  Adicionar índice composto na próxima migration:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_customer_credit_movements_store_customer
    ON public.customer_credit_movements(store_id, customer_id);
  ```

---

### 🟢 SEVERIDADE: BAIXO

#### 8. Duplicação Parcial de Estado Financeiro entre `StoreContext` e `FinanceView`
- **Classificação:** BAIXO
- **Categoria:** Arquitetura / Estado do Frontend
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivos: `src/contexts/StoreContext.tsx`, `src/components/finance/FinanceView.tsx`
- **Explicação do Problema:**
  O componente `FinanceView` foi refatorado para consultar diretamente o `FinanceService` (`getTransactionRecords` e `getExpenseRecords`), obtendo registros com os tipos enriquecidos da loja ativa. Entretanto, o `StoreContext` mantém variáveis de estado legado (`transactions` e `fixedExpenses`) que são atualizadas no `refreshData()`, criando duas fontes da verdade dentro da mesma sessão e podendo gerar desalinhamento na barra de notificações e alertas de vencimento.
- **Sugestão de Correção:**
  Padronizar a atualização do `StoreContext` para que invoque `refreshData()` após operações financeiras no `FinanceView` ou consolidar o consumo de dados do financeiro via `FinanceService`.

---

## 3. Matriz de Severidade e Priorização de Ações

| ID | Descrição do Achado | Severidade | Módulo / Componente | Ação Recomendada |
|---|---|---|---|---|
| **#1** | RLS permissiva em `customers` (`USING true`) | 🔴 CRÍTICO | Banco / Supabase RLS | Aplicar `has_store_access(store_id)` nas políticas de SELECT e UPDATE |
| **#2** | RLS sem checagem de `store_id` em `fixed_expenses` | 🔴 CRÍTICO | Banco / Supabase RLS | Exigir `has_store_access(store_id)` e papel na loja em `fixed_expenses` |
| **#3** | RLS desativada em `customer_credit_movements` | 🟠 ALTO | Banco / Supabase RLS | Habilitar RLS (`ENABLE ROW LEVEL SECURITY`) e política de tenant |
| **#4** | Erro de permissão HTTP 42501 em `registerStockEntry` | 🟠 ALTO | Frontend / Services | Remover `.select()` irrestrito na inserção e utilizar RPC `manage_product` |
| **#5** | Risco de IDOR/BOLA em atualizações/remoções | 🟠 ALTO | Frontend / Services | Adicionar filtro implícito `.eq('store_id', activeStoreId)` nas mutações |
| **#6** | Vendas de outras lojas em `CustomersService.getAll` | 🟡 MÉDIO | Frontend / PostgREST | Filtrar `sales` pelo `store_id` ativo da sessão |
| **#7** | Faltam índices compostos em movimentações de crédito | 🟡 MÉDIO | Banco / Performance | Criar índice `idx_customer_credit_movements_store_customer` |
| **#8** | Duplicação de estado financeiro `StoreContext` x `FinanceView` | 🟢 BAIXO | Frontend / Arquitetura | Sincronizar `refreshData()` em ações financeiras |

---

## 4. Conclusão e Próximos Passos

A arquitetura do **CoreSys** possui uma base sólida com isolamento transacional para vendas, PDV e devoluções via RPCs otimizadas. Contudo, **as fragilidades de RLS identificadas em `customers`, `fixed_expenses` e `customer_credit_movements` precisam ser sanadas em caráter prioritário** para assegurar conformidade com os requisitos rígidos de multi-tenancy.

### Plano de Ação Recomendado para Próxima Sprint:
1. Criar migration SQL `20261001000000_fix_multitenant_rls_and_credit_ledger.sql` para corrigir as políticas RLS das tabelas `customers`, `fixed_expenses` e habilitar RLS em `customer_credit_movements`.
2. Refatorar `InventoryService.registerStockEntry` e `CustomersService.getAll` no frontend para resolver o erro de permissão e o filtro de histórico de vendas cross-tenant.
3. Executar a suíte de testes (`npm run typecheck && npm test`) e registrar o Pull Request formal no GitHub.

---
*Relatório de auditoria registrado e assinado em `docs/audits/AUDITORIA_TECNICA_CORESYS_2026-09-30.md`.*
