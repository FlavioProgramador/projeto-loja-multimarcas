# 📑 Relatório de Auditoria Técnica Diária — CoreSys
**Data:** 25 de Outubro de 2026
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Auditor:** Engenharia de Software Sênior (CoreSys)
**Status:** Concluído (Fase de Diagnóstico e Mapeamento)

---

## 📋 Resumo Executivo

A auditoria técnica diária do sistema **CoreSys** realizou uma varredura completa nas camadas de **Frontend (React/TypeScript)**, **Backend / Supabase (Migrations, RPCs PL/pgSQL, RLS, Auth)**, **Isolamento Multi-tenant**, **Segurança de Acesso (IDOR/BOLA)** e **Performance**.

Nesta etapa, de acordo com as diretrizes de governança do CoreSys, **nenhuma alteração automática foi aplicada ao código ou banco de dados**, garantindo o registro formal dos achados antes de qualquer modificação.

### Matriz de Severidade das Ocorrências

| Severidade | Quantidade | Foco Principal |
| :--- | :---: | :--- |
| 🔴 **CRÍTICO** | **2** | Bypasses em consultas multi-tenant e ausência de restrição de loja em tabelas legadas |
| 🟠 **ALTO** | **3** | Consultas globais de catálogo no frontend, funções SECURITY DEFINER de métricas sem auth guard |
| 🟡 **MÉDIO** | **4** | Mutação direta client-side em cadastro de estoque, poluição de localStorage multi-loja, ESLint warnings em hooks |
| 🟢 **BAIXO** | **2** | Código morto/não utilizado, warnings de exports em contextos React |

---

## 🔍 Detalhamento dos Achados por Severidade

---

### 1. 🔴 SEVERIDADE: CRÍTICO

#### Achado 1.1 — Ausência de filtro `store_id` na busca global de fornecedores
- **Severidade:** 🔴 CRÍTICO
- **Explicação do Problema:**
  O método `SuppliersService.getAll()` executa a consulta `.from('suppliers').select('*').eq('is_active', true)`. A tabela `suppliers` criada no script base (`setup.sql`) não possui a coluna `store_id` e sua política RLS está definida como `USING (true)`. Isso permite que usuários autenticados de qualquer loja consultem e modifiquem os dados de fornecedores de todas as demais lojas cadastradas no ecossistema, violando frontalmente a premissa do isolamento multi-tenant.
- **Arquivos / Tabelas / Funções Afetados:**
  - Arquivo Frontend: `src/services/suppliers.service.ts` (`SuppliersService.getAll`)
  - Tabela Supabase: `public.suppliers`
  - Política RLS: `"Suppliers viewable by authenticated"`
- **Sugestão de Correção:**
  1. Criar migration adicionando a coluna `store_id UUID REFERENCES public.stores(id)` à tabela `suppliers`.
  2. Ajustar as políticas RLS para exigir `store_id IS NOT NULL AND public.has_store_access(store_id)`.
  3. Atualizar `SuppliersService.getAll(storeId: string)` para exigir o argumento `storeId` obrigatoriamente e aplicar `.eq('store_id', storeId)`.

---

#### Achado 1.2 — Consultas de mutação de clientes/fornecedores sem vínculo explícito de `store_id` no filtro
- **Severidade:** 🔴 CRÍTICO
- **Explicação do Problema:**
  Em `CustomersService.update(uuid, customer)`, `CustomersService.remove(uuid)`, `SuppliersService.update(uuid, supplier)` e `SuppliersService.remove(uuid)`, as queries de atualização/exclusão lógica são executadas utilizando apenas `.eq('id', uuid)`. Embora as políticas RLS do Supabase sirvam como barreira primária, a ausência da verificação defensiva de `store_id` na query do cliente deixa o sistema vulnerável a potenciais IDOR/BOLA caso ocorra qualquer falha de configuração na policy da tabela.
- **Arquivos / Tabelas / Funções Afetados:**
  - Arquivos Frontend: `src/services/customers.service.ts`, `src/services/suppliers.service.ts`
  - Tabelas Supabase: `public.customers`, `public.suppliers`
- **Sugestão de Correção:**
  - Exigir `storeId` nos métodos de alteração/exclusão dos serviços e incluir explicitamente `.eq('store_id', storeId)` em todas as mutações.

---

### 2. 🟠 SEVERIDADE: ALTO

#### Achado 2.1 — Download de catálogo global no Frontend e filtragem em memória em `ProductsService.getAll`
- **Severidade:** 🟠 ALTO
- **Explicação do Problema:**
  A função `ProductsService.getAll(storeId?: string)` busca **todos** os produtos e variações ativos de todo o banco de dados via `.from('products').select(...)`, sem filtrar a loja na consulta SQL/PostgREST. Em seguida, aplica uma filtragem em memória via JavaScript `filter(product => ... store_inventory.some(i => i.store_id === storeId))`. Além de transferir dados desnecessários pela rede (risco de performance e custo), expõe metadados de produtos de outros estabelecimentos no payload transferido do servidor para o cliente.
- **Arquivos / Tabelas / Funções Afetados:**
  - Arquivo Frontend: `src/services/products.service.ts` (`ProductsService.getAll`)
  - Tabelas Supabase: `public.products`, `public.product_variants`, `public.store_inventory`
- **Sugestão de Correção:**
  - Mudar a consulta PostgREST para realizar o inner join diretamente no banco (`store_inventory!inner(store_id, quantity)` com `.eq('store_inventory.store_id', storeId)`) ou utilizar a RPC otimizada de consulta de catálogo por loja.

---

#### Achado 2.2 — Funções `SECURITY DEFINER` de métricas operacionais sem verificação de autorização de papel (`ADMIN`)
- **Severidade:** 🟠 ALTO
- **Explicação do Problema:**
  A migration `20261001150942_add_database_operational_health.sql` define as funções `get_database_operational_health` e `get_slow_query_metrics` como `SECURITY DEFINER`. Essas funções consultam visões administrativas do PostgreSQL (`pg_stat_activity`, `pg_stat_statements`). No entanto, a execução não verifica se o usuário autenticado (`auth.uid()`) possui o papel de `ADMIN` no sistema, permitindo que qualquer usuário autenticado (como caixas ou atendentes) obtenha métricas internas da infraestrutura do banco.
- **Arquivos / Tabelas / Funções Afetados:**
  - Migration: `supabase/migrations/20261001150942_add_database_operational_health.sql`
  - Funções Supabase: `public.get_database_operational_health`, `public.get_slow_query_metrics`
- **Sugestão de Correção:**
  - Adicionar no corpo das funções a validação fail-closed de papel de administração:
    ```sql
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN' AND is_active = true) THEN
      RAISE EXCEPTION 'Acesso negado às métricas operacionais do banco.';
    END IF;
    ```

---

#### Achado 2.3 — Parâmetro `storeId` opcional em `SalesService.getMovements`
- **Severidade:** 🟠 ALTO
- **Explicação do Problema:**
  Em `SalesService.getMovements(storeId?: string)`, o argumento `storeId` é opcional. Se a chamada for realizada sem passar o `storeId`, a query busca `.from('sales').select(...)` sem a instrução `.eq('store_id', storeId)`. Para usuários vinculados a mais de uma loja, o histórico exibirá vendas misturadas de lojas distintas.
- **Arquivos / Tabelas / Funções Afetados:**
  - Arquivo Frontend: `src/services/sales.service.ts` (`SalesService.getMovements`)
- **Sugestão de Correção:**
  - Tornar o parâmetro `storeId` obrigatório em `getMovements(storeId: string)` e abortar com erro se não for fornecido.

---

### 3. 🟡 SEVERIDADE: MÉDIO

#### Achado 3.1 — Mutação client-side multi-passo em `InventoryService.registerStockEntry`
- **Severidade:** 🟡 MÉDIO
- **Explicação do Problema:**
  Ao registrar uma entrada de estoque para um produto ou variação ainda não existente, o método `InventoryService.registerStockEntry` realiza consultas e inserções diretas no client-side (`insert` em `brands`, `categories`, `products` e `product_variants`). Se o processo falhar na metade, registros órfãos são mantidos no banco sem rollback transacional.
- **Arquivos / Tabelas / Funções Afetados:**
  - Arquivo Frontend: `src/services/inventory.service.ts` (`InventoryService.registerStockEntry`)
  - Tabelas Supabase: `public.brands`, `public.categories`, `public.products`, `public.product_variants`
- **Sugestão de Correção:**
  - Centralizar a criação de marca/categoria/produto/variação na RPC `manage_product` ou expandir `register_stock_entry` para tratar a criação de variações de forma atômica no banco PostgreSQL.

---

#### Achado 3.2 — Armazenamento de dados no `localStorage` do navegador sem namespace de loja
- **Severidade:** 🟡 MÉDIO
- **Explicação do Problema:**
  Em `src/contexts/StoreContext.tsx`, os estados da aplicação são salvos no `localStorage` sob chaves fixas (`erp_products`, `erp_suppliers`, `erp_fixed_expenses`, `erp_notifications`). Em ambientes com múltiplos usuários no mesmo computador ou na alternância entre lojas, dados de um estabelecimento podem persistir e vazar no armazenamento local.
- **Arquivos / Tabelas / Funções Afetados:**
  - Arquivo Frontend: `src/contexts/StoreContext.tsx`
- **Sugestão de Correção:**
  - Prefixar as chaves do storage com o id da loja ativa (`erp_${activeStoreId}_products`) ou utilizar `sessionStorage` limpo no encerramento da sessão.

---

#### Achado 3.3 — Warnings de ESLint e React Hooks sem dependências declaradas (`exhaustive-deps`)
- **Severidade:** 🟡 MÉDIO
- **Explicação do Problema:**
  Foram identificados avisos do ESLint referentes a dependências ausentes em `useEffect` e funções sem `useCallback`:
  - `RevenueChart.tsx` e `TopProductsChart.tsx`: `useEffect` sem `data` e `labels`.
  - `FinanceView.tsx`: `useEffect` sem `loadTransactions` e `loadExpenses`.
  - `MovementsView.tsx`: `useEffect` sem `loadMovements`.
  - `PdvView.tsx`: `handleConfirmSale` re-criada em todo render causando recarga contínua.
- **Arquivos / Tabelas / Funções Afetados:**
  - Componentes React: `RevenueChart.tsx`, `TopProductsChart.tsx`, `FinanceView.tsx`, `MovementsView.tsx`, `PdvView.tsx`
- **Sugestão de Correção:**
  - Refatorar as funções auxiliares utilizando `useCallback` e adicionar as dependências corretas nas listas dos Hooks.

---

#### Achado 3.4 — Atualizações otimistas da UI sem notificação em caso de erro na restauração
- **Severidade:** 🟡 MÉDIO
- **Explicação do Problema:**
  Nos Hooks `useCustomersDomain`, `useSuppliersDomain` e `useProductsDomain`, ao editar ou remover um registro, o estado local é alterado antes da confirmação do banco e restaurado em caso de exceção. Porém, nem todos os fluxos exibem uma mensagem de alerta (toast/banner) para o usuário final, gerando a falsa impressão de que a alteração foi salva antes da restauração do estado.
- **Arquivos / Tabelas / Funções Afetados:**
  - Hooks: `useCustomersDomain.ts`, `useSuppliersDomain.ts`, `useProductsDomain.ts`
- **Sugestão de Correção:**
  - Garantir que todo bloco `catch` acione um componente visual de notificação de erro ao usuário.

---

### 4. 🟢 SEVERIDADE: BAIXO

#### Achado 4.1 — Variáveis e importações não utilizadas
- **Severidade:** 🟢 BAIXO
- **Explicação do Problema:**
  Presença de ícones e utilitários importados mas não utilizados em diversos arquivos da UI (ex: `CreditCard` e `formatPaymentMethod` em `DashboardView.tsx`, `ChevronDown` e `Trash2` em `InventoryView.tsx`, `PlusCircle` em `NewProductModal.tsx`).
- **Arquivos / Tabelas / Funções Afetados:**
  - `DashboardView.tsx`, `InventoryView.tsx`, `NewProductModal.tsx`, `StockEntryModal.tsx`, `NewReturnModal.tsx`, `SupplierForm.tsx`, `store.service.ts`
- **Sugestão de Correção:**
  - Remover as importações e declarações limpas durante as próximas sprints de manutenção.

---

#### Achado 4.2 — Warning de Fast Refresh nos Contextos React devido a exportações secundárias
- **Severidade:** 🟢 BAIXO
- **Explicação do Problema:**
  Os arquivos `AuthContext.tsx`, `CartContext.tsx`, `StoreContext.tsx` e `ThemeContext.tsx` exportam funções utilitárias/tipos no mesmo arquivo do componente React, gerando aviso do Fast Refresh do Vite/ESLint.
- **Arquivos / Tabelas / Funções Afetados:**
  - `src/contexts/*.tsx`
- **Sugestão de Correção:**
  - Mover funções e tipos compartilhados para arquivos utilitários/modelos dedicados na pasta `src/types/` ou `src/lib/`.

---

## 🛠️ Recomendações e Plano de Ação Priorizado

1. **Prioridade P0 (Imediata — Segurança & Isolamento):**
   - Adicionar `store_id` à tabela `suppliers` e atualizar as políticas RLS.
   - Tornar o parâmetro `storeId` obrigatório em `SalesService.getMovements` e `SuppliersService.getAll`.
   - Adicionar restrição explícita de `store_id` em mutações de `CustomersService` e `SuppliersService`.
   - Inserir verificação de papel `ADMIN` nas funções de diagnóstico do banco.

2. **Prioridade P1 (Próxima Sprint — Performance e Integridade):**
   - Refatorar `ProductsService.getAll` para filtrar produtos por loja diretamente na query PostgREST.
   - Encapsular a criação de produtos e variações de `InventoryService.registerStockEntry` em RPCs atômicas.
   - Namespacer ou remover dados sensíveis do `localStorage`.

3. **Prioridade P2 (Qualidade do Código e UX):**
   - Corrigir os avisos do ESLint `react-hooks/exhaustive-deps`.
   - Garantir mensagens visuais de erro em atualizações otimistas revertidas.
   - Limpar código morto e organizar exportações de contexto para o Fast Refresh.

---

*Relatório gerado e registrado para acompanhamento em 25/10/2026.*
