# Relatório de Auditoria Técnica Diária — CoreSys
**Data:** 02 de Outubro de 2026
**Responsável:** Engenharia de Software Sênior / Auditoria Técnica CoreSys
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Status do Projeto:** Requer correções de Segurança, Isolamento Multi-tenant e Sincronização de Estado

---

## 📌 1. Resumo Executivo

Nesta data, foi realizada uma auditoria técnica completa abrangendo a arquitetura frontend (React, TypeScript, Contexts, Hooks, Services), backend Supabase (PostgreSQL, RLS Policies, Funções RPC `SECURITY DEFINER`, Edge Functions em Deno) e o modelo multi-tenant do **CoreSys**.

### Métricas da Auditoria:
- **Total de Problemas Identificados:** 12
- **Severidade CRÍTICA:** 2
- **Severidade ALTA:** 4
- **Severidade MÉDIA:** 4
- **Severidade BAIXA:** 2

Nenhuma alteração automática de código foi realizada nos módulos do sistema durante esta etapa de auditoria, conforme as diretrizes estabelecidas.

---

## 🚨 2. Problemas Identificados por Severidade

---

### 🔴 SEVERIDADE: CRÍTICO

#### 1. Políticas RLS legadas permissivas (`USING (true)`) mantidas ativas em `financial_transactions`, `customers` e `suppliers`
- **Explicação:** Nas migrações iniciais (`20260101000000_setup.sql` e `20260828000001_hardening_rls.sql`), foram criadas políticas RLS padrão como `"Finance viewable by authenticated"`, `"Customers viewable by authenticated"` e `"Customers updatable by authenticated"` com a expressão `USING (true)`. Migrações posteriores adicionaram políticas restritas por loja usando `has_store_access(store_id)`, porém **não removeram (`DROP POLICY`)** as políticas legadas `USING (true)`. No PostgreSQL, políticas para a mesma operação (`SELECT`/`UPDATE`) em uma tabela são combinadas com operador lógico `OR`. Por conta disso, qualquer usuário autenticado de uma loja A consegue visualizar e alterar transações financeiras e dados de clientes da loja B.
- **Arquivos/Tabelas Afetados:**
  - Tabelas: `public.financial_transactions`, `public.customers`, `public.suppliers`
  - Migrações: `supabase/migrations/20260101000000_setup.sql`, `20260828000001_hardening_rls.sql`, `20260930010321_phase3_finalize_tenant_customers_and_cost_privileges.sql`
- **Sugestão de Correção:** Criar uma migração SQL de hardening para aplicar `DROP POLICY IF EXISTS` em todas as políticas legadas permissivas:
  ```sql
  DROP POLICY IF EXISTS "Finance viewable by authenticated" ON public.financial_transactions;
  DROP POLICY IF EXISTS "Customers viewable by authenticated" ON public.customers;
  DROP POLICY IF EXISTS "Customers updatable by authenticated" ON public.customers;
  DROP POLICY IF EXISTS "Suppliers viewable by authenticated" ON public.suppliers;
  ```
  Garantir que apenas políticas baseadas em `public.has_store_access(store_id)` e `public.get_user_store_role(store_id)` permaneçam ativas.

---

#### 2. Tabela `suppliers` sem coluna `store_id` (Quebra do Isolamento Multi-tenant)
- **Explicação:** A tabela `suppliers` criada no schema do banco não possui a coluna `store_id`, e as consultas em `SuppliersService` (`getAll`, `create`, `update`, `remove`) não filtram nem associam registros a nenhuma loja. Com isso, os fornecedores são compartilhados globalmente entre todos os inquilinos, permitindo que usuários de uma loja visualizem, modifiquem ou inativem fornecedores criados por outra loja.
- **Arquivos/Tabelas Afetados:**
  - Tabela: `public.suppliers`
  - Serviços/Hooks: `src/services/suppliers.service.ts`, `src/hooks/domains/useSuppliersDomain.ts`
  - Migração: `supabase/migrations/20260101000000_setup.sql`
- **Sugestão de Correção:**
  1. Criar migração SQL adicionando `ALTER TABLE public.suppliers ADD COLUMN store_id UUID REFERENCES public.stores(id);`.
  2. Atualizar as políticas RLS de `suppliers` para exigir `public.has_store_access(store_id)`.
  3. Atualizar `SuppliersService` e `useSuppliersDomain` para incluir e filtrar por `store_id`.

---

### 🟠 SEVERIDADE: ALTO

#### 3. Vulnerabilidade de IDOR/BOLA em atualizações diretas de Clientes, Fornecedores e Despesas Fixas
- **Explicação:** As funções `CustomersService.update(uuid)`, `CustomersService.remove(uuid)`, `SuppliersService.update(uuid)`, `SuppliersService.remove(uuid)` e `FinanceService.toggleExpensePaid(uuid)` executam instruções `.update(...).eq('id', uuid)` sem incluir a trava de tenant `.eq('store_id', storeId)`. Caso uma requisição passe o UUID de um registro de outra loja, a operação pode ser executada indevidamente se as políticas RLS permitirem.
- **Arquivos/Tabelas Afetados:**
  - `src/services/customers.service.ts`
  - `src/services/suppliers.service.ts`
  - `src/services/finance.service.ts`
- **Sugestão de Correção:** Exigir `storeId` obrigatoriamente nos parâmetros dessas funções e encadear a condição no cliente Supabase:
  ```ts
  await supabase.from('fixed_expenses')
    .update({ paid: !currentPaidState })
    .eq('id', uuid)
    .eq('store_id', storeId);
  ```

---

#### 4. Parâmetro `storeId` opcional na criação de clientes (`CustomersService.create`)
- **Explicação:** Na assinatura `create(customer, storeId?: string)`, o parâmetro `storeId` é opcional. Se for omitido na chamada, o valor inserido na coluna `store_id` é `undefined` (`NULL`), gerando registros de clientes orfãos que não pertencem a nenhuma loja e que posteriormente não aparecem nas listagens filtradas.
- **Arquivos/Tabelas Afetados:**
  - `src/services/customers.service.ts`
- **Sugestão de Correção:** Tornar o parâmetro `storeId: string` obrigatório em `CustomersService.create(customer, storeId)`.

---

#### 5. Busca de catálogo sem paginação e com filtragem multi-tenant no cliente (`ProductsService.getAll`)
- **Explicação:** A função `ProductsService.getAll(storeId)` consulta a tabela `products` inteira e traz todas as variações e estoques (`product_variants`, `store_inventory`). O filtro por `storeId` é realizado em memória no JavaScript no navegador do usuário (`.filter(product => ... inventory.store_id === storeId)`). Com o crescimento do catálogo, isso causa degradação severa de performance (transferência de dados desnecessários) e expõe os dados de estoque de outras lojas no tráfego de rede da aplicação.
- **Arquivos/Tabelas Afetados:**
  - `src/services/products.service.ts`
- **Sugestão de Correção:** Utilizar paginação no servidor ou uma RPC customizada (`get_products_page`) que filtre o estoque diretamente no banco de dados e retorne apenas os produtos e variações pertencentes à loja ativa.

---

#### 6. Falha na atualização automática da interface ao cadastrar novos clientes (`useCustomersDomain`)
- **Explicação:** No hook `useCustomersDomain.ts`, a função `addCustomer` executa `CustomersService.create(data, activeStoreId)`, mas **não aciona** `refreshDomains('customers')` nem atualiza o estado local `setCustomers`. Como resultado, o novo cliente é gravado no banco, mas a tela do sistema não exibe o cliente recém-cadastrado até que a página seja recarregada ou a loja seja alterada.
- **Arquivos/Tabelas Afetados:**
  - `src/hooks/domains/useCustomersDomain.ts`
  - `src/contexts/StoreContext.tsx`
- **Sugestão de Correção:** Adicionar a chamada de sincronização após a criação com sucesso:
  ```ts
  const addCustomer = useCallback(async (data: Omit<Customer, 'id' | 'historico'>) => {
    if (!activeStoreId) throw new Error('Nenhuma loja ativa selecionada.');
    await CustomersService.create(data, activeStoreId);
    await refreshDomains('customers');
  }, [activeStoreId, refreshDomains]);
  ```

---

### 🟡 SEVERIDADE: MÉDIO

#### 7. Funções RPC `SECURITY DEFINER` com validação de perfil global em vez de perfil específico da loja
- **Explicação:** Algumas funções com privilégios elevados (`SECURITY DEFINER`), como `manage_product` e `register_stock_entry`, utilizam verificações de perfil globais (`public.current_user_role()`) em vez de validar a autorização específica do usuário para a loja informada (`public.get_user_store_role(p_store_id)`). Isso permite que um usuário com papel `MANAGER` na Loja A consiga executar modificações em produtos ou estoque atribuídos à Loja B.
- **Arquivos/Tabelas Afetados:**
  - Funções PostgreSQL: `public.manage_product`, `public.register_stock_entry`
  - Migrações: `supabase/migrations/20260928000002_update_product_service_initial_stock.sql`, `20260929000000_coresys_audit_fixes.sql`
- **Sugestão de Correção:** Atualizar a checagem interna das RPCs para:
  ```sql
  IF public.get_user_store_role(p_store_id, ARRAY['ADMIN', 'MANAGER']) IS NULL THEN
    RAISE EXCEPTION 'Acesso negado para gerenciar estoque/produtos nesta loja' USING ERRCODE = '42501';
  END IF;
  ```

---

#### 8. Tipo de movimentação de venda invertido para `EXPENSE` no fallback local (`useSalesDomain.ts`)
- **Explicação:** Em `useSalesDomain.ts` (linha 120), ao registrar uma venda no modo fallback/offline, o objeto de movimentação criada é instanciado com `tipo: 'EXPENSE'` (`const newMovement: SaleMovement = { id: nextMovId, tipo: 'EXPENSE', valor: totalFinal, ... }`). Por se tratar de uma venda, o tipo correto é receita (`INCOME`). Isso causa distorção nos resumos financeiros e gráficos quando em modo local.
- **Arquivos/Tabelas Afetados:**
  - `src/hooks/domains/useSalesDomain.ts`
- **Sugestão de Correção:** Alterar a propriedade `tipo` de `'EXPENSE'` para `'INCOME'`.

---

#### 9. Rollback incompleto no cadastro composto de Produto + Estoque Inicial (`useProductsDomain`)
- **Explicação:** Ao cadastrar um produto no hook `useProductsDomain`, a RPC `ProductsService.create` é executada e cria o registro na tabela `products`. Em seguida, o sistema itera sobre os SKUs executando `InventoryService.registerStockEntry`. Se ocorrer um erro durante a inserção do estoque de um SKU, o estado local desfaz a adição na tela, mas o registro do produto recém-criado permanece no Supabase em estado parcial ou orfão.
- **Arquivos/Tabelas Afetados:**
  - `src/hooks/domains/useProductsDomain.ts`
  - `src/services/products.service.ts`
- **Sugestão de Correção:** Unificar a criação do produto e dos lançamentos de estoque inicial em uma única transação atômica dentro de uma RPC SQL, evitando passos intermediários e falhas parciais.

---

#### 10. Consulta de movimentações de vendas sem `storeId` em `SalesService.getMovements`
- **Explicação:** Na função `SalesService.getMovements(storeId?, period?)`, a passagem do `storeId` é opcional. Quando não fornecido, a query executa `.from('sales').select(...)` sem a cláusula `.eq('store_id', storeId)`.
- **Arquivos/Tabelas Afetados:**
  - `src/services/sales.service.ts`
- **Sugestão de Correção:** Exigir `storeId: string` como parâmetro obrigatório em `getMovements`.

---

### 🟢 SEVERIDADE: BAIXO

#### 11. Persistência de dados operacionais sem criptografia no `localStorage` durante a troca de loja
- **Explicação:** O `StoreContext.tsx` grava os arrays de `products`, `suppliers`, `fixedExpenses` e `notifications` diretamente no `localStorage` sob as chaves `erp_products`, `erp_suppliers`, etc. Quando um usuário alterna de loja ativa na mesma sessão, essas chaves não são limpas antes de carregar os dados da nova loja, podendo expor dados em cache na troca de perfil ou em navegadores compartilhados.
- **Arquivos/Tabelas Afetados:**
  - `src/contexts/StoreContext.tsx`
- **Sugestão de Correção:** Limpar as chaves de armazenamento local ao alterar o `activeStoreId` ou descontinuar a persistência de dados sensíveis da loja em `localStorage`.

---

#### 12. Avisos de compilação e dependências de Hooks no ESLint
- **Explicação:** A verificação estática do ESLint apontou 27 avisos no projeto, incluindo variáveis/ícones importados e não utilizados (`CreditCard`, `Trash2`, `Filter`, `formatPhone`) e funções em `useEffect`/`useCallback` com dependências ausentes (como `handleConfirmSale` em `PdvView.tsx`).
- **Arquivos Afetados:**
  - `src/components/pdv/PdvView.tsx`
  - `src/components/dashboard/DashboardView.tsx`
  - `src/components/dashboard/RevenueChart.tsx`
  - `src/components/finance/FinanceView.tsx`
  - `src/components/inventory/InventoryView.tsx`
  - `src/components/returns/NewReturnModal.tsx`
- **Sugestão de Correção:** Remover importações sem uso e memorizar handlers com `useCallback` ajustando o array de dependências do `useEffect`.

---

## 📊 3. Resumo da Classificação de Severidade

| ID | Descrição do Achado | Categoria | Severidade |
|---|---|---|---|
| **#1** | Políticas RLS legadas `USING (true)` mantidas ativas | Segurança / Multi-tenant | 🔴 **CRÍTICO** |
| **#2** | Tabela `suppliers` sem isolamento multi-tenant (`store_id`) | Multi-tenant / Banco | 🔴 **CRÍTICO** |
| **#3** | IDOR/BOLA em atualizações de clientes, fornecedores e despesas | Segurança / IDOR | 🟠 **ALTO** |
| **#4** | Parâmetro `storeId` opcional em `CustomersService.create` | Integridade / Multi-tenant | 🟠 **ALTO** |
| **#5** | Consulta de produtos sem paginação e com filtro no client-side | Performance / Segurança | 🟠 **ALTO** |
| **#6** | Interface não atualiza ao cadastrar cliente em `useCustomersDomain` | Bug Funcional / UI | 🟠 **ALTO** |
| **#7** | RPCs `SECURITY DEFINER` sem validação de papel por loja | Segurança / RPC | 🟡 **MÉDIO** |
| **#8** | Tipo de venda definido como `EXPENSE` em fallback local | Regra de Negócio | 🟡 **MÉDIO** |
| **#9** | Rollback incompleto em cadastro de produto e estoque inicial | Transacionalidade | 🟡 **MÉDIO** |
| **#10** | `SalesService.getMovements` aceita `storeId` opcional | Multi-tenant | 🟡 **MÉDIO** |
| **#11** | Cache desnecessário de dados no `localStorage` ao trocar de loja | Privacidade / Cache | 🟢 **BAIXO** |
| **#12** | Warnings de lint (variáveis sem uso e dependências de hooks) | Qualidade de Código | 🟢 **BAIXO** |

---

## 📋 4. Próximos Passos Recomendados

1. **Sprint de Correção de Segurança e Isolamento Multi-tenant (P0):**
   - Elaborar migração SQL incremental para remover as políticas RLS `USING (true)` restantes.
   - Adicionar `store_id` à tabela `suppliers` com restrição de chave estrangeira.
   - Adicionar checagem obrigatória de `store_id` em todos os métodos de escrita de `services`.

2. **Sprint de Correções de Performance e Funcionalidades (P1):**
   - Implementar paginação e filtro por loja no banco para produtos e vendas.
   - Ajustar o hook `useCustomersDomain` para acionar a atualização automática de tela.
   - Corrigir os avisos de lint e otimizar as dependências dos hooks no React.

3. **Validação Contínua:**
   - Rodar a suíte de testes unitários (`npm test`) e verificações estáticas (`npm run typecheck` e `npm run lint`).
