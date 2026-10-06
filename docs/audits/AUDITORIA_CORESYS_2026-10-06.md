# Relatório de Auditoria Técnica Diária do CoreSys

**Data:** 06 de outubro de 2026
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Responsável:** Engenheiro de Software Sênior / Auditoria Técnica CoreSys
**Status:** Auditado (Nenhuma alteração automática de código realizada nesta etapa)

---

## 1. RESUMO EXECUTIVO

O sistema CoreSys passou por uma auditoria técnica diária abrangendo código-fonte frontend (React/TypeScript/Vite), backend (Supabase PostgreSQL, RLS, Triggers e RPCs SECURITY DEFINER), isolamento multi-tenant e qualidade de código.

### Resumo Geral de Achados

| Severidade | Quantidade | Foco Principal |
| :--- | :---: | :--- |
| 🔴 **CRÍTICO** | **2** | Ausência de `store_id` na tabela `suppliers` e remoção global de produtos desativando catálogo compartilhado |
| 🟧 **ALTO** | **3** | Consultas diretas de alteração no frontend sem escopo explícito `.eq('store_id', storeId)` em `customers` e `fixed_expenses`; Nomes de parâmetros em RPCs de relatórios com divergência de convenção |
| 🟨 **MÉDIO** | **4** | Dependências ausentes em `useEffect` React Hooks gerando re-renders/stale closures; Ausência de `useCallback` em manipuladores do PDV (`handleConfirmSale`); Inconsistência na criação dinâmica de marcas/categorias sem tratamento de duplicação aproximada |
| 🟦 **BAIXO** | **3** | 27 avisos de variáveis/imports não utilizados no linter (`npm run lint`); Exportações mistas gerando alertas de Fast Refresh nos contextos React |

---

## 2. TABELA DE ACHADOS CATALOGADOS

| ID | Severidade | Categoria | Descrição Sumária | Afetados |
| :--- | :--- | :--- | :--- | :--- |
| **ACH-01** | 🔴 CRÍTICO | Multi-tenant / DB | Tabela `suppliers` não possui `store_id` (registro global compartilhado) | Tabela `public.suppliers`, `SuppliersService` |
| **ACH-02** | 🔴 CRÍTICO | Multi-tenant / Lógica | Desativação de produto (`ProductsService.remove`) afeta o produto globalmente em vez de desativar o estoque da loja | `ProductsService.ts`, Tabela `public.products` |
| **ACH-03** | 🟧 ALTO | Segurança / BOLA | Cláusulas de update/delete em `CustomersService` não especificam `.eq('store_id', storeId)` | `CustomersService.ts`, Tabela `public.customers` |
| **ACH-04** | 🟧 ALTO | Segurança / BOLA | Alteração de status de pagamento em `FinanceService.toggleExpensePaid` não especifica `.eq('store_id', storeId)` | `FinanceService.ts`, Tabela `public.fixed_expenses` |
| **ACH-05** | 🟧 ALTO | Backend / RPC | Nomes e formato de datas nas RPCs `get_profitability_by_product` e `get_profitability_by_category` | `reports.service.ts`, RPCs `get_profitability_*` |
| **ACH-06** | 🟨 MÉDIO | Frontend / React | Dependências ausentes em `useEffect` nos componentes de dashboard e movimentações | `RevenueChart.tsx`, `TopProductsChart.tsx`, `FinanceView.tsx`, `MovementsView.tsx` |
| **ACH-07** | 🟨 MÉDIO | Frontend / Performance | `handleConfirmSale` em `PdvView.tsx` re-instanciado a cada render recriando listeners de leitor de código de barras | `PdvView.tsx` |
| **ACH-08** | 🟨 MÉDIO | Lógica de Negócio | Inserção dinâmica de `brands` e `categories` com risco de duplicação aproximada no cadastro de estoque | `InventoryService.ts`, Tabelas `brands`, `categories` |
| **ACH-09** | 🟨 MÉDIO | Performance DB | Falta de índice composto otimizado em queries de pagamentos/vendas legadas sem uso das RPCs paginadas | Tabela `public.payments`, `public.sales` |
| **ACH-10** | 🟦 BAIXO | Qualidade de Código | 27 avisos no ESLint sobre variáveis e ícones não utilizados | Diversos componentes em `src/components/` |
| **ACH-11** | 🟦 BAIXO | Frontend / DX | Módulo Fast Refresh com aviso de exportação não-componente em arquivos Context | `AuthContext.tsx`, `CartContext.tsx`, `StoreContext.tsx`, `ThemeContext.tsx` |
| **ACH-12** | 🟦 BAIXO | Segurança BD | Supabase Advisor aponta proteção contra senhas vazadas desativada na instância | Configuração da instância Supabase PostgreSQL |

---

## 3. ANÁLISE DETALHADA DOS ACHADOS

### 🔴 ACH-01: Tabela `suppliers` não possui isolamento multi-tenant (`store_id`)
- **Severidade:** CRÍTICO
- **Explicação:** A tabela `suppliers` foi criada sem a coluna `store_id`. Quando uma loja cadastra, edita ou inativa um fornecedor através de `SuppliersService`, a operação afeta a tabela globalmente. Usuários de uma loja conseguem visualizar, modificar e desativar fornecedores cadastrados por outras lojas.
- **Arquivos/Tabelas Afetados:**
  - Tabela `public.suppliers`
  - Arquivo `src/services/suppliers.service.ts`
  - Migration de RLS `supabase/migrations/20260828000001_hardening_rls.sql`
- **Sugestão de Correção:**
  1. Criar migration adicionando `store_id UUID REFERENCES public.stores(id)` na tabela `suppliers`.
  2. Atualizar as políticas RLS em `suppliers` exigindo `has_store_access(store_id)` e roles de loja.
  3. Atualizar `SuppliersService` para filtrar, criar e atualizar com escopo obrigatório em `store_id`.

---

### 🔴 ACH-02: Remoção de produto desativa o registro global em vez do estoque da loja
- **Severidade:** CRÍTICO
- **Explicação:** O método `ProductsService.remove(uuid)` executa `supabase.from('products').update({ is_active: false }).eq('id', uuid)`. Em uma arquitetura onde o catálogo de produtos pode ser compartilhado entre lojas e o estoque gerido via `store_inventory`, desativar a flag `is_active` na tabela `products` oculta o produto para todas as lojas do sistema, e não apenas para a loja atual.
- **Arquivos/Tabelas Afetados:**
  - `src/services/products.service.ts`
  - Tabela `public.products`
  - Tabela `public.store_inventory`
- **Sugestão de Correção:**
  1. Definir a regra de negócio para deleção/desativação por loja: desativar o vínculo na tabela `store_inventory` para a loja ativa (ex: alterar a quantidade para 0 ou marcar uma flag `is_active` em `store_inventory`), ou restringir a inativação global do produto exclusivamente a usuários com papel global `ADMIN`.

---

### 🟧 ACH-03: `CustomersService` realiza updates/remagamentos sem `.eq('store_id', storeId)` no frontend
- **Severidade:** ALTO
- **Explicação:** Os métodos `CustomersService.update(uuid, customer)` e `CustomersService.remove(uuid)` executam atualizações filtrando apenas por `id` (UUID do cliente). Embora o RLS no banco valide o acesso à loja, o princípio de Defesa em Profundidade (Defense in Depth) exige que todas as queries originadas no frontend contenham o escopo do tenant (`store_id`) para prevenir falhas de IDOR/BOLA caso uma política RLS seja alterada ou bypassada em futuras alterações de schema.
- **Arquivos/Tabelas Afetados:**
  - `src/services/customers.service.ts`
  - Tabela `public.customers`
- **Sugestão de Correção:**
  - Exigir `storeId` como parâmetro obrigatório em `CustomersService.update` e `CustomersService.remove`, concatenando `.eq('store_id', storeId)`.

---

### 🟧 ACH-04: `FinanceService.toggleExpensePaid` altera despesas sem filtrar por `store_id`
- **Severidade:** ALTO
- **Explicação:** O método `FinanceService.toggleExpensePaid(uuid, currentPaidState)` executa `.from('fixed_expenses').update({ paid: !currentPaidState }).eq('id', uuid)`. A consulta não envia o `store_id` ativo da sessão.
- **Arquivos/Tabelas Afetados:**
  - `src/services/finance.service.ts`
  - Tabela `public.fixed_expenses`
- **Sugestão de Correção:**
  - Alterar a assinatura para `toggleExpensePaid(storeId: string, uuid: string, currentPaidState: boolean)` e adicionar `.eq('store_id', storeId)` na query Supabase.

---

### 🟧 ACH-05: Inconsistência de nomes de parâmetros nas RPCs de rentabilidade em `ReportsService`
- **Severidade:** ALTO
- **Explicação:** Em `ReportsService.getProfitabilityByProduct` e `getProfitabilityByCategory`, o serviço passa os parâmetros `{ p_store_id: storeId, start_date: startDate, end_date: endDate }`. No banco de dados, o parâmetro da RPC foi definido como `p_store_id uuid, start_date date, end_date date`. Embora o mapeamento PostgREST funcione para esses nomes específicos, a convenção do projeto utiliza o prefixo `p_` (`p_start_date`, `p_end_date`). Além disso, chamadas sem tratamento de exceção adequado podem estourar erros de RPC não capturados.
- **Arquivos/Tabelas Afetados:**
  - `src/services/reports.service.ts`
  - Funções PostgreSQL `get_profitability_by_product` e `get_profitability_by_category`
- **Sugestão de Correção:**
  - Padronizar os nomes de parâmetros para `p_start_date` e `p_end_date` no SQL e no frontend, adicionando bloco de tratamento defensivo em `ReportsService`.

---

### 🟨 ACH-06: React Hooks com dependências ausentes gerando potenciais stale closures
- **Severidade:** MÉDIO
- **Explicação:** Os componentes de relatórios e dashboards (`RevenueChart.tsx`, `TopProductsChart.tsx`, `FinanceView.tsx`, `MovementsView.tsx`) contêm alertas de linter `react-hooks/exhaustive-deps`. O uso de `useEffect` omitindo dependências como `data`, `labels`, `loadTransactions` e `loadExpenses` causa risco de exibição de dados desatualizados ao alternar entre lojas ou períodos.
- **Arquivos Afetados:**
  - `src/components/dashboard/RevenueChart.tsx`
  - `src/components/dashboard/TopProductsChart.tsx`
  - `src/components/finance/FinanceView.tsx`
  - `src/components/movements/MovementsView.tsx`
- **Sugestão de Correção:**
  - Ajustar as dependências dos hooks `useEffect` e envolver funções utilitárias/fetchers em `useCallback`.

---

### 🟨 ACH-07: Inexistência de `useCallback` em `handleConfirmSale` em `PdvView.tsx`
- **Severidade:** MÉDIO
- **Explicação:** O manipulador de confirmação de venda `handleConfirmSale` é reconstruído em cada render do componente `PdvView.tsx`. Como essa função é incluída na lista de dependências do `useEffect` responsável pelos atalhos de teclado e leitor de código de barras (linha 372), os event listeners da janela são desvinculados e reatrelados continuamente a cada digitação ou interação com o carrinho.
- **Arquivos Afetados:**
  - `src/components/pdv/PdvView.tsx`
- **Sugestão de Correção:**
  - Envolver `handleConfirmSale` em um hook `useCallback` com dependências bem delimitadas.

---

### 🟨 ACH-08: Inserção dinâmica de `brands` e `categories` com risco de duplicação por pequenas variações
- **Severidade:** MÉDIO
- **Explicação:** No método `InventoryService.registerStockEntry`, caso uma marca ou categoria não seja encontrada por `ilike('name', params.brand.trim())`, o sistema insere automaticamente uma nova marca/categoria. Variações como espaços duplos, hífens ou erros de digitação criam registros duplicados no banco sem validação prévia pelo usuário.
- **Arquivos/Tabelas Afetados:**
  - `src/services/inventory.service.ts`
  - Tabelas `public.brands` e `public.categories`
- **Sugestão de Correção:**
  - Normalizar strings removendo espaços extras e acentos antes do lookup e exigir seleção/confirmação explícita no modal de entrada de estoque.

---

### 🟨 ACH-09: Ausência de índice composto em consultas de suporte legado
- **Severidade:** MÉDIO
- **Explicação:** Embora as RPCs paginadas recentes (`get_finance_page`, `get_returns_page`, `get_customer_directory_page`) possuam bom desempenho, os fallbacks legados em `FinanceService` e `ReturnsService` realizam ordenações e buscas ordenadas por `created_at` em tabelas com alto volume sem índice composto cobrindo `(store_id, created_at DESC)`.
- **Arquivos/Tabelas Afetados:**
  - Tabelas `public.financial_transactions`, `public.returns`
- **Sugestão de Correção:**
  - Garantir a presença dos índices `idx_financial_transactions_store_created` e `idx_returns_store_created` no banco PostgreSQL.

---

### 🟦 ACH-10: 27 avisos de linter sobre variáveis e ícones não utilizados
- **Severidade:** BAIXO
- **Explicação:** A execução de `npm run lint` sinalizou 27 avisos no TypeScript/ESLint. Dentre eles, ícones importados da biblioteca `lucide-react` e variáveis não utilizadas que poluem o bundle e dificultam a manutenção.
- **Arquivos Afetados:**
  - `DashboardView.tsx`, `FinanceView.tsx`, `InventoryView.tsx`, `NewProductModal.tsx`, `StockEntryModal.tsx`, `PdvView.tsx`, `NewReturnModal.tsx`, `SupplierForm.tsx`, `store.service.ts`.
- **Sugestão de Correção:**
  - Remover imports e variáveis não utilizados ou prefixar argumentos intencionais com `_`.

---

### 🟦 ACH-11: Alertas de Fast Refresh em Contextos React
- **Severidade:** BAIXO
- **Explicação:** Arquivos como `AuthContext.tsx`, `CartContext.tsx`, `StoreContext.tsx` e `ThemeContext.tsx` exportam tanto componentes React quanto funções/constantes auxiliares (ex: `useAuth`, `useCart`). Isso aciona o aviso do `eslint-plugin-react-refresh`, pois pode causar recarga total da página durante o desenvolvimento.
- **Arquivos Afetados:**
  - `src/contexts/AuthContext.tsx`
  - `src/contexts/CartContext.tsx`
  - `src/contexts/StoreContext.tsx`
  - `src/contexts/ThemeContext.tsx`
- **Sugestão de Correção:**
  - Separar a definição e exportação dos custom hooks (`useAuth`, `useCart`, etc.) em arquivos próprios na pasta `src/hooks/`.

---

### 🟦 ACH-12: Recomendação do Supabase Advisor para Leaked Password Protection
- **Severidade:** BAIXO
- **Explicação:** O advisor de segurança do Supabase indica que a funcionalidade de proteção contra senhas vazadas (HaveIBeenPwned integration) está desativada na instância do banco.
- **Afetados:**
  - Instância do Supabase Auth / PostgreSQL
- **Sugestão de Correção:**
  - Habilitar a verificação de senhas vazadas no painel do Supabase Auth (Dashboard -> Authentication -> Security Settings).

---

## 4. VERIFICAÇÃO DE TESTES E QUALIDADE DE CÓDIGO

Submetemos o repositório às suítes de verificação disponíveis:

1. **Testes Unitários (Vitest):**
   - **Resultado:** 11/11 arquivos de teste aprovados (39/39 testes passando).
   - **Módulos validados:** Modelo financeiro (`finance.model.test.ts`), Roteamento de Auth, Regras de permissões, Carrinho, Seleção de Loja, Error Boundary.
2. **Checagem de Tipos (TypeScript):**
   - **Resultado:** Nao foram encontrados erros de tipagem ao compilar os arquivos da aplicação.
3. **Linter (ESLint):**
   - **Resultado:** 0 erros, 27 avisos (limite configurado: max 50).

---

## 5. RECOMENDAÇÕES E PRÓXIMOS PASSOS

1. **Planejamento de Sprint para Ajustes P0 (Críticos e Altos):**
   - Criar migration para adicionar `store_id` na tabela `suppliers` e aplicar RLS.
   - Atualizar `ProductsService`, `CustomersService` e `FinanceService` garantindo isolamento por `store_id` em todas as mutações no frontend.
2. **Refatoração Visual e Performance de Hooks:**
   - Envolver `handleConfirmSale` em `useCallback` e corrigir dependências do `useEffect` no PDV e Dashboard.
3. **Limpeza de Código:**
   - Resolver os 27 avisos do ESLint e mover os hooks dos contextos para a pasta `src/hooks/`.

---
*Relatório gerado automaticamente pela rotina de auditoria técnica CoreSys.*
