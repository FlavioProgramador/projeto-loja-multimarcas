# 📊 RELATÓRIO DE AUDITORIA TÉCNICA DIÁRIA - CORESYS
**Data:** 03 de outubro de 2026
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Status:** Concluído
**Responsável:** Engenharia de Software Sênior / Auditoria CoreSys

---

##  EXECUTIVE SUMMARY & CONTEXTO

Esta auditoria técnica diária analisou o estado atual do repositório, incluindo o código frontend (React/TypeScript/Vite), backend (Supabase Edge Functions), banco de dados PostgreSQL (migrations, RLS, RPCs SECURITY DEFINER), isolamento multi-tenant, validações de negócio e segurança de dados.

### Resumo dos Achados por Severidade

| Severidade | Quantidade | Descrição Principal |
|------------|------------|---------------------|
| 🔴 **CRÍTICO** | 3 | Vazamento de dados multi-tenant no Dashboard; Consultas sem `store_id` em serviços frontend (IDOR/BOLA); Erros de lint/runtime em Edge Functions. |
| 🟠 **ALTO** | 3 | Desativação global de produtos compartilhados entre lojas; CTEs triplicadas e não otimizadas em RPCs de paginação; Dependências ausentes em `useEffect` nos componentes principais. |
| 🟡 **MÉDIO** | 3 | Inconsistência na validação e limitação de desconto no PDV; Exportação indevida de utilitários nos arquivos de Contexto React; Código morto e imports não utilizados. |
| 🟢 **BAIXO** | 1 | Alerta de tamanho de bundle do Vite no build de produção. |

---

## 1. PROBLEMAS CRÍTICOS (CRÍTICO)

### C-01: Vazamento de Dados Multi-Tenant no Dashboard (`DashboardService.getMetrics()`)
- **Severidade:** 🔴 CRÍTICO
- **Explicação:** O método `DashboardService.getMetrics()` executa consultas às tabelas `sales` e `product_variants` sem receber ou filtrar pelo `store_id` da loja ativa. Como resultado, qualquer usuário autenticado ao acessar a página inicial do Dashboard visualiza indicadores consolidados (Faturamento do Mês, Vendas de Hoje, Ticket Médio, Alertas de Estoque Baixo e Vendas Recentes) de **todas as lojas** cadastradas no banco de dados. Isso quebra completamente o isolamento multi-tenant do ERP e expõe dados financeiros confidenciais entre clientes/lojas distintas.
- **Afetados:**
  - Arquivos: `src/services/dashboard.service.ts`, `src/components/dashboard/DashboardView.tsx`
  - Tabelas: `public.sales`, `public.product_variants`, `public.store_inventory`
- **Sugestão de Correção:**
  1. Alterar a assinatura para `DashboardService.getMetrics(storeId: string)`.
  2. Adicionar o filtro `.eq('store_id', storeId)` na busca da tabela `sales`.
  3. Consultar a contagem de estoque baixo unindo com `store_inventory` filtrado por `store_id = storeId`.
  4. Atualizar o `DashboardView.tsx` para passar o `activeStoreId` obtido via `useStore()`.

---

### C-02: Falta de Filtro Multi-Tenant (`store_id`) em Operações de Serviços e Risco de IDOR/BOLA
- **Severidade:** 🔴 CRÍTICO
- **Explicação:** Diversos métodos em serviços do frontend executam consultas diretas de leitura, atualização ou exclusão omitindo a restrição de `store_id`:
  1. `SuppliersService.getAll()` busca fornecedores na tabela `suppliers` sem associar ou filtrar por `store_id` (a tabela `suppliers` no schema atual não possui coluna `store_id`, tornando o cadastro de fornecedores global e compartilhado inadvertidamente por todas as lojas).
  2. `CustomersService.update(uuid)` e `CustomersService.remove(uuid)` executam `.from('customers').update(...).eq('id', uuid)` sem incluir `.eq('store_id', storeId)`.
  3. `FinanceService.toggleExpensePaid(uuid)` executa `.from('fixed_expenses').update(...).eq('id', uuid)` sem limitar por `store_id`.
  Caso ocorram falhas nas políticas RLS do Supabase ou tentativas de manipulação direta de parâmetros (IDOR/BOLA), requisições maliciosas enviando UUIDs de outros tenants conseguiriam alterar dados de outras lojas.
- **Afetados:**
  - Arquivos: `src/services/suppliers.service.ts`, `src/services/customers.service.ts`, `src/services/finance.service.ts`
  - Tabelas: `public.suppliers`, `public.customers`, `public.fixed_expenses`
- **Sugestão de Correção:**
  1. Adicionar a coluna `store_id UUID REFERENCES stores(id)` na tabela `suppliers` através de migration, ajustando RLS.
  2. Atualizar todos os métodos de mutação e consulta nos serviços para exigir o parâmetro `storeId` e incluir obrigatoriamente `.eq('store_id', storeId)` em todas as queries Supabase.

---

### C-03: Erros de Linter e Falhas de Execução nas Edge Functions (`supabase/functions`)
- **Severidade:** 🔴 CRÍTICO
- **Explicação:** A verificação estática do ESLint detectou erros em funções Supabase Edge Deno:
  1. `supabase/functions/create-mp-pix/index.ts`: Variável `origin` declarada mas não utilizada e uso não seguro de `any`.
  2. `supabase/functions/mp-webhook/index.ts`: Bloco `catch` vazio (`catch (_) {}`) e variável não utilizada.
  Tratamento de exceções com blocos `catch` vazios pode silenciar erros críticos durante a recepção de webhooks do Mercado Pago, impedindo a reconciliação e aprovação automática de vendas PIX.
- **Afetados:**
  - Arquivos: `supabase/functions/create-mp-pix/index.ts`, `supabase/functions/mp-webhook/index.ts`
- **Sugestão de Correção:**
  1. Remover variáveis não utilizadas.
  2. Substituir o bloco `catch` vazio em `mp-webhook` por tratamento estruturado com log de erro ou re-throw apropriado.
  3. Definir tipos TypeScript explícitos substituindo `any`.

---

## 2. PROBLEMAS DE ALTA SEVERIDADE (ALTO)

### A-01: Desativação Global de Produtos Compartilhados (`ProductsService.remove`)
- **Severidade:** 🟠 ALTO
- **Explicação:** Ao excluir um produto pela interface através do método `ProductsService.remove(uuid)`, o serviço envia um comando `.from('products').update({ is_active: false }).eq('id', uuid)`. Na arquitetura do CoreSys, a tabela `products` atua como catálogo centralizado de produtos e variações, enquanto os estoques são individualizados por loja na tabela `store_inventory`. Ao definir `is_active = false` na tabela `products`, o produto é desativado para **todas as lojas do sistema**, e não apenas para a loja atual do usuário.
- **Afetados:**
  - Arquivo: `src/services/products.service.ts`
  - Tabela: `public.products`
- **Sugestão de Correção:**
  1. Ajustar a remoção de produtos para desativar a disponibilidade/estoque da variação na loja específica em `store_inventory` (ou utilizar uma relação de associação produto-loja `store_products`).
  2. Reservar a desativação global em `products` exclusivamente para Administradores Globais do sistema.

---

### A-02: Ineficiência e Duplicação de CTEs na RPC de Paginação do Servidor
- **Severidade:** 🟠 ALTO
- **Explicação:** A função SQL `get_customer_directory_page` (criada na migration `20261002234838_server_pagination_phase25c.sql`) duplica inteiramente blocos pesados de CTE (`sales_agg`, `credit_agg`, `base`, `filtered`) **3 vezes consecutivas** dentro da mesma execução para calcular separadamente o total de registros (`v_total`), os registros da página (`v_rows`) e as estatísticas consolidadas (`v_stats`). Em bancos de dados com grande volume de vendas e movimentações de crédito, isso gera carga excessiva de CPU e E/S no PostgreSQL.
- **Afetados:**
  - Arquivo: `supabase/migrations/20261002234838_server_pagination_phase25c.sql`
  - Função PostgreSQL: `public.get_customer_directory_page(uuid, text, text, text, integer, integer)`
- **Sugestão de Correção:**
  1. Refatorar a função PL/pgSQL para executar a agregação inicial uma única vez em tabelas temporárias ou utilizar window functions (`count(*) OVER()`) para obter o total de registros juntamente com os dados da página.

---

### A-03: Avisos de Dependências Ausentes em Hooks `useEffect` em Componentes Críticos
- **Severidade:** 🟠 ALTO
- **Explicação:** O ESLint apontou dependências ausentes em hooks `useEffect` em componentes vitais da aplicação:
  1. `src/components/pdv/PdvView.tsx`: A função `handleConfirmSale` é reconstruída a cada renderização e gera instabilidade nas dependências do `useEffect` de atalhos de teclado (linha 235).
  2. `src/components/dashboard/RevenueChart.tsx` e `TopProductsChart.tsx`: Dependências `data` e `labels` omitidas do `useEffect`.
  3. `src/components/finance/FinanceView.tsx` e `MovementsView.tsx`: Funções de recarga omitidas do array de dependências.
  Isso pode causar bugs funcionais como chamadas repetidas e desnecessárias à API, closures obsoletas (stale closures) com estados desatualizados ou loops infinitos de re-renderização.
- **Afetados:**
  - Arquivos: `src/components/pdv/PdvView.tsx`, `src/components/dashboard/RevenueChart.tsx`, `src/components/dashboard/TopProductsChart.tsx`, `src/components/finance/FinanceView.tsx`, `src/components/movements/MovementsView.tsx`
- **Sugestão de Correção:**
  1. Envolver funções manipuladoras e de busca de dados em `useCallback`.
  2. Declarar explicitamente todas as dependências exigidas nos arrays de dependência dos hooks `useEffect`.

---

## 3. PROBLEMAS DE MÉDIA SEVERIDADE (MÉDIO)

### M-01: Inconsistência na Validação e Limitação de Descontos no PDV
- **Severidade:** 🟡 MÉDIO
- **Explicação:** No componente `PdvView.tsx`, o usuário pode digitar valores livres nos campos de desconto R$ (`discountValue`) e desconto % (`discountPercent`). O frontend não impede a digitação de porcentagens superiores a 100% nem de valores negativos. No backend, a RPC `create_mp_pix_sale` limita a porcentagem de desconto via `least(100, greatest(0, p_discount_percent))`, enquanto a RPC `complete_sale` utiliza `greatest(0, p_discount_percent)` sem limitar o teto em 100% (recorrendo apenas ao limite `least(v_subtotal, ...)`).
- **Afetados:**
  - Arquivos: `src/components/pdv/PdvView.tsx`, `supabase/migrations/20260930001617_fase3_finalize_sale_idempotency_scope.sql`
  - Funções PostgreSQL: `public.complete_sale`, `public.create_mp_pix_sale`
- **Sugestão de Correção:**
  1. Adicionar validação no frontend em `PdvView.tsx` para travar o desconto percentual no intervalo `0` a `100` e o desconto em valor no teto do subtotal do carrinho.
  2. Padronizar a RPC `complete_sale` para aplicar `least(100, greatest(0, p_discount_percent))` da mesma forma que `create_mp_pix_sale`.

---

### M-02: Exportação Indevida em Arquivos de Contexto React (Fast Refresh Warning)
- **Severidade:** 🟡 MÉDIO
- **Explicação:** Os arquivos `AuthContext.tsx`, `CartContext.tsx`, `StoreContext.tsx` e `ThemeContext.tsx` exportam funções utilitárias ou tipos além dos componentes/providers React. Isso dispara avisos do plugin `react-refresh/only-export-components`, o que invalida a recarga de módulos em tempo quente (Hot Module Replacement / Fast Refresh) durante o desenvolvimento e indica acoplamento de código.
- **Afetados:**
  - Arquivos: `src/contexts/AuthContext.tsx`, `src/contexts/CartContext.tsx`, `src/contexts/StoreContext.tsx`, `src/contexts/ThemeContext.tsx`
- **Sugestão de Correção:**
  1. Mover constantes, tipos e utilitários auxiliares para arquivos separados em `src/types/` ou `src/lib/`.

---

### M-03: Variáveis Não Utilizadas e Imports Mortos em Componentes de UI
- **Severidade:** 🟡 MÉDIO
- **Explicação:** Foram identificadas 27 warnings de linter referentes a ícones e utilitários importados que não são utilizados, bem como setters de estado não consumidos (ex.: `setSelectedColecao`, `setSelectedEstacao`, `setSelectedGenero` em `PdvView.tsx`, ícones `CreditCard`, `ChevronDown`, `Trash2`, `PlusCircle` em vários modais).
- **Afetados:**
  - Arquivos: `DashboardView.tsx`, `FinanceView.tsx`, `InventoryView.tsx`, `NewProductModal.tsx`, `StockEntryModal.tsx`, `NewReturnModal.tsx`, `SupplierForm.tsx`
- **Sugestão de Correção:**
  1. Limpar imports não utilizados e remover estados mortos para manter o código limpo e otimizado.

---

## 4. PROBLEMAS DE BAIXA SEVERIDADE (BAIXO)

### B-01: Alerta de Tamanho de Chunks do Vite no Build de Produção
- **Severidade:** 🟢 BAIXO
- **Explicação:** A execução do `npm run build` conclui com sucesso, mas gera alertas de tamanho de chunk acima de 500 kB após minificação:
  - `dist/assets/ReportsView-CWXUbRIP.js` (412.20 kB / 135.51 kB gzip)
  - `dist/assets/index-BeWIja4o.js` (526.82 kB / 150.86 kB gzip)
- **Afetados:**
  - Arquivos: `vite.config.ts`, `src/components/reports/ReportsView.tsx`
- **Sugestão de Correção:**
  1. Configurar `manualChunks` nas opções do Rollup em `vite.config.ts` para separar bibliotecas pesadas de gráficos e relatórios em chunks sob demanda (React / Chart.js / html2canvas).

---

## 🛡️ MATRIZ DE SEGURANÇA E ISOLAMENTO MULTI-TENANT

| Aspecto | Status Atual | Diagnóstico |
|---------|--------------|-------------|
| **Multi-Tenant (Isolamento de Loja)** | ⚠️ ATENÇÃO | Vaza no Dashboard (`getMetrics`) e em chamadas diretas de fornecedores/clientes/despesas sem `store_id`. |
| **RLS (Row Level Security)** | ✅ BOM | Hardening aplicado na maioria das tabelas principais com validação por `has_store_access(store_id)`. |
| **RPCs SECURITY DEFINER** | ✅ BOM | `search_path = public` fixado em todas as RPCs customizadas. Validação de autenticação e papéis ativa. |
| **Integridade de Vendas & PDV** | ✅ BOM | Transações atômicas com bloqueio de concorrência (`FOR UPDATE`) e controle de idempotência via `sale_idempotency`. |
| **Webhooks & PIX** | ✅ BOM | Assinatura HMAC-SHA256 e proteção contra replay ativas em `mp-webhook`. |

---

## 📋 CHECKLIST DE AÇÕES RECOMENDADAS PARA O PRÓXIMO SPRINT

1. [ ] **[CRÍTICO]** Corrigir `DashboardService.getMetrics` exigindo `storeId` e filtrando todas as queries por loja.
2. [ ] **[CRÍTICO]** Adicionar `store_id` à tabela e serviço de `suppliers` e estender `.eq('store_id', storeId)` para `customers` e `fixed_expenses`.
3. [ ] **[CRÍTICO]** Corrigir erros de linting TypeScript/Deno nas Edge Functions do Supabase (`create-mp-pix` e `mp-webhook`).
4. [ ] **[ALTO]** Escopar a desativação de produtos por loja em vez de desativar o produto globalmente em `ProductsService.remove`.
5. [ ] **[ALTO]** Otimizar a RPC `get_customer_directory_page` eliminando a triplicação de CTEs.
6. [ ] **[ALTO]** Corrigir dependências de `useEffect` no `PdvView.tsx` utilizando `useCallback`.
7. [ ] **[MÉDIO]** Normalizar e validar os limites de desconto no PDV (frontend e backend).

---

**Relatório gerado em:** 03/10/2026 14:05 UTC
**Auditor Responsável:** Jules / Engenharia Sênior CoreSys
