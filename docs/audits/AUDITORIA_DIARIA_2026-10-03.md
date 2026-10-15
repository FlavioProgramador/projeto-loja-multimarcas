# 🔍 Relatório de Auditoria Técnica Diária - CoreSys ERP/PDV
**Data:** 03 de Outubro de 2026
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Auditor:** Engenheiro de Software Sênior (CoreSys Tech Audit)
**Status Geral:** Análise técnica concluída — Achados catalogados sem alterações automáticas efetuadas no código da aplicação nesta etapa.

---

## 📊 Resumo Executivo da Auditoria

A auditoria diária do CoreSys analisou a integridade da arquitetura **multi-tenant**, mecanismos de segurança em **Supabase Auth / RLS**, **Edge Functions (Deno)**, serviços no frontend (`src/services`), gerenciamento de contexto React, validações e concorrência no banco de dados.

| Severidade | Quantidade | Foco Principal |
| :--- | :---: | :--- |
| **🔴 CRÍTICO** | 1 | Ausência de isolamento multi-tenant (`store_id`) no serviço de Fornecedores (`SuppliersService`) |
| **🟠 ALTO** | 1 | Queries globais sem escopo de tenant e código morto em `DashboardService` |
| **🟡 MÉDIO** | 3 | Dependências incompletas de hooks React (`useEffect`) com risco de loop e estado desatualizado, falta de validação no formulário de fornecedor e ausência de limite no retorno de movimentações de estoque |
| **🟢 BAIXO** | 2 | Variáveis e ícones Lucide não utilizados gerando warnings no ESLint e exportações sem Fast Refresh nos Contextos |

---

## 🚨 Detalhamento dos Achados por Severidade

### 1. 🔴 CRÍTICO — Ausência de Isolamento Multi-Tenant em Fornecedores

- **Severidade:** **CRÍTICO**
- **Explicação do Problema:**
  A tabela `suppliers` e o serviço `SuppliersService` (`src/services/suppliers.service.ts`) executam consultas (`getAll`), inserções (`create`), atualizações (`update`) e inativações (`remove`) sem solicitar ou filtrar pelo parâmetro `store_id`. Em um ambiente multi-tenant, os fornecedores cadastrados por uma loja tornam-se visíveis e editáveis por usuários de outras lojas com perfil `ADMIN` ou `MANAGER`. Isso viola diretamente a regra fundamental do CoreSys de que "usuários de uma loja nunca consigam acessar dados de outra loja".
- **Arquivos/Tabelas/Funções Afetados:**
  - `src/services/suppliers.service.ts` (`getAll`, `create`, `update`, `remove`)
  - `src/hooks/domains/useSuppliersDomain.ts`
  - Tabela PostgreSQL: `public.suppliers`
- **Sugestão de Correção:**
  1. Adicionar coluna `store_id UUID REFERENCES public.stores(id)` na tabela `public.suppliers` via migração SQL.
  2. Atualizar as políticas RLS na tabela `public.suppliers` para exigir `public.has_store_access(store_id)`.
  3. Atualizar `SuppliersService` para receber `storeId: string` obrigatoriamente em `getAll`, `create`, `update` e `remove`.

---

### 2. 🟠 ALTO — Queries Sem Escopo de Tenant e Código Morto em `DashboardService`

- **Severidade:** **ALTO**
- **Explicação do Problema:**
  O serviço `DashboardService` (`src/services/dashboard.service.ts`) possui o método `getMetrics()` que realiza consultas diretas no Supabase na tabela `sales` (`.from('sales').select(...).eq('status', 'COMPLETED')`) e na tabela `product_variants` sem aplicar o filtro `.eq('store_id', storeId)`. Se esse serviço for invocado em um contexto multi-loja, ele agregará métricas de faturamento e vendas de todas as lojas que o usuário possui acesso RLS. Além disso, a tela principal (`DashboardView.tsx`) calcula suas métricas localmente a partir de `useStore()` e não utiliza o `DashboardService`, configurando um trecho de código morto inseguro.
- **Arquivos/Tabelas/Funções Afetados:**
  - `src/services/dashboard.service.ts` (`DashboardService.getMetrics`)
  - Tabela PostgreSQL: `public.sales`, `public.product_variants`
- **Sugestão de Correção:**
  1. Caso o `DashboardService` deva ser mantido para consultas no banco via RPC/service, alterar `getMetrics(storeId: string)` para exigir o identificador da loja e aplicar `.eq('store_id', storeId)`.
  2. Alternativamente, remover `src/services/dashboard.service.ts` para eliminar código morto vulnerável.

---

### 3. 🟡 MÉDIO — Dependências Incompletas em Hooks React e Risco de Re-renderes

- **Severidade:** **MÉDIO**
- **Explicação do Problema:**
  O ESLint identifica warnings de dependências ausentes em `useEffect` nos componentes visuais e de gráficos:
  - `RevenueChart.tsx` e `TopProductsChart.tsx`: `useEffect` sem `data` e `labels` na lista de dependências.
  - `FinanceView.tsx`: `useEffect` sem `loadTransactions` e `loadExpenses`.
  - `MovementsView.tsx`: `useEffect` sem `loadMovements`.
  - `PdvView.tsx`: A função `handleConfirmSale` é reconstruída a cada render sem `useCallback`, fazendo com que os efeitos dependentes disparem re-execuções desnecessárias.
  A ausência dessas dependências pode causar *stale closures* (dados desatualizados exibidos na UI após troca de loja) ou renderizações infinitas quando funções são recriadas.
- **Arquivos/Tabelas/Funções Afetados:**
  - `src/components/dashboard/RevenueChart.tsx`
  - `src/components/dashboard/TopProductsChart.tsx`
  - `src/components/finance/FinanceView.tsx`
  - `src/components/movements/MovementsView.tsx`
  - `src/components/pdv/PdvView.tsx`
- **Sugestão de Correção:**
  1. Envolver funções assíncronas em `useCallback` com as devidas dependências (`activeStoreId`, etc.).
  2. Incluir todas as dependências requeridas no array do `useEffect`.

---

### 4. 🟡 MÉDIO — Ausência de Limitação e Paginação em Consultas de Movimentação de Estoque

- **Severidade:** **MÉDIO**
- **Explicação do Problema:**
  Em `InventoryService.getMovements(storeId)` (`src/services/inventory.service.ts`), a consulta busca todos os registros da tabela `inventory_movements` ordenados por `created_at` sem aplicar um `.limit()` ou suporte a paginação server-side. À medida que o volume de movimentações cresce (milhares de movimentações por loja), a resposta do banco de dados causará lentidão no carregamento do módulo de estoque no frontend e consumo excessivo de memória.
- **Arquivos/Tabelas/Funções Afetados:**
  - `src/services/inventory.service.ts` (`getMovements`)
  - Tabela PostgreSQL: `public.inventory_movements`
- **Sugestão de Correção:**
  1. Implementar suporte a paginação (`p_limit`, `p_offset`) no serviço e/ou criar RPC de paginação para histórico de estoque.

---

### 5. 🟢 BAIXO — Importações e Variáveis Não Utilizadas (Warnings do Linter)

- **Severidade:** **BAIXO**
- **Explicação do Problema:**
  Foram identificados 26 avisos do ESLint relacionados a ícones do Lucide e variáveis declaradas mas não utilizadas (ex: `CreditCard`, `formatPaymentMethod` em `DashboardView`, `ChevronDown`, `Trash2` em `InventoryView`, `AlertCircle`, `User` em `NewReturnModal`, `formatPhone` em `SupplierForm`). Além disso, os arquivos de Contexto (`AuthContext`, `CartContext`, `StoreContext`, `ThemeContext`) exportam hooks no mesmo arquivo das definições de componentes, gerando alertas de Fast Refresh.
- **Arquivos/Tabelas/Funções Afetados:**
  - `src/components/dashboard/DashboardView.tsx`
  - `src/components/inventory/InventoryView.tsx`
  - `src/components/returns/NewReturnModal.tsx`
  - `src/components/suppliers/SupplierForm.tsx`
  - `src/contexts/*.tsx`
- **Sugestão de Correção:**
  1. Limpar importações não utilizadas e prefixar variáveis intencionalmente não utilizadas com `_`.

---

## 🔒 Avaliação dos Componentes Críticos de Segurança e Arquitetura

1. **Supabase RLS & RPCs Hardening:**
   - As migrações mais recentes (`20261003000000_coresys_audit_final_remediation.sql` e anteriores) implementaram adequadamente `SECURITY DEFINER` com `SET search_path = public` nas RPCs transacionais críticas (`complete_sale`, `create_mp_pix_sale`, `cancel_sale`, `process_return`, `register_stock_entry`).
   - O controle de acesso por loja (`has_store_access` e `get_user_store_role`) está ativo e validado em nível de banco.

2. **Edge Functions de Pagamento (Mercado Pago PIX):**
   - `create-mp-pix`, `mp-webhook` e `mp-pix-reconciliation-worker` possuem validação de assinatura HMAC-SHA256, verificação de concorrência com idempotência e headers de CORS restritos.

3. **Supabase Auth & Sessão:**
   - `AuthContext.tsx` e `AuthService.ts` implementam verificação de perfil ativo (`is_active = true`), revogação imediata ao detectar alteração de token e limpeza de caches sensíveis (`localStorage`/`sessionStorage`) no logout.

---

## 🏁 Próximos Passos Recomendados

1. **Sprint de Remediação P0:**
   - [ ] Implementar migração SQL e ajuste no frontend para associar `store_id` à tabela e serviço de `suppliers`.
   - [ ] Remover ou refatorar o `DashboardService.ts` para garantir o escopo por `store_id`.
2. **Sprint de Qualidade e Desempenho:**
   - [ ] Corrigir dependências de `useEffect` nos componentes visuais para zerar os warnings de linter.
   - [ ] Adicionar limite/paginação nas consultas de histórico de estoque (`InventoryService`).

---
**Relatório registrado em `docs/audits/AUDITORIA_DIARIA_2026-10-03.md`**.
