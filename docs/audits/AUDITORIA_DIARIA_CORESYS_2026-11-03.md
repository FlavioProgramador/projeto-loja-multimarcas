# Relatório de Auditoria Técnica Diária — CoreSys (VESTRA ERP/PDV)
**Data:** 03 de Novembro de 2026
**Responsável:** Engenheiro de Software Sênior (Auditoria Técnica Diária CoreSys)
**Repositório:** FlavioProgramador/projeto-loja-multimarcas

---

## 1. Resumo Executivo

Nesta auditoria técnica diária do ecossistema CoreSys, foi realizada uma avaliação minuciosa cobrindo o repositório frontend (React 18, TypeScript, Vite), a camada de serviços e hooks, as Edge Functions Deno e o backend Supabase (PostgreSQL com Row Level Security e RPCs `SECURITY DEFINER`).

### Status dos Quality Gates:
- **TypeScript Typecheck (`npm run typecheck`):** ✅ **APROVADO** (0 erros encontrados).
- **Testes Unitários (`npm test`):** ✅ **APROVADO** (11 arquivos de teste e 39 asserções aprovadas com Vitest).
- **Build de Produção (`npm run build`):** ✅ **APROVADO** (bundle gerado com sucesso via Vite/Rollup).
- **Linter (`npm run lint`):** ⚠️ **ALERTA CONTROLADO** (0 erros, 26 warnings de hooks e variáveis não utilizadas — dentro do teto de tolerância <= 50).
- **Segurança de Dependências (`npm audit`):** ✅ **APROVADO (0 vulnerabilidades no gate `security:dependencies`)**. As dependências vulneráveis foram alinhadas e protegidas via overrides/resoluções seguras (`dompurify >= 3.4.17`, `minimatch >= 11.0.1`, `undici`, `vite`, `zod`).

---

## 2. Achados de Auditoria Classificados por Severidade

---

### [ALTO] DATA-01: Inconsistência de Desativação de Reserva de Estoque em `cancel_mp_pix_sale`
- **Severidade:** **ALTO**
- **Categoria:** Integridade de Dados / Gestão Concorrente de Estoque Multi-Loja
- **Arquivos/Tabelas/Funções Afetados:**
  - Migração: `supabase/migrations/20260828000003_multi_store.sql` (linhas 930–980)
  - Função RPC: `public.cancel_mp_pix_sale(uuid)`
  - Tabelas: `public.store_inventory`, `public.product_variants`
- **Descrição do Problema:**
  Quando uma cobrança PIX é criada via `create_mp_pix_sale`, o estoque físico da loja (`store_inventory.quantity`) é decrementado e o campo `product_variants.reserved_quantity` é incrementado para bloquear a reserva (`reserved_quantity = reserved_quantity + v_item.quantity`).
  No entanto, na rotina de cancelamento `cancel_mp_pix_sale` (invocada pelo webhook do Mercado Pago quando o PIX expira ou é cancelado, bem como pelo reconciliation worker):
  - A função devolve a quantidade para `store_inventory.quantity` (`UPDATE store_inventory SET quantity = quantity + v_item.quantity`).
  - **Porém, a função NÃO decrementa `product_variants.reserved_quantity`**, e não recalcula `reserved_quantity = reserved_quantity - v_item.quantity`.
  Isso gera **reserva fantasma perpétua** no catálogo de variantes, distorcendo relatórios de disponibilidade de estoque e a visualização no PDV.
- **Sugestão de Correção:**
  Atualizar a RPC `cancel_mp_pix_sale` para decrementar atomicamente `product_variants.reserved_quantity = GREATEST(0, COALESCE(reserved_quantity, 0) - v_item.quantity)` e sincronizar `product_variants.stock_quantity` com a soma do estoque das lojas ativas.

---

### [ALTO] SEC-01: Bypass de RPC e Inserção Direta Sem Isolamento no `InventoryService.registerStockEntry`
- **Severidade:** **ALTO**
- **Categoria:** Isolamento Multi-Tenant / Violação de RBAC / Integridade Referencial
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivo: `src/services/inventory.service.ts` (linhas 110–145)
  - Tabelas: `public.products`, `public.product_variants`, `public.brands`, `public.categories`
  - Função RPC associada: `public.manage_product`
- **Descrição do Problema:**
  No fluxo de recebimento e entrada de estoque manual, quando o usuário seleciona ou digita um produto inexistente, o `InventoryService` efetua inserções diretas nas tabelas `categories`, `brands`, `products` e `product_variants` via client Supabase:
  ```typescript
  const { data: newProd, error: prodErr } = await supabase
    .from('products')
    .insert({ name: params.productName.trim(), brand_id: brandId, category_id: categoryId, sale_price: Math.max(0, Number(params.price) || 0), cost_price: custoUnitario, is_active: true })
    .select()
    .single();
  ```
  1. A tabela `products` teve o campo `cost_price` revogado para `authenticated` na migração `20260930010321_phase3_finalize_tenant_customers_and_cost_privileges.sql`, sendo delegado para `product_costs` ou para a RPC segura `manage_product`. Tentar selecionar e gravar diretamente esse campo gera risco de falha ou desvio das regras centralizadas.
  2. A criação de catálogo não passa pelas checagens fail-closed de permissão de loja (`ADMIN` / `MANAGER`) providas pela RPC `manage_product`.
  3. Não há transacionalidade: se a inserção da variante ou da entrada de estoque falhar após a criação do produto, ficam gerados registros órfãos sem estoque no catálogo.
- **Sugestão de Correção:**
  Refatorar `InventoryService.registerStockEntry` para criar novos produtos exclusivamente por meio da RPC `manage_product` (ou via `ProductsService.create`), garantindo consistência transacional e autorização RBAC adequada.

---

### [MÉDIO] SEC-02: Possível IDOR em `FinanceService.toggleExpensePaid` Sem Validação Explícita de `store_id`
- **Severidade:** **MÉDIO**
- **Categoria:** Controle de Acesso / Risco de BOLA/IDOR
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivo: `src/services/finance.service.ts` (linhas 275–285)
  - Tabela: `public.fixed_expenses`
- **Descrição do Problema:**
  O método `toggleExpensePaid(uuid: string, currentPaidState: boolean)` executa um update diretamente por ID:
  ```typescript
  const { data, error } = await supabase.from('fixed_expenses')
    .update({ paid: !currentPaidState })
    .eq('id', uuid)
    .select(...)
    .single();
  ```
  Embora a tabela `fixed_expenses` possua política RLS (`Fixed expenses manageable by store roles`), o método no frontend não passa o `storeId` da loja ativa no `.eq('store_id', storeId)`. Caso um usuário possua acesso de `MANAGER` em duas lojas diferentes (Loja A e Loja B) e o cliente envie um UUID pertencente à Loja B estando conectado na Loja A, a operação terá sucesso silencioso no banco, desrespeitando o contexto visual da loja ativa.
- **Sugestão de Correção:**
  Exigir `storeId` na assinatura de `toggleExpensePaid(storeId: string, uuid: string, currentPaidState: boolean)` e adicionar o filtro `.eq('store_id', storeId)` na query de update.

---

### [MÉDIO] SEC-03: Modificação Direta de `suppliers` e `customers` via Client Sem RPC Transacional
- **Severidade:** **MÉDIO**
- **Categoria:** Integridade de Dados / Defesa em Profundidade
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivos: `src/services/suppliers.service.ts` (linhas 60–85), `src/services/customers.service.ts` (linhas 480–510)
  - Tabelas: `public.suppliers`, `public.customers`
- **Descrição do Problema:**
  As operações de `update` e `remove` (soft delete) em clientes e fornecedores são executadas via chamadas diretas `supabase.from('...').update(...).eq('id', uuid)`:
  - Em `suppliers`, a tabela não possui coluna `store_id` (é compartilhada globalmente entre todas as lojas do tenant/instância), permitindo que um gerente de qualquer loja altere ou inative fornecedores utilizados por outras lojas.
  - Em `customers`, a mutação direta não valida o `store_id` na query `.eq('id', uuid)`, dependendo unicamente da política RLS.
- **Sugestão de Correção:**
  1. Para `customers`, adicionar `.eq('store_id', storeId)` em todas as mutações diretas ou migrar para uma RPC dedicada `manage_customer`.
  2. Para `suppliers`, avaliar se o catálogo de fornecedores deve permanecer multi-tenant global (apenas administradores globais autorizados a alterar) ou ser associado por loja com `store_id`.

---

### [MÉDIO] CODE-01: Warnings de React Hooks (`exhaustive-deps`) em Telas de Venda e Financeiro
- **Severidade:** **MÉDIO**
- **Categoria:** Resiliência de Frontend / Estabilidade de Renderização
- **Arquivos Afetados:**
  - `src/components/pdv/PdvView.tsx` (linha 235: `handleConfirmSale` recriada em cada ciclo de render)
  - `src/components/finance/FinanceView.tsx` (linhas 84, 86: `loadTransactions` e `loadExpenses`)
  - `src/components/movements/MovementsView.tsx` (linha 81: `loadMovements`)
  - `src/components/dashboard/RevenueChart.tsx` (linha 106)
  - `src/components/dashboard/TopProductsChart.tsx` (linha 98)
- **Descrição do Problema:**
  O ESLint acusa warnings críticos de dependências de hooks:
  No PDV (`PdvView.tsx`), `handleConfirmSale` é instanciada sem `useCallback`, provocando re-execução de effects a cada render. Em situações de pico no caixa com leituras consecutivas de código de barras ou duplo clique no botão de confirmação, há risco de execução concorrente ou uso de referências de carrinho obsoletas.
- **Sugestão de Correção:**
  Envolver `handleConfirmSale` em `useCallback` com controle de estado de loading/submissão (`isSubmitting`) já existente e incluir referências estáveis nos `useEffect` de carregamento.

---

### [BAIXO] LINT-01: 26 Avisos de Variáveis e Imports Não Utilizados
- **Severidade:** **BAIXO**
- **Categoria:** Manutenibilidade e Limpeza de Código
- **Arquivos Afetados:**
  - `src/components/dashboard/DashboardView.tsx` (`CreditCard`, `formatPaymentMethod`)
  - `src/components/inventory/InventoryView.tsx` (`ChevronDown`, `Trash2`, `StockStatus`)
  - `src/components/inventory/NewProductModal.tsx` (`PlusCircle`)
  - `src/components/inventory/StockEntryModal.tsx` (`ArrowUp`)
  - `src/components/returns/NewReturnModal.tsx` (`AlertCircle`, `User`, `CreditCard`, `setCustomReason`)
  - `src/components/suppliers/SupplierForm.tsx` (`formatPhone`)
  - Contextos (`AuthContext.tsx`, `CartContext.tsx`, `StoreContext.tsx`, `ThemeContext.tsx`): aviso de Fast Refresh do Vite devido à exportação simultânea de componentes e funções utilitárias.
- **Descrição do Problema:**
  A presença de código morto e variáveis não utilizadas polui a saída de build e prejudica a otimização de árvore (tree-shaking) e o Fast Refresh do Vite em desenvolvimento.
- **Sugestão de Correção:**
  Remover imports não utilizados, prefixar variáveis propositalmente mantidas com `_` e segregar utilitários dos arquivos de componentes/contextos.

---

## 3. Auditoria de Multi-Tenancy e Supabase RLS

1. **Garantia de Isolamento de Dados por Loja:**
   - Tabelas transacionais essenciais (`sales`, `sale_items`, `inventory_movements`, `store_inventory`, `financial_transactions`, `fixed_expenses`, `customers`) estão associadas à coluna `store_id` com constraints e índices adequados.
   - Políticas RLS ativas em todas as tabelas multi-tenant garantem que apenas usuários com registro ativo em `user_store_access` para a respectiva loja consigam realizar `SELECT`, `INSERT` ou `UPDATE`.
2. **Funções `SECURITY DEFINER` e Search Path:**
   - A migração recente `20261003000000_coresys_audit_final_remediation.sql` aplicou `SET search_path = public` e bloqueou execução para usuários não autenticados (`REVOKE ALL FROM PUBLIC, anon`) nas rotinas centrais: `complete_sale`, `create_mp_pix_sale` e `cancel_sale`.
   - As permissões para funções administrativas do Mercado Pago (`approve_mp_pix_sale`, `cancel_mp_pix_sale`) estão estritamente restritas à role `service_role`.
3. **Idempotência e Concorrência:**
   - O mecanismo de idempotência em `sale_idempotency` opera com trava exclusiva via `pg_advisory_xact_lock` no escopo da loja e usuário, prevenindo geração de pedidos duplicados em caso de instabilidade de rede no caixa.

---

## 4. Recomendações e Próximos Passos Priorizados

1. **P0 (Integridade de Estoque e Isolamento):**
   - Corrigir a RPC `cancel_mp_pix_sale` para decrementar `product_variants.reserved_quantity` e evitar reservas fantasmas após o cancelamento/expiração de PIX.
   - Refatorar `InventoryService.registerStockEntry` para remover inserções diretas em `products` e `product_variants`, adotando a RPC `manage_product`.
   - Adicionar o filtro `.eq('store_id', storeId)` em `FinanceService.toggleExpensePaid` para mitigar o risco de BOLA/IDOR entre lojas do mesmo usuário.
2. **P1 (Qualidade de Código e UX):**
   - Envolver `handleConfirmSale` em `useCallback` no `PdvView.tsx`.
   - Limpar os 26 warnings do ESLint para garantir 0 warnings no projeto.

---
*Relatório emitido pela Auditoria Técnica Diária CoreSys em 03/11/2026.*
