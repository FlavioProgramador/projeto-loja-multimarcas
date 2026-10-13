# 📊 RELATÓRIO DE AUDITORIA TÉCNICA DIÁRIA - CORESYS
**Data:** 03 de Outubro de 2026
**Responsável:** Engenheiro de Software Sênior (Auditoria CoreSys)
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Status:** Auditado e Registrado

---

## 🎯 RESUMO EXECUTIVO

Foi realizada uma análise minuciosa do estado atual do código-fonte frontend (React/TypeScript/Vite), backend (Supabase PostgreSQL, RPCs, RLS) e Deno Edge Functions. A arquitetura multi-tenant passou por um processo significativo de hardening nas migrações recentes, mas foram identificadas vulnerabilidades residuais de vazamento de estado entre tenants no frontend, além de falhas de formatação/validação em cadastros e funções `SECURITY DEFINER` legadas sem `search_path` fixo.

### Métricas de Vulnerabilidade
| Severidade | Quantidade | Foco Principal |
|---|---|---|
| 🔴 **CRÍTICO** | 2 | Vazamento de estado do fornecedor na troca de loja no React; Persistência insegura em `localStorage`. |
| 🟠 **ALTO** | 3 | Corrupção de dado em formulário de fornecedor (`SupplierForm.tsx`); Função `SECURITY DEFINER` sem `search_path`; Escopo tenant e tratamento de erros no `SuppliersService`. |
| 🟡 **MÉDIO** | 3 | Dependências ausentes em React `useEffect` (risco de stale closures/race conditions); Erros em services mascarados/silenciados (`getAll`). |
| 🟢 **BAIXO** | 2 | Código morto / variáveis não utilizadas (warnings de ESLint); Avisos de exportação no Fast Refresh dos Contexts. |

---

## 🚨 ACHADOS DETALHADOS POR SEVERIDADE

### 🔴 SEVERIDADE: CRÍTICO

#### 1. Vazamento de Estado Multi-Tenant na Troca de Loja
* **Descrição:** Em `src/contexts/StoreContext.tsx`, o efeito colateral disparado na mudança de loja ativa (`activeStoreId`) reseta os estados de produtos, transações, movimentações, clientes, devoluções, despesas fixas e notificações (`setProducts([])`, `setTransactions([])`, etc.). No entanto, **`setSuppliers([])` foi omitido** desse reset. Caso a troca de loja falhe ou a requisição demore, o usuário visualizará temporariamente ou indefinidamente os fornecedores da loja anterior.
* **Afetados:**
  * **Arquivo:** `src/contexts/StoreContext.tsx` (linhas 81-91)
  * **Tabela/Domínio:** `suppliers` / Fornecedores
* **Sugestão de Correção:**
  Incluir `setSuppliers([])` no `useEffect` de troca de `activeStoreId` em `StoreContext.tsx`.

---

#### 2. Persistência Insegura de Dados de Tenants no `localStorage`
* **Descrição:** Em `src/contexts/StoreContext.tsx` (linhas 74-77), o estado global de produtos, fornecedores, despesas fixas e notificações é persistido automaticamente no `localStorage` do navegador sob chaves não escopadas (`erp_products`, `erp_suppliers`, `erp_fixed_expenses`, `erp_notifications`). Em ambientes compartilhados ou trocas de usuário/loja na mesma máquina, esses dados em cache local podem expor informações cadastrais e financeiras de uma loja para outra.
* **Afetados:**
  * **Arquivo:** `src/contexts/StoreContext.tsx`
  * **Tabela/Domínio:** `products`, `suppliers`, `fixed_expenses`, `notifications`
* **Sugestão de Correção:**
  Remover a escrita automática no `localStorage` quando a integração com Supabase estiver ativa ou adicionar o prefixo do `userId` e `activeStoreId` nas chaves de armazenamento local.

---

### 🟠 SEVERIDADE: ALTO

#### 3. Mutilação de Nomes/Textos de Contato no Formulário de Fornecedores
* **Descrição:** No componente `src/components/suppliers/SupplierForm.tsx` (linhas 50-58), ao submeter o formulário de cadastro/edição de fornecedor, a propriedade `contato` é tratada via `form.contato.replace(/\D/g, '')`. O campo do formulário é rotulado como "Contato / responsável / telefone" e exemplificado com nomes como `"Maria - Vendas"`. A remoção de todos os caracteres não-numéricos apaga completamente o texto digitado, gravando strings vazias (`""`) ou números truncados no banco de dados.
* **Afetados:**
  * **Arquivo:** `src/components/suppliers/SupplierForm.tsx`
  * **Função/Componente:** `submit()` / `SupplierForm`
* **Sugestão de Correção:**
  Remover o `.replace(/\D/g, '')` do campo `contato` no arquivo `SupplierForm.tsx`.

---

#### 4. Função `SECURITY DEFINER` Sem `search_path` Imutável
* **Descrição:** Na migração `20260828000001_hardening_rls.sql`, a função `public.protect_profile_role` é declarada como `SECURITY DEFINER` sem definir explicitamente `SET search_path`. Funções que rodam com privilégios de definidor sem `search_path` fixo abrem brecha para ataques de manipulação de esquema (schema search_path hijacking).
* **Afetados:**
  * **Tabela/Função:** `public.protect_profile_role()`
  * **Arquivo:** `supabase/migrations/20260828000001_hardening_rls.sql`
* **Sugestão de Correção:**
  Executar um `ALTER FUNCTION public.protect_profile_role() SET search_path = pg_catalog, public;` em nova migração.

---

#### 5. Ausência de Escopo de Tenant e Silenciamento de Erro em `SuppliersService`
* **Descrição:** O serviço `SuppliersService.getAll()` busca dados através de `supabase.from('suppliers').select('*').eq('is_active', true)` sem passar filtro de `store_id` e sem propagar exceções (retorna `[]` ao capturar um erro). A tabela `suppliers` no banco possui políticas globais sem isolamento por loja.
* **Afetados:**
  * **Arquivos:** `src/services/suppliers.service.ts`, `src/hooks/useStoreData.ts`
  * **Tabelas:** `public.suppliers`
* **Sugestão de Correção:**
  Adicionar a coluna e chave estrangeira `store_id` à tabela `suppliers` com políticas RLS por loja, e garantir que os erros de consulta sejam propagados para exibição no frontend.

---

### 🟡 SEVERIDADE: MÉDIO

#### 6. Dependências Ausentes em Hooks `useEffect` e Risco de Stale Closures
* **Descrição:** Diversos componentes React contêm dependências faltantes em seus arrays do `useEffect`, gerando warnings no ESLint e podendo ocasionar renderizações desatualizadas ou chamadas com estado desatualizado:
  - `src/components/dashboard/RevenueChart.tsx` (faltam `data`, `labels`)
  - `src/components/dashboard/TopProductsChart.tsx` (faltam `data`, `labels`)
  - `src/components/finance/FinanceView.tsx` (faltam `loadTransactions`, `loadExpenses`)
  - `src/components/movements/MovementsView.tsx` (falta `loadMovements`)
  - `src/components/pdv/PdvView.tsx` (função `handleConfirmSale` altera dependência a cada renderização)
* **Afetados:**
  * **Arquivos:** Lista de componentes acima
* **Sugestão de Correção:**
  Envolver funções como `handleConfirmSale` em `useCallback` e declarar todas as dependências reativas nos respectivos `useEffect`.

---

#### 7. Tratamento de Erro Silencioso em Serviços do Frontend
* **Descrição:** Funções em `ProductsService` e `SuppliersService` utilizam `console.error` e retornam coleções vazias em caso de erro de banco, impedindo que os componentes de interface identifiquem a falha e mostrem alertas de erro ao usuário.
* **Afetados:**
  * **Arquivos:** `src/services/products.service.ts`, `src/services/suppliers.service.ts`
* **Sugestão de Correção:**
  Lançar as exceções capturadas (`throw error`) para tratamento no nível da view ou hook consumidos.

---

### 🟢 SEVERIDADE: BAIXO

#### 8. Código Morto e Variáveis Não Utilizadas
* **Descrição:** Existem variáveis declaradas e nunca lidas que geram 26 avisos de linter:
  - `CreditCard`, `formatPaymentMethod` em `DashboardView.tsx`
  - `ChevronDown`, `Trash2`, `StockStatus` em `InventoryView.tsx`
  - `PlusCircle` em `NewProductModal.tsx`
  - `ArrowUp` em `StockEntryModal.tsx`
  - `AlertCircle`, `User`, `CreditCard`, `setCustomReason` em `NewReturnModal.tsx`
  - `formatPhone` em `SupplierForm.tsx`
  - Import `Store` em `store.service.ts`
* **Afetados:** Arquivos do frontend listados acima.
* **Sugestão de Correção:** Limpar os imports e declarações não utilizados.

---

#### 9. Avisos de Fast Refresh nos Contextos React
* **Descrição:** Os arquivos `AuthContext.tsx`, `CartContext.tsx`, `StoreContext.tsx` e `ThemeContext.tsx` exportam funções/constantes auxiliares junto aos componentes, o que aciona o aviso do plugin Vite/React Fast Refresh.
* **Afetados:** `src/contexts/AuthContext.tsx`, `CartContext.tsx`, `StoreContext.tsx`, `ThemeContext.tsx`
* **Sugestão de Correção:** Mover tipos e utilitários compartilhados para arquivos em `src/types/` ou `src/lib/`.

---

## 🛠️ PLANO DE RECOMENDAÇÕES PARA CORREÇÃO (PRÓXIMAS ETAPAS)

1. **Sprint Imediata (Segurança & Bugs Críticos):**
   - [ ] Corrigir `StoreContext.tsx` incluindo `setSuppliers([])` na troca de loja.
   - [ ] Desativar ou escopar o uso de `localStorage` para dados multi-tenant.
   - [ ] Corrigir o tratamento de `contato` em `SupplierForm.tsx`.
   - [ ] Criar migração para ajustar `search_path` de `public.protect_profile_role`.

2. **Sprint Secundária (Qualidade & Refatoração):**
   - [ ] Corrigir os hooks `useEffect` / `useCallback` reportados pelo ESLint.
   - [ ] Remover código morto e variáveis não utilizadas.
   - [ ] Reorganizar exportações de contextos para otimizar o Fast Refresh.
