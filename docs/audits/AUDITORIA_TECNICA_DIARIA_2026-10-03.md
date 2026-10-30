# Relatório de Auditoria Técnica Diária do CoreSys

**Data:** 03 de Outubro de 2026
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Auditor:** Engenheiro de Software Sênior (CoreSys Technical Audit)

---

## Executive Summary

Foi realizada uma análise minuciosa da base de código atual do CoreSys (React/TypeScript) e das migrações do Supabase (PostgreSQL/RLS/RPCs). O foco principal da avaliação concentrou-se na **segurança de dados, isolamento multi-tenant, autorização de funções RPC `SECURITY DEFINER`, integridade de transações do PDV/estoque, performance do banco e ciclo de vida do frontend**.

Foram identificados **9 apontamentos relevantes**, classificados por gravidade:
- **1 problema CRÍTICO:** Vulnerabilidade de vazamento cross-tenant / BOLA na vinculação de cliente por CPF em devoluções (`process_return`).
- **1 problema ALTO:** Bypassing de permissão por função em RPCs de lucratividade (`get_profitability_by_product` e `get_profitability_by_category`), permitindo que caixas (`CASHIER`) leiam preços de custo e margens de lucro.
- **4 problemas MÉDIOS:**
  - Tabela `suppliers` sem suporte multi-tenant (`store_id`).
  - Serviço de vendas (`SalesService.getMovements`) aceitando `storeId` opcional.
  - Ineficiência de performance com CTEs duplicadas na paginação de clientes (`get_customer_directory_page`).
  - Inserção direta em `products` utilizando o campo `cost_price` depreciado em vez da RPC auditada `manage_product`.
- **3 problemas BAIXOS:**
  - Métrica de valor do estoque hardcoded como `0` na RPC `report_commercial_summary`.
  - Cache de `localStorage` em `StoreContext.tsx` persistindo dados sem separação por `store_id`.
  - Avisos do ESLint de dependências ausentes em hooks React (`useEffect`/`useCallback`).

---

## Tabela de Problemas Encontrados

| ID | Severidade | Categoria | Descrição Sucinta | Afetados |
|---|---|---|---|---|
| **SEC-01** | **CRÍTICO** | Segurança / Multi-tenant | Busca de cliente por CPF em `process_return` não filtra `store_id`. | RPC `process_return`, Tabela `customers` |
| **SEC-02** | **ALTO** | Autorização / Exposição | Funções de lucratividade não validam papel de loja (`ADMIN`/`MANAGER`), expondo custos a `CASHIER`. | RPCs `get_profitability_by_product` e `get_profitability_by_category` |
| **TEN-01** | **MÉDIO** | Multi-tenant | Tabela `suppliers` e seu serviço não possuem isolamento por `store_id`. | Tabela `suppliers`, `SuppliersService.ts` |
| **TEN-02** | **MÉDIO** | Multi-tenant / Frontend | `SalesService.getMovements` permite chamadas sem `storeId` explícito. | `SalesService.ts` |
| **PERF-01** | **MÉDIO** | Performance | Duplicação de CTEs pesadas de vendas e crédito na RPC `get_customer_directory_page`. | RPC `get_customer_directory_page` |
| **INT-01** | **MÉDIO** | Integridade / Arquitetura | Inserção direta na tabela `products` em `InventoryService.registerStockEntry` contornando RPC auditada. | `InventoryService.ts`, Tabela `products` |
| **BUS-01** | **BAIXO** | Regra de Negócio | Métrica `inventoryValue` retorna `0` fixo no resumo comercial. | RPC `report_commercial_summary` |
| **FE-01** | **BAIXO** | Frontend / Estado | Cache local em `localStorage` não isola chaves por `store_id`. | `StoreContext.tsx` |
| **FE-02** | **BAIXO** | Qualidade de Código | Warnings do ESLint referentes a dependências em `useEffect`/`useCallback`. | `PdvView.tsx`, `FinanceView.tsx`, `MovementsView.tsx`, etc. |

---

## Detalhamento dos Achados e Sugestões de Correção

### 1. [CRÍTICO] SEC-01 — Associação de Cliente em Devolução (`process_return`) sem Filtro de Store ID (BOLA / Multi-Tenant Leak)

- **Explicação:**
  Na RPC `process_return`, quando o cliente não é informado via ID (`v_customer_id IS NULL`), a função realiza uma busca de cliente pelo CPF utilizando a instrução:
  ```sql
  select id into v_customer_id
  from public.customers
  where cpf=trim(p_customer_cpf) and is_active=true
  limit 1;
  ```
  O filtro `and store_id = p_store_id` está ausente nessa consulta. Caso exista um cliente cadastrado com o mesmo CPF na Loja B, o crédito ou vale-troca emitido durante uma devolução na Loja A poderá ser vinculado indevidamente ao cadastro do cliente na Loja B.
- **Arquivos/Tabelas/Funções Afetados:**
  - Função SQL: `public.process_return(uuid,uuid,uuid,text,text,jsonb,text,text)`
  - Tabela: `public.customers`
  - Migração: `supabase/migrations/20260930002500_fase3_harden_returns_and_pdv_integrity.sql`
- **Sugestão de Correção:**
  Incluir explicitamente a condição de tenant na busca do cliente por CPF:
  ```sql
  select id into v_customer_id
  from public.customers
  where cpf = trim(p_customer_cpf)
    and store_id = p_store_id
    and is_active = true
  limit 1;
  ```

---

### 2. [ALTO] SEC-02 — Exposição de Preços de Custo e Margens para Caixas (`CASHIER`) nas RPCs de Lucratividade

- **Explicação:**
  As funções `get_profitability_by_product` e `get_profitability_by_category` são executadas com privilégios `SECURITY DEFINER` e realizam a leitura de `p.cost_price`. No entanto, elas contêm apenas a verificação de autenticação genérica:
  ```sql
  IF public.current_user_role() IS NULL THEN
    RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
  END IF;
  ```
  Como o papel global do usuário em `profiles` ou o papel na loja (`CASHIER`) satisfazem essa verificação (`current_user_role()` não é nulo), um operador de caixa autenticado consegue invocar diretamente essas RPCs para inspecionar os preços de custo de todos os produtos e a margem de lucro operacional da empresa.
- **Arquivos/Tabelas/Funções Afetados:**
  - Funções SQL: `public.get_profitability_by_product(uuid,date,date)` e `public.get_profitability_by_category(uuid,date,date)`
  - Migração: `supabase/migrations/20260929000000_coresys_audit_fixes.sql`
- **Sugestão de Correção:**
  Adicionar a verificação restritiva do papel de acesso à loja no início de ambas as RPCs:
  ```sql
  v_role := public.get_user_store_role(p_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN', 'MANAGER') THEN
    RAISE EXCEPTION 'Permissão negada para relatórios de lucratividade.';
  END IF;
  ```

---

### 3. [MÉDIO] TEN-01 — Ausência de Coluna `store_id` e Isolamento em Fornecedores (`suppliers`)

- **Explicação:**
  A tabela `public.suppliers` e o serviço `SuppliersService` não possuem suporte ao modelo multi-loja. A tabela não possui a coluna `store_id` e as políticas RLS concedem permissão de leitura/escrita a qualquer perfil `ADMIN` ou `MANAGER` do banco. Isso faz com que fornecedores cadastrados por uma loja fiquem expostos e editáveis por operadores de qualquer outra loja.
- **Arquivos/Tabelas/Funções Afetados:**
  - Tabela: `public.suppliers`
  - Serviço Frontend: `src/services/suppliers.service.ts` e `src/hooks/domains/useSuppliersDomain.ts`
  - Migração: `supabase/migrations/20260101000000_setup.sql`
- **Sugestão de Correção:**
  1. Adicionar a coluna `store_id uuid references public.stores(id)` na tabela `suppliers`.
  2. Atualizar as políticas RLS de `suppliers` para utilizar `has_store_access(store_id)` no `SELECT` e `get_user_store_role(store_id) IN ('ADMIN', 'MANAGER')` nas mutações.
  3. Atualizar o `SuppliersService` e o `useSuppliersDomain` para repassar e filtrar pelo `activeStoreId`.

---

### 4. [MÉDIO] TEN-02 — Consulta de Vendas com `storeId` Opcional em `SalesService.getMovements`

- **Explicação:**
  No arquivo `src/services/sales.service.ts`, a assinatura do método `getMovements(storeId?: string, period?: ...)` trata o `storeId` como parâmetro opcional. Quando não fornecido, a consulta executa `supabase.from('sales').select(...).eq('status', 'COMPLETED')` sem o filtro `.eq('store_id', storeId)`. Se o usuário autenticado possuir acesso a mais de uma loja, as vendas de múltiplos estabelecimentos serão consolidadas na mesma tela do frontend.
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivo Frontend: `src/services/sales.service.ts`
- **Sugestão de Correção:**
  Tornar o parâmetro `storeId: string` obrigatório na assinatura de `SalesService.getMovements` e garantir que o componente requisitante sempre forneça o ID da loja ativa.

---

### 5. [MÉDIO] PERF-01 — Execução Tripla de CTEs na RPC `get_customer_directory_page`

- **Explicação:**
  Na RPC `get_customer_directory_page`, a lógica de agrupamento de vendas (`sales_agg`), movimentações de crédito (`credit_agg`), junção base (`base`) e filtragem (`filtered`) está duplicada integralmente três vezes dentro da mesma função em SQL para computar:
  1. O total de registros (`SELECT count(*) INTO v_total FROM filtered;`);
  2. A página de linhas (`SELECT jsonb_agg(...) INTO v_rows FROM page_rows;`);
  3. Os indicadores consolidados (`SELECT jsonb_build_object(...) INTO v_stats FROM base;`).
  Em bases com grande volume de vendas, esse comportamento causa um overhead de 3x em varredura e agregação a cada requisição de página.
- **Arquivos/Tabelas/Funções Afetados:**
  - Função SQL: `public.get_customer_directory_page(uuid,text,text,text,integer,integer)`
  - Migração: `supabase/migrations/20261002234838_server_pagination_phase25c.sql`
- **Sugestão de Correção:**
  Refatorar a função SQL para consolidar os resultados em uma única passagem utilizando agregação unificada ou tabelas temporárias em memória.

---

### 6. [MÉDIO] INT-01 — Inserção Direta na Tabela `products` em `InventoryService.registerStockEntry`

- **Explicação:**
  No serviço `InventoryService.registerStockEntry`, caso um produto informado não seja localizado, o serviço executa uma inserção direta na tabela `products` informando o campo `cost_price`:
  ```ts
  const { data: newProd, error: prodErr } = await supabase
    .from('products')
    .insert({ name: ..., sale_price: ..., cost_price: custoUnitario, ... })
  ```
  Isso ignora a RPC centralizada `manage_product` e contraria as convenções de segurança estabelecidas na migração que restringiu o acesso à coluna `cost_price` e migrou os custos para a estrutura auditada `product_costs`.
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivo Frontend: `src/services/inventory.service.ts`
  - Tabela: `public.products`
- **Sugestão de Correção:**
  Refatorar o fluxo para invocar a RPC `manage_product`, garantindo que a criação de produto e variação ocorra dentro do contorno transacional auditado do banco.

---

### 7. [BAIXO] BUS-01 — Métrica `inventoryValue` com Valor Fixo 0 na RPC `report_commercial_summary`

- **Explicação:**
  A RPC `report_commercial_summary` constrói o objeto `overview` contendo o campo `'inventoryValue', 0`. O valor total acumulado do estoque da loja não está sendo calculado pela função, apresentando sempre valor zerado na visão analítica do dashboard comercial.
- **Arquivos/Tabelas/Funções Afetados:**
  - Função SQL: `public.report_commercial_summary(uuid,date,date)`
  - Migração: `supabase/migrations/20261002211820_report_commercial_summary.sql`
- **Sugestão de Correção:**
  Calcular o valor total do estoque multiplicando as quantidades da loja em `store_inventory` pelo preço de venda do produto (`products.sale_price`) ou preço de custo correspondente.

---

### 8. [BAIXO] FE-01 — Persistência em `localStorage` sem Diferenciação por `store_id`

- **Explicação:**
  Em `src/contexts/StoreContext.tsx`, os estados de produtos, fornecedores e despesas são gravados em chaves estáticas do `localStorage` (`erp_products`, `erp_suppliers`, etc.). Ao trocar a loja ativa na interface ou efetuar logout, os dados salvos em cache local podem persistir ou ser exibidos temporariamente antes da re-sincronização com o Supabase.
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivo Frontend: `src/contexts/StoreContext.tsx`
- **Sugestão de Correção:**
  Prefixar as chaves de armazenamento local com o ID da loja ativa (ex: `erp_products_${activeStoreId}`) ou desabilitar o fallback de cache local quando a conexão remota com o Supabase estiver ativa.

---

### 9. [BAIXO] FE-02 — Alertas do ESLint em React Hooks e Variáveis Não Utilizadas

- **Explicação:**
  A execução de `npm run lint` registra 26 avisos (0 erros), dentre os quais destacam-se:
  - `PdvView.tsx`: `handleConfirmSale` recria-se a cada render por falta de `useCallback`, provocando potenciais execuções desnecessárias no `useEffect` da linha 372.
  - `FinanceView.tsx` e `MovementsView.tsx`: `useEffect` com dependências ausentes das funções de carregamento.
  - `RevenueChart.tsx` e `TopProductsChart.tsx`: dependências ausentes de dados nos hooks de renderização de gráficos.
- **Arquivos/Tabelas/Funções Afetados:**
  - `src/components/pdv/PdvView.tsx`
  - `src/components/finance/FinanceView.tsx`
  - `src/components/movements/MovementsView.tsx`
  - `src/components/dashboard/RevenueChart.tsx`
  - `src/components/dashboard/TopProductsChart.tsx`
- **Sugestão de Correção:**
  Ajustar a declaração das funções com `useCallback` e declarar todas as dependências nos arrays de `useEffect`.

---

## Conclusão e Próximos Passos

A arquitetura geral do CoreSys apresenta um alto nível de maturidade em transações de PDV, controle de idempotência e isolamento RLS. No entanto, o achado **SEC-01 (CRÍTICO)** em devoluções e **SEC-02 (ALTO)** em relatórios de lucratividade exigem remediação prioritária em uma migração futura dedicada para garantir total estanqueidade entre lojas e controle de acesso a dados sensíveis de custo.

Recomenda-se o planejamento de uma migração de remediação contemplando os pontos **SEC-01**, **SEC-02** e **TEN-01**.
