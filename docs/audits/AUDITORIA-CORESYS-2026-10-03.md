# Relatório de Auditoria Técnica Diária - CoreSys ERP/PDV
**Data:** 03 de Outubro de 2026
**Repositório:** FlavioProgramador/projeto-loja-multimarcas
**Auditor:** Engenheiro de Software Sênior (CoreSys Tech Audit)

---

## Executive Summary / Resumo Executivo
Esta auditoria diária do ecossistema CoreSys foi realizada com foco em segurança, isolamento multi-tenant, integridade de transações, RPCs no Supabase, regras RLS, performance de banco de dados e qualidade do código frontend e backend.

As últimas migrações aplicaram com sucesso hardening crítico na assinatura e idempotência da RPC `complete_sale`, `create_mp_pix_sale`, `cancel_sale`, bem como restrição de leitura à coluna `cost_price` e imposição de `search_path = public` em funções `SECURITY DEFINER`. Contudo, identificamos pendências e inconsistências remanescentes em serviços frontend, isolamento de fornecedores e agregações do dashboard.

---

## 1. Achados Classificados por Severidade

### [ALTO] 1. Missing Store Isolation in Dashboard Service (`DashboardService.getMetrics`)
- **Classificação:** ALTO (Multi-Tenant Data Leak / Agregação Cross-Store)
- **Descrição:** O método `DashboardService.getMetrics()` realiza consultas diretamente à tabela `sales` (`supabase.from('sales').select(...).eq('status', 'COMPLETED')`) e à tabela `product_variants` sem aplicar o filtro explícito pelo `store_id` da loja ativa. Em um cenário onde um usuário possui permissão de acesso a múltiplas lojas (ex: Administrador ou Gerente multi-lojas), as métricas de faturamento do mês, faturamento do dia, ticket médio e contagem de estoque baixo serão agregadas erroneamente somando dados de todas as lojas, quebrando o isolamento visual e operacional do tenant ativo.
- **Arquivos / Funções Afetados:** `src/services/dashboard.service.ts` -> `DashboardService.getMetrics()`
- **Sugestão de Correção:** Passar obrigatoriamente `storeId: string` para `DashboardService.getMetrics(storeId)`, adicionando `.eq('store_id', storeId)` na query da tabela `sales` e filtrando variações e estoque referente à loja informada através de `store_inventory`.

---

### [ALTO] 2. Falta de Tenant Scope (store_id) nas Operações de Fornecedores (`SuppliersService`)
- **Classificação:** ALTO (Multi-Tenant Boundary Risk)
- **Descrição:** O serviço `SuppliersService` manipula registros na tabela `suppliers` sem associar ou validar `store_id` (`getAll`, `create`, `update`, `remove`). Na modelagem atual do banco de dados, a tabela `suppliers` é compartilhada globalmente sem coluna `store_id` nem isolamento RLS por loja. Consequentemente, a alteração (`update`) ou inativação (`remove`) de um fornecedor feita por um operador de uma loja afetará diretamente todas as demais lojas do sistema que utilizam o mesmo fornecedor.
- **Arquivos / Tabelas Afetados:** `src/services/suppliers.service.ts`, tabela `public.suppliers`.
- **Sugestão de Correção:**
  1. Adicionar a coluna `store_id uuid REFERENCES public.stores(id)` na tabela `suppliers` ou criar uma tabela associativa `store_suppliers(store_id, supplier_id)`.
  2. Atualizar as políticas RLS de `suppliers` para restrigir leitura e modificação utilizando `has_store_access(store_id)` e `get_user_store_role(store_id)`.
  3. Atualizar os métodos de `SuppliersService` para exigirem e filtrarem pelo `store_id` da loja ativa.

---

### [MÉDIO] 3. Omissão de `store_id` nas Queries de Modificação Frontend (`CustomersService.update/remove`, `FinanceService.toggleExpensePaid`, `ProductsService.remove`)
- **Classificação:** MÉDIO (Defense-in-Depth / Direct Write Bypass Prevention)
- **Descrição:** Diversos métodos de atualização e deleção mágica no frontend dependem exclusivamente do filtro `.eq('id', uuid)` no client Supabase sem incluir `.eq('store_id', storeId)` na cláusula do query builder.
  - `CustomersService.update` e `CustomersService.remove` utilizam apenas `.eq('id', uuid)`.
  - `FinanceService.toggleExpensePaid` utiliza `.eq('id', uuid)` sem incluir `store_id`.
  - Embora as regras RLS no banco filtrem atualizações atreladas ao `store_id` via `get_user_store_role(store_id)`, a prática de omitir o tenant ID na cláusula WHERE do frontend enfraquece o princípio de *defense-in-depth* (defesa em profundidade), dificultando a auditoria de queries do cliente e aumentando o risco no caso de falhas de política RLS em deploys futuros.
- **Arquivos / Funções Afetados:**
  - `src/services/customers.service.ts` (`update`, `remove`)
  - `src/services/finance.service.ts` (`toggleExpensePaid`)
  - `src/services/products.service.ts` (`remove`)
- **Sugestão de Correção:** Garantir que todos os métodos de modificação do frontend recebam e incluam o `store_id` na query: `.eq('id', uuid).eq('store_id', storeId)`.

---

### [MÉDIO] 4. Dependência de LocalStorage para Estados de Dados sem Criptografia / Tenant Isolation Total
- **Classificação:** MÉDIO (Frontend Data Persistence / Cache Invalidation)
- **Descrição:** Em `StoreContext.tsx`, estados padrão para `products`, `suppliers`, `fixedExpenses` e `notifications` são persistidos via `localStorage` (chaves `erp_products`, `erp_suppliers`, etc.). Caso ocorra troca de usuário ou logout sem limpeza prévia no browser (ex: travamento do navegador), dados cached da loja anterior podem ser exibidos momentaneamente no frontend antes do término da sincronização com o banco.
- **Arquivos Afetados:** `src/contexts/StoreContext.tsx`
- **Sugestão de Correção:** Salvar os dados do cache local chaveando obrigatoriamente pelo ID do usuário e ID da loja (ex: `erp_products_${userId}_${activeStoreId}`), ou desativar a persistência local em produção quando o Supabase estiver devidamente configurado.

---

### [BAIXO] 5. Warnings de Variáveis não Utilizadas e Inconsistência de Hooks ESLint no Frontend
- **Classificação:** BAIXO (Qualidade de Código & Manutenibilidade)
- **Descrição:** Durante a execução do `npm run lint`, foram identificados 26 avisos (warnings), incluindo:
  - Variáveis/ícones declarados e nunca utilizados (`CreditCard`, `formatPaymentMethod` em `DashboardView.tsx`, `ChevronDown`, `Trash2`, `StockStatus` em `InventoryView.tsx`, `setSelectedColecao` em `PdvView.tsx`, `setCustomReason` em `NewReturnModal.tsx`).
  - Dependências ausentes em hooks `useEffect` (`RevenueChart.tsx`, `TopProductsChart.tsx`, `FinanceView.tsx`, `MovementsView.tsx`).
  - Avisos de Fast Refresh nos contextos (`AuthContext.tsx`, `CartContext.tsx`, `StoreContext.tsx`, `ThemeContext.tsx`).
- **Arquivos Afetados:**
  - `src/components/dashboard/DashboardView.tsx`
  - `src/components/dashboard/RevenueChart.tsx`
  - `src/components/dashboard/TopProductsChart.tsx`
  - `src/components/finance/FinanceView.tsx`
  - `src/components/inventory/InventoryView.tsx`
  - `src/components/pdv/PdvView.tsx`
  - `src/components/returns/NewReturnModal.tsx`
  - `src/contexts/*.tsx`
- **Sugestão de Correção:** Limpar as variáveis não utilizadas e ajustar as dependências dos hooks `useEffect`/`useCallback` para eliminar todos os avisos do linter.

---

## 2. Matriz de Auditoria e Objetivos

| Área de Auditoria | Status | Observações |
|---|---|---|
| **Supabase Auth & Roles** | ✅ APROVADO | Role checks estão com fail-closed (`v_role IS NULL OR v_role NOT IN (...)`). |
| **RLS Multi-Tenant** | ✅ APROVADO | Tabelas principais (`sales`, `inventory_movements`, `financial_transactions`, `customers`) validadas com RLS via `has_store_access`. |
| **SECURITY DEFINER RPCs** | ✅ APROVADO | Todas as RPCs críticas utilizam `SET search_path = public`, revogação de acessos `anon`/`PUBLIC` e checagens explícitas de tenant. |
| **Isolamento de Fornecedores** | ⚠️ ALTO | Tabela `suppliers` necessita de associação direta com `store_id`. |
| **Dashboard Frontend** | ⚠️ ALTO | Agregações do dashboard precisam filtrar por `store_id`. |
| **Tratamento de Erros e Idempotência** | ✅ APROVADO | `complete_sale` e `create_mp_pix_sale` com trava de transação e idempotência `sale_idempotency`. |
| **Testes Unitários & Build** | ✅ APROVADO | Suíte de testes (11 arquivos / 39 testes) e compilação do TypeScript sem erros. |

---

## 3. Conclusão e Próximos Passos
O CoreSys apresenta uma arquitetura robusta e com excelente nível de segurança e hardening no backend/Supabase. As correções aplicadas nas RPCs de vendas e devoluções resolveram vulnerabilidades críticas de concorrência e autorização.

Recomenda-se criar as seguintes issues/tarefas para o próximo ciclo de desenvolvimento:
1. **[TASK-01]** Adicionar `store_id` às consultas do `DashboardService` para garantir isolamento multi-tenant completo nas métricas.
2. **[TASK-02]** Migrar a tabela e o serviço de fornecedores (`suppliers`) para o modelo multi-tenant isolado por loja.
3. **[TASK-03]** Incluir `store_id` explícito em todas as operações de mutação direta nos serviços frontend (`CustomersService`, `FinanceService`, `ProductsService`).
4. **[TASK-04]** Realizar a limpeza dos 26 avisos do ESLint para manter o código limpo e sem débitos técnicos.
