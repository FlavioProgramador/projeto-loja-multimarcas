# Relatório de Auditoria Técnica Diária — CoreSys (Vestra ERP/PDV)

**Data:** 02 de Outubro de 2026
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Responsável:** Engenheiro de Software Sênior — Auditoria Técnica e Segurança

---

## 1. Resumo Executivo

O **CoreSys** passou por evoluções arquiteturais significativas em suas últimas migrações, estabelecendo controle estrito de isolamento multi-tenant (`store_id`), hardening de RLS (Row Level Security), fixação do `search_path = public` nas funções `SECURITY DEFINER` e implementação de paginação server-side com RPCs dedicadas (`get_customer_directory_page`, `get_finance_page`, `get_returns_page`, `report_commercial_summary`).

A presente auditoria diária inspecionou integralmente a camada de banco de dados (schema, migrações, funções PL/pgSQL e triggers), as Edge Functions Deno (`create-mp-pix`, `mp-webhook`, `mp-pix-reconciliation-worker`), os serviços TypeScript (`src/services/*`), os contextos da aplicação (`AuthContext`, `StoreContext`) e os componentes da interface.

### Resumo dos Achados por Severidade

| Severidade | Quantidade | Principais Domínios Afetados |
| :--- | :---: | :--- |
| 🔴 **CRÍTICO** | **2** | Edge Function `create-mp-pix` (Validação de descontos) e `DashboardService` (Isolamento Multi-tenant) |
| 🟠 **ALTO** | **3** | `DashboardService` (Performance/Queries ilimitadas e Checagem de estoque legado) e `InventoryService` (Geração de SKU client-side) |
| 🟡 **MÉDIO** | **3** | Cache em `localStorage`, Performance da RPC `get_customer_directory_page` e Avisos de React Hooks/ESLint |
| 🟢 **BAIXO** | **2** | Dependências não utilizadas no `package.json` e Duplicação de código em Fallbacks Legados |

---

## 2. Achados Detalhados

### 🔴 SEVERIDADE: CRÍTICO

#### [CRÍTICO-01] Variação ilimitada de descontos na Edge Function `create-mp-pix` sem validação de limite no backend
* **Descrição:** A Edge Function `supabase/functions/create-mp-pix/index.ts` aceita `discountValue` e `discountPercent` diretamente do corpo da requisição JSON enviado pelo cliente e os repassa diretamente para a RPC `create_mp_pix_sale`. Não há validação na Edge Function nem na RPC que limite o percentual máximo de desconto com base no perfil/role do operador de caixa (ex.: impedir que um funcionário com papel `CASHIER` conceda 100% de desconto sem autorização de um `MANAGER` ou `ADMIN`). Um operador mal-intencionado ou requisição adulterada via API pode gerar cobranças zeradas no Mercado Pago sem controle da loja.
* **Afetados:**
  * Arquivo: `supabase/functions/create-mp-pix/index.ts`
  * Função/RPC: `create_mp_pix_sale` / `create-mp-pix`
* **Sugestão de Correção:**
  1. Adicionar validação server-side na RPC `create_mp_pix_sale` e em `complete_sale` que verifique se o valor do desconto excede o limite permitido para a loja e o papel do usuário logado (consultado via `get_user_store_role(p_store_id)`).
  2. Na Edge Function, validar explicitamente se `discountPercent` está no intervalo `[0, 100]` e se `discountValue` não excede o total dos itens.

---

#### [CRÍTICO-02] Ausência de filtro `store_id` nas consultas diretas em `DashboardService.getMetrics()`
* **Descrição:** O método `DashboardService.getMetrics()` em `src/services/dashboard.service.ts` realiza consultas diretamente na tabela `sales` utilizando `.from('sales').select(...).eq('status', 'COMPLETED')` sem aplicar `.eq('store_id', activeStoreId)`. Em cenários onde o usuário autenticado possui acesso a múltiplas lojas (ex.: administradores ou gerentes multi-lojas), as métricas de vendas mensais, vendas do dia e ticket médio agregam dados de **todas as lojas do sistema**, violando o isolamento de visão do tenant ativo selecionado na interface.
* **Afetados:**
  * Arquivo: `src/services/dashboard.service.ts`
  * Tabela: `public.sales`
* **Sugestão de Correção:**
  1. Alterar a assinatura de `DashboardService.getMetrics(storeId: string)`.
  2. Incluir o filtro obrigatório `.eq('store_id', storeId)` na consulta da tabela `sales`.
  3. Atualizar a chamada no componente `DashboardView` para passar o `activeStoreId` obtido do `StoreContext`.

---

### 🟠 SEVERIDADE: ALTO

#### [ALTO-01] Consulta de estoque baixo em `DashboardService` utiliza modelo de tabela legada e sem escopo por loja
* **Descrição:** Em `src/services/dashboard.service.ts`, o cálculo de itens em baixo estoque busca dados diretamente em `product_variants` através de `.from('product_variants').select('id, stock_quantity').lte('stock_quantity', 2)`. Com a arquitetura multi-tenant, o estoque é controlado individualmente por loja na tabela `store_inventory`. A coluna `stock_quantity` na tabela `product_variants` não reflete o estoque real da loja ativa e não está filtrada por `store_id`.
* **Afetados:**
  * Arquivo: `src/services/dashboard.service.ts`
  * Tabelas: `product_variants`, `store_inventory`
* **Sugestão de Correção:**
  1. Substituir a consulta direta em `product_variants` por uma consulta na tabela `store_inventory` filtrada por `.eq('store_id', storeId)`.
  2. Alternativamente, utilizar a RPC `report_stock_status(p_store_id)` do `ReportsService` para obter os dados consolidados e atualizados de estoque por loja.

---

#### [ALTO-02] Risco de colisão de SKU em gravações concorrentes no cliente em `InventoryService.registerStockEntry()`
* **Descrição:** No método `registerStockEntry` em `src/services/inventory.service.ts`, quando uma nova variante precisa ser criada no banco durante a entrada de estoque, o SKU é gerado client-side utilizando a expressão:
  ```ts
  const generatedSku = `${params.productName.substring(0, 3).toUpperCase()}-${newSize.toUpperCase()}-${newColor.substring(0, 3).toUpperCase()}-${Date.now().toString().slice(-4)}`;
  ```
  O uso dos últimos 4 dígitos do timestamp (`Date.now().toString().slice(-4)`) gera um espaço amostral de apenas 10.000 combinações possíveis (0000-9999). Em lojas com múltiplos caixas ou operadores realizando entradas de estoque simultâneas, há um risco real de colisão da constraint `UNIQUE` em `product_variants.sku`, resultando em erros de transação.
* **Afetados:**
  * Arquivo: `src/services/inventory.service.ts`
  * Tabela: `product_variants` (campo `sku`)
* **Sugestão de Correção:**
  1. Delegar a geração do SKU para a RPC do banco de dados (ex.: `manage_product` ou `register_stock_entry`) que utiliza sequências atômicas ou UUIDs/hashes mais robustos.
  2. Caso gerado na aplicação, utilizar uma função de geração com entropia adequada como `crypto.randomUUID().slice(0, 8)`.

---

#### [ALTO-03] Ausência de paginação server-side na busca de vendas do Dashboard
* **Descrição:** O método `DashboardService.getMetrics()` busca **todas** as vendas concluídas da tabela `sales` sem utilizar `.limit()` ou `.range()`. Toda a agregação (vendas do mês, vendas de hoje, ticket médio) é calculada em memória no JavaScript. Em lojas de alto volume com dezenas de milhares de vendas, essa consulta consumirá largura de banda excessiva, aumentará o tempo de carregamento inicial da página e causará estouro de memória no navegador.
* **Afetados:**
  * Arquivo: `src/services/dashboard.service.ts`
  * Tabela: `public.sales`
* **Sugestão de Correção:**
  1. Utilizar a RPC otimizada `report_commercial_summary` (já criada no banco) para trazer métricas pré-agregadas via SQL sem carregar dados brutos.
  2. Para a lista de "Vendas Recentes", aplicar um limite explícito na consulta: `.order('created_at', { ascending: false }).limit(5)`.

---

### 🟡 SEVERIDADE: MÉDIO

#### [MÉDIO-01] Persistência não criptografada de caches de estado em `localStorage`
* **Descrição:** `src/contexts/StoreContext.tsx` armazena no `localStorage` do navegador os estados de produtos, fornecedores, despesas fixas e notificações sob as chaves `erp_products`, `erp_suppliers`, `erp_fixed_expenses`, `erp_notifications`. Embora o `AuthContext` execute a limpeza das chaves sensíveis ao acionar o `signOut()`, caso a sessão expire, ocorra um travamento do navegador ou o usuário feche a aba sem realizar logout explícito, dados operacionais e financeiros da loja permanecem salvos em texto claro no armazenamento local da máquina.
* **Afetados:**
  * Arquivos: `src/contexts/StoreContext.tsx`, `src/contexts/AuthContext.tsx`
* **Sugestão de Correção:**
  1. Evitar o armazenamento de dados operacionais sensíveis no `localStorage` quando o modo Supabase está ativo, mantendo o estado exclusivamente em memória (React Context).
  2. Limitar o uso do `localStorage` apenas para o modo local/demo (quando `isSupabaseConfigured` for `false`).

---

#### [MÉDIO-02] Repetição de CTEs com agregações pesadas na RPC `get_customer_directory_page`
* **Descrição:** Na migração `20261002234838_server_pagination_phase25c.sql`, a função PL/pgSQL `get_customer_directory_page` define três vezes os mesmos blocos de CTE (`WITH sales_agg AS (...), credit_agg AS (...)`) para calcular:
  1. A contagem total filtrada (`v_total`);
  2. Os registros paginados da página ativa (`v_rows`);
  3. O resumo estatístico geral (`v_stats`).
  Embora o otimizador do PostgreSQL seja eficiente, re-executar subconsultas de agrupamento sobre `sales` e `customer_credit_movements` três vezes na mesma invocação da RPC causa overhead desnecessário de CPU e I/O no banco de dados em lojas com grandes volumes de clientes e vendas.
* **Afetados:**
  * Arquivo: `supabase/migrations/20261002234838_server_pagination_phase25c.sql`
  * Função: `public.get_customer_directory_page`
* **Sugestão de Correção:**
  1. Refatorar a função PL/pgSQL para calcular as CTEs `sales_agg` e `credit_agg` uma única vez no início da função ou criar uma visão de suporte/função auxiliar.

---

#### [MÉDIO-03] Avisos de linter e dependências ausentes em React Hooks (`react-hooks/exhaustive-deps`)
* **Descrição:** O comando `npm run lint` reporta 27 avisos no total. Dentre eles, destacam-se avisos da regra `react-hooks/exhaustive-deps` em componentes visuais principais:
  * `src/components/dashboard/RevenueChart.tsx`: `useEffect` com dependências ausentes (`data` e `labels`).
  * `src/components/dashboard/TopProductsChart.tsx`: `useEffect` com dependências ausentes (`data` e `labels`).
  * `src/components/finance/FinanceView.tsx`: `useEffect` com dependências ausentes (`loadTransactions`, `loadExpenses`).
  * `src/components/pdv/PdvView.tsx`: `handleConfirmSale` recriado a cada renderização afetando o `useEffect` da linha 372.
  Esses avisos podem resultar em bugs sutis de renderização, gráficos desatualizados ou loops de re-renderização infinitos em produção.
* **Afetados:**
  * Componentes: `RevenueChart.tsx`, `TopProductsChart.tsx`, `FinanceView.tsx`, `MovementsView.tsx`, `PdvView.tsx`
* **Sugestão de Correção:**
  1. Envolver funções Handler em `useCallback`.
  2. Ajustar os arrays de dependências dos `useEffect` afetados ou refatorar o ciclo de vida dos dados.

---

### 🟢 SEVERIDADE: BAIXO

#### [BAIXO-01] Presença de pacotes não utilizados na árvore de dependências do `package.json`
* **Descrição:** O arquivo `package.json` inclui pacotes como `express` (v4.21.2) e `@google/genai` (v2.4.0) em `dependencies`. Nenhuma dessas dependências é importada em qualquer arquivo dentro do diretório `src/` ou nas Edge Functions. Elas representam artefatos legados de templates de inicialização, aumentando o tamanho do `node_modules` e a superfície de auditoria de segurança de dependências (`npm audit`).
* **Afetados:**
  * Arquivo: `package.json`
* **Sugestão de Correção:**
  1. Remover as dependências não utilizadas executando `npm uninstall express @google/genai`.

---

#### [BAIXO-02] Manutenção de extenso código de fallback legado para RPCs nos serviços frontend
* **Descrição:** Módulos como `CustomersService`, `FinanceService`, `ReturnsService` e `ReportsService` contêm métodos legados de fallback (ex.: `getLegacyAll`, `getLegacyCommercialSummary`, `legacyFilter`, `legacySummary`) para lidar com o erro `PGRST202` quando as RPCs não são encontradas no Supabase. Como todas as migrações mais recentes estão aplicadas e consolidadas, esses fallbacks duplicam a lógica de negócios em TypeScript e realizam consultas sem paginação quando acionados.
* **Afetados:**
  * Arquivos: `customers.service.ts`, `finance.service.ts`, `returns.service.ts`, `reports.service.ts`
* **Sugestão de Correção:**
  1. Avaliar a remoção progressiva do código legado em favor das RPCs server-side obrigatórias, simplificando a manutenção e prevenindo discrepâncias entre os cálculos do banco e da interface.

---

## 3. Matriz de Segurança e Isolamento Multi-tenant

| Recurso / Tabela | RLS Habilitado? | Isolamento por `store_id` | Verificação em RPCs | Observação de Segurança |
| :--- | :---: | :---: | :---: | :--- |
| `public.sales` | ✅ SIM | ✅ SIM | ✅ SIM | Restrito por `has_store_access(store_id)`. Requer atenção no `DashboardService`. |
| `public.store_inventory` | ✅ SIM | ✅ SIM | ✅ SIM | RLS e RPCs validam o acesso do usuário à loja. |
| `public.customers` | ✅ SIM | ✅ SIM | ✅ SIM | Protegido por RLS e atrelado à loja. |
| `public.financial_transactions` | ✅ SIM | ✅ SIM | ✅ SIM | Acesso restrito a cargos `ADMIN` e `MANAGER` da loja. |
| `public.returns` | ✅ SIM | ✅ SIM | ✅ SIM | Processamento atômico via `process_return`. |
| `public.user_store_access` | ✅ SIM | ✅ SIM | ✅ SIM | Tabela central de vinculação de acesso multi-loja. |
| `Edge Functions (Deno)` | ✅ JWT Valido | ✅ SIM | ✅ SIM | Autenticação repassada via JWT do chamador para validação na RPC. |

---

## 4. Plano de Ação Recomendado

1. **Ação Imediata (Prioridade P0 / Crítica):**
   - Corrigir a consulta do `DashboardService.getMetrics()` para incluir obrigatoriamente o parâmetro `storeId` e o filtro `.eq('store_id', storeId)`.
   - Adicionar validação de limite de desconto por papel do operador na RPC `create_mp_pix_sale` e na Edge Function `create-mp-pix`.

2. **Ação a Curto Prazo (Prioridade P1 / Alta):**
   - Refatorar o cálculo de estoque baixo do `DashboardService` para utilizar a tabela `store_inventory` ou a RPC `report_stock_status`.
   - Substituir a geração de SKU com `Date.now()` em `InventoryService` por gerador de alta entropia ou sequência no banco.
   - Corrigir os 27 avisos do ESLint, em especial os hooks com dependências ausentes.

3. **Ação a Médio Prazo (Prioridade P2 / Média):**
   - Otimizar a RPC `get_customer_directory_page` consolidação das CTEs repetidas.
   - Desativar a persistência em `localStorage` para ambientes onde o Supabase está ativo.
   - Limpar dependências não utilizadas (`express`, `@google/genai`) do `package.json`.

---
*Relatório emitido e registrado em `docs/audits/AUDITORIA_TECNICA_CORESYS_2026-10-02.md` conforme as diretrizes de governança do CoreSys.*
