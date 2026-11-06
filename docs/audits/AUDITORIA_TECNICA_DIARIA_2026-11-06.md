# Relatório de Auditoria Técnica Diária — CoreSys (PDV & ERP VESTRA)
**Data:** 06/11/2026
**Responsável:** Engenheiro de Software Sênior (Auditoria Técnica CoreSys)
**Repositório:** FlavioProgramador/projeto-loja-multimarcas
**Branch:** main / auditoria-tecnica-diaria-2026-11-06
**Ambiente Conectado:** Supabase PostgreSQL (`ndrjynlbwrugakjqtzwy`)

---

## 1. Resumo Executivo e Status Geral do Sistema

A auditoria técnica diária do CoreSys foi realizada com foco em segurança da informação, isolamento rigoroso multi-tenant, controle de acesso baseado em papéis (RBAC), integridade transacional de estoque e conformidade das rotinas `SECURITY DEFINER` e políticas de Row Level Security (RLS).

### Status dos Quality Gates:
- **TypeScript Typecheck (`tsc --noEmit`):** ✅ **PASSOU** (0 erros de tipagem).
- **Testes Unitários e de Integração (`vitest run`):** ✅ **PASSOU** (11 arquivos de teste, 39 testes executados com sucesso).
- **Build de Produção (`vite build`):** ✅ **PASSOU** (compilação gerada sem erros em ~7.5s).
- **Linter (`eslint`):** ⚠️ **ALERTA** (26 warnings ativos; limite configurado em CI: 50 warnings).
- **Dependências e Segurança (`npm audit`):** ⚠️ **VULNERABILIDADES CONHECIDAS** (19 vulnerabilidades no ecossistema npm: 14 moderadas, 4 altas, 1 crítica em pacotes como `dompurify`, `vite`, `zod`, `minimatch`, `body-parser`).

---

## 2. Matriz Consolidada de Achados

| ID | Classificação | Categoria | Escopo / Arquivo / Tabela / Função | Resumo do Achado |
|---|---|---|---|---|
| **BUG-01** | 🔴 **CRÍTICO** | Integridade de Estoque | `public.cancel_mp_pix_sale` / `product_variants` | Falha ao desfazimento de reserva de estoque no cancelamento/expiração de PIX gerando reservas fantasmas perpétuas. |
| **SEC-01** | 🔴 **CRÍTICO** | RLS / Isolamento Multi-tenant | `financial_transactions`, `customers` | Políticas RLS residuais permissivas (`USING (true)`) no banco permitindo leitura cruzada entre lojas distintas. |
| **SEC-02** | 🔴 **CRÍTICO** | Multi-tenant / Vazamento de Dados | `src/services/dashboard.service.ts` / `sales` | Consulta analítica global no client sem filtrar `store_id`, consolidando dados entre filiais em caso de acesso multi-loja. |
| **SEC-03** | 🟠 **ALTO** | Integridade / RBAC / Bypass de RPC | `src/services/inventory.service.ts` / `products` | Inserção direta no client sem RPC transacional gravando coluna restrita `cost_price` sem validação fail-closed. |
| **SEC-04** | 🟠 **ALTO** | Multi-Tenancy / Falta de Segregação | `suppliers`, `brands`, `categories` | Entidades cadastrais sem coluna `store_id`, permitindo manipulação cruzada por operadores de qualquer loja. |
| **SEC-05** | 🟠 **ALTO** | Segurança de Triggers | `handle_updated_at`, `protect_profile_role` | Triggers legados marcados com `SECURITY DEFINER` sem fixar `SET search_path = public`. |
| **SEC-06** | 🟠 **ALTO** | Dependências de Terceiros | `package.json` (`dompurify`, `vite`, `zod`) | 19 vulnerabilidades reportadas pelo `npm audit` (incluindo 1 crítica e 4 altas). |
| **SEC-07** | 🟡 **MÉDIO** | BOLA / IDOR no Frontend | `src/services/finance.service.ts` (`toggleExpensePaid`) | Mutação em `fixed_expenses` sem passar `store_id` no filtro `.eq()`, dependendo exclusivamente da sessão. |
| **PERF-01**| 🟡 **MÉDIO** | Desempenho do Banco de Dados | FKs sem índices em `physical_inventories`, `returns` | Chaves estrangeiras sem índices correspondentes provocando table scans e contenção de locks em cascata. |
| **ARCH-01**| 🟡 **MÉDIO** | Performance e Arquitetura Frontend | `src/components/dashboard/DashboardView.tsx` | Agregações analíticas pesadas (Curva ABC, ticket médio) executadas em memória no client JS em vez do banco. |
| **CODE-01**| 🟡 **MÉDIO** | Estabilidade de Renderização | `src/components/pdv/PdvView.tsx` (`handleConfirmSale`) | Ausência de `useCallback` gerando recriação contínua de handlers e risco de reentrância em cliques rápidos. |
| **UX-01**  | 🟢 **BAIXO** | Experiência de Uso / Telemetria | `DashboardView.tsx`, `MovementsView.tsx` | Falta de loading skeletons unificados e feedback visual padronizado em falhas de conexão. |
| **LINT-01**| 🟢 **BAIXO** | Limpeza de Código | Componentes e Contextos (26 warnings) | Variáveis e imports não utilizados poluindo o bundle e avisos de Fast Refresh do Vite. |

---

## 3. Detalhamento dos Problemas e Sugestões de Correção

### 🔴 BUG-01: Reserva Fantasma Perpétua no Cancelamento de PIX (`cancel_mp_pix_sale`)
- **Severidade:** 🔴 **CRÍTICO**
- **Categoria:** Integridade de Dados / Estoque Transacional
- **Arquivos/Funções Afetadas:**
  - Função RPC: `public.cancel_mp_pix_sale(uuid)`
  - Tabelas: `public.sales`, `public.sale_items`, `public.store_inventory`, `public.product_variants`
  - Arquivos de origem: `supabase/migrations/20260828000003_multi_store.sql` (linhas 893–1015)
- **Explicação Técnica:**
  Quando uma venda PIX é iniciada no PDV através da RPC `create_mp_pix_sale`, o sistema reserva o estoque da seguinte forma:
  1. Decrementa o estoque da loja em `store_inventory.quantity = quantity - v_item.quantity`.
  2. Incrementa `product_variants.reserved_quantity = COALESCE(reserved_quantity, 0) + v_item.quantity`.

  Porém, na RPC `cancel_mp_pix_sale` (executada pelo webhook do Mercado Pago ou pelo worker de reconciliação quando o pagamento expira ou é cancelado):
  - O saldo é devolvido para `store_inventory.quantity`.
  - **A coluna `product_variants.reserved_quantity` NÃO é decrementada**, e o `stock_quantity` agregado não é recalculado.

  *Impacto:* A variante acumula reservas fictícias para sempre (`reserved_quantity`), bloqueando novas vendas no catálogo e distorcendo a disponibilidade real no PDV.
- **Sugestão de Correção:**
  Atualizar a RPC `cancel_mp_pix_sale` para decrementar atomicamente a reserva e sincronizar os totais da variante:
  ```sql
  -- Dentro do loop de itens em public.cancel_mp_pix_sale:
  UPDATE public.product_variants pv
  SET reserved_quantity = GREATEST(0, COALESCE(pv.reserved_quantity, 0) - v_item.quantity),
      stock_quantity = (
        SELECT COALESCE(SUM(si.quantity), 0)
        FROM public.store_inventory si
        WHERE si.product_variant_id = pv.id
      )
  WHERE pv.id = v_item.product_variant_id;
  ```

---

### 🔴 SEC-01: Políticas RLS Permissivas Residuais em `financial_transactions` e `customers`
- **Severidade:** 🔴 **CRÍTICO**
- **Categoria:** Isolamento Multi-tenant / Quebra de RLS
- **Tabelas Afetadas:** `public.financial_transactions`, `public.customers`
- **Arquivos:** `supabase/migrations/20260101000000_setup.sql`, `supabase/migrations/20260828000001_hardening_rls.sql`
- **Explicação Técnica:**
  No PostgreSQL, múltiplas políticas RLS permissivas para o mesmo comando (`SELECT`, `UPDATE`) são resolvidas através do operador lógico booleano **`OR`**.
  - Em `financial_transactions`, a política inicial criada no setup `"Finance viewable by authenticated"` com expressão `USING (true)` não foi descartada por migrações de hardening subsequentes. Mesmo existindo a política de loja `"Finance viewable by store access"`, a regra permissiva residual avalia como verdadeira para qualquer usuário com token autenticado, possibilitando a leitura de transações financeiras de outras empresas na mesma base.
  - Em `customers`, a política legada `"Customers viewable by authenticated"` (`USING (true)`) permaneceu em ambientes em que não houve purge explícito de políticas.
- **Sugestão de Correção:**
  Aplicar migration de saneamento com descarte explícito:
  ```sql
  BEGIN;
  DROP POLICY IF EXISTS "Finance viewable by authenticated" ON public.financial_transactions;
  DROP POLICY IF EXISTS "Customers viewable by authenticated" ON public.customers;
  DROP POLICY IF EXISTS "Customers updatable by authenticated" ON public.customers;
  DROP POLICY IF EXISTS "Customers deletable by authenticated" ON public.customers;
  DROP POLICY IF EXISTS "Customers manageable by authenticated" ON public.customers;
  COMMIT;
  ```

---

### 🔴 SEC-02: Vazamento de Dados Multi-tenant em `DashboardService.getMetrics`
- **Severidade:** 🔴 **CRÍTICO**
- **Categoria:** Multi-Tenancy / BOLA
- **Arquivos/Tabelas Afetadas:**
  - Arquivo: `src/services/dashboard.service.ts` (linhas 15–70)
  - Tabelas: `public.sales`, `public.product_variants`
- **Explicação Técnica:**
  O método `DashboardService.getMetrics()` não recebe o identificador da loja (`storeId`):
  ```typescript
  const { data: sales, error: salesError } = await supabase
    .from('sales')
    .select('id, sale_number, total, created_at, customer_name, payments(method, installments), sale_items(product_name, quantity)')
    .eq('status', 'COMPLETED')
    .order('created_at', { ascending: false });
  ```
  Se um usuário possuir vínculo ou permissão em múltiplas filiais (ou no caso de falha de RLS), o serviço consolida indiscriminadamente vendas de todas as lojas no dashboard. Além disso, busca variantes em baixo estoque consultando globalmente `product_variants` com `lte('stock_quantity', 2)`, ignorando o estoque específico da loja ativa (`store_inventory`).
- **Sugestão de Correção:**
  1. Alterar a assinatura para `getMetrics(storeId: string)`.
  2. Adicionar `.eq('store_id', storeId)` na consulta da tabela `sales`.
  3. Consultar o estoque por loja via `store_inventory` ou migrar a chamada para a RPC consolidada `report_commercial_summary(p_store_id)` já existente no banco.

---

### 🟠 SEC-03: Inserção Direta e Violação de Privilégios em `InventoryService.registerStockEntry`
- **Severidade:** 🟠 **ALTO**
- **Categoria:** Integridade de Dados / RBAC / Privilégios de Colunas
- **Arquivos/Tabelas Afetadas:**
  - Arquivo: `src/services/inventory.service.ts` (linhas 120–150)
  - Tabelas: `public.products`, `public.product_variants`
- **Explicação Técnica:**
  Ao dar entrada de estoque de um produto novo, o serviço faz inserções diretas sem transação pelo client:
  ```typescript
  const { data: newProd, error: prodErr } = await supabase
    .from('products')
    .insert({ name: params.productName.trim(), brand_id: brandId, category_id: categoryId, sale_price: Math.max(0, Number(params.price) || 0), cost_price: custoUnitario, is_active: true })
    .select()
    .single();
  ```
  - A migração `20260930010321_phase3_finalize_tenant_customers_and_cost_privileges.sql` revogou o privilégio de escrita/leitura direta da coluna `cost_price` para a role `authenticated`, exigindo o uso da RPC `manage_product`.
  - Essa inserção direta falha em ambientes com hardening restrito ou contorna a auditoria e as regras de autorização de loja.
  - Caso a criação da variante falhe na linha subsequente, o produto pai fica gravado órfão no catálogo.
- **Sugestão de Correção:**
  Substituir as chamadas diretas por `supabase.rpc('manage_product', ...)` ou integrar com `ProductsService.create`.

---

### 🟠 SEC-04: Ausência de Segregação de Lojas em `suppliers`, `brands` e `categories`
- **Severidade:** 🟠 **ALTO**
- **Categoria:** Arquitetura Multi-Tenant / Confidencialidade
- **Tabelas Afetadas:** `public.suppliers`, `public.brands`, `public.categories`
- **Arquivos:** `src/services/suppliers.service.ts`, `src/services/brands.service.ts`, `src/services/categories.service.ts`
- **Explicação Técnica:**
  As tabelas de cadastro de fornecedores, marcas e categorias não possuem a coluna `store_id`. Em um ambiente multi-empresa compartilhado, operadores e gerentes de uma loja conseguem visualizar, renomear ou deletar fornecedores estratégicos e categorias de outras redes de lojas.
- **Sugestão de Correção:**
  1. Adicionar `store_id UUID REFERENCES public.stores(id)` nessas tabelas ou implementar um campo `is_global boolean DEFAULT false`.
  2. Atualizar as políticas RLS para garantir que cada loja acesse apenas seus registros (ou itens globais padrão do sistema).

---

### 🟠 SEC-05: Triggers `SECURITY DEFINER` Legados sem `SET search_path`
- **Severidade:** 🟠 **ALTO**
- **Categoria:** Segurança PostgreSQL / Search Path Hijacking
- **Funções Afetadas:** `public.handle_updated_at()`, `public.prevent_inventory_movement_delete()`, `public.protect_profile_role()`
- **Explicação Técnica:**
  Funções marcadas com `SECURITY DEFINER` executam com os privilégios do proprietário da função (`postgres` / `supabase_admin`). Quando criadas sem fixar explicitamente o caminho de busca (`SET search_path = public`), abrem brecha para ataques de substituição de objetos via schemas temporários ou mutáveis.
- **Sugestão de Correção:**
  Executar:
  ```sql
  ALTER FUNCTION public.handle_updated_at() SET search_path = public;
  ALTER FUNCTION public.prevent_inventory_movement_delete() SET search_path = public;
  ALTER FUNCTION public.protect_profile_role() SET search_path = public;
  ```

---

### 🟠 SEC-06: Vulnerabilidades Conhecidas em Dependências do Frontend
- **Severidade:** 🟠 **ALTO**
- **Categoria:** Segurança de Cadeia de Suprimentos (Supply Chain)
- **Arquivos Afetados:** `package.json`, `package-lock.json`
- **Explicação Técnica:**
  A execução do script `npm run security:dependencies` (`npm audit --audit-level=moderate`) acusa 19 vulnerabilidades no total (1 crítica no `dompurify`, 4 altas no `vite`, `zod`, `body-parser`, `undici`).
- **Sugestão de Correção:**
  Atualizar versões seguras no `package.json` e aplicar `overrides` para neutralizar dependências transitivas (ex.: `"minimatch": "^11.0.4"`).

---

### 🟡 SEC-07: Risco de BOLA/IDOR em `FinanceService.toggleExpensePaid`
- **Severidade:** 🟡 **MÉDIO**
- **Categoria:** Controle de Acesso / API Design
- **Arquivos Afetados:** `src/services/finance.service.ts` (linhas 275–285)
- **Tabela:** `public.fixed_expenses`
- **Explicação Técnica:**
  O método executa o update filtrando apenas pelo UUID da despesa:
  ```typescript
  const { data, error } = await supabase.from('fixed_expenses')
    .update({ paid: !currentPaidState })
    .eq('id', uuid)
    .select(...)
    .single();
  ```
  Se um usuário possuir acesso a mais de uma loja e a interface estiver no contexto da Loja A, mas enviar acidentalmente ou maliciosamente o UUID da Loja B, o banco autorizará a gravação, violando a consistência do contexto ativo.
- **Sugestão de Correção:**
  Adicionar `storeId: string` na assinatura e incluir `.eq('store_id', storeId)` na query.

---

### 🟡 PERF-01: Chaves Estrangeiras Sem Índices de Cobertura no PostgreSQL
- **Severidade:** 🟡 **MÉDIO**
- **Categoria:** Performance e Escalabilidade do Banco de Dados
- **Tabelas Afetadas:**
  - `public.physical_inventories (store_id, created_by, approved_by)`
  - `public.physical_inventory_items (inventory_id, product_variant_id)`
  - `public.returns (customer_id, created_by)`
  - `public.return_items (product_id)`
  - `public.user_store_access (user_id, store_id)`
- **Explicação Técnica:**
  No PostgreSQL, foreign keys sem índices provocam sequential scans na tabela filha durante operações de `UPDATE` ou `DELETE` na tabela pai, além de lentidão em queries de junção e relatórios de auditoria.
- **Sugestão de Correção:**
  Criar índices B-tree dedicados para essas colunas de relacionamento.

---

### 🟡 ARCH-01: Cálculos e Agregações em Memória no `DashboardView.tsx`
- **Severidade:** 🟡 **MÉDIO**
- **Categoria:** Arquitetura e Performance Frontend
- **Arquivos Afetadas:** `src/components/dashboard/DashboardView.tsx`
- **Explicação Técnica:**
  O componente `DashboardView` baixa arrays completos de transações e movimentações do `StoreContext` e calcula ticket médio, totais e Curva ABC inteiramente via loops JavaScript no browser. À medida que o histórico de vendas cresce, o tempo de renderização e o consumo de memória do dispositivo do caixa aumentam significativamente.
- **Sugestão de Correção:**
  Consumir a RPC `report_commercial_summary(p_store_id)` que executa a agregação diretamente no PostgreSQL com índices.

---

### 🟡 CODE-01: Ausência de `useCallback` em Handlers Críticos do PDV
- **Severidade:** 🟡 **MÉDIO**
- **Categoria:** Resiliência e Concorrência Frontend
- **Arquivos Afetados:** `src/components/pdv/PdvView.tsx` (linha 235)
- **Explicação Técnica:**
  A função `handleConfirmSale` é instanciada novamente a cada render, disparando o warning `react-hooks/exhaustive-deps`. Em momentos de digitação ágil de código de barras ou cliques sucessivos no fechamento do caixa, há risco de comportamento de concorrência ou reentrância indesejada.
- **Sugestão de Correção:**
  Envolver a rotina em `useCallback` e travar a execução com flag de loading (`isSubmitting`).

---

### 🟢 UX-01: Tratamento de Erros Inconsistente e Falta de Skeletons em Módulos Secundários
- **Severidade:** 🟢 **BAIXO**
- **Categoria:** Experiência de Uso (UX)
- **Arquivos Afetados:** `DashboardView.tsx`, `MovementsView.tsx`
- **Explicação Técnica:**
  Enquanto telas refatoradas recentemente (`FinanceView`, `AutomationsView`) dispõem de skeletons e painéis de erro com opção de retry, o `DashboardView` e o `MovementsView` exibem spinners simples ou telas em branco durante falhas de rede.
- **Sugestão de Correção:**
  Padronizar a exibição de skeleton screens e mensagens de erro descritivas com botão de recarregar.

---

### 🟢 LINT-01: 26 Warnings do ESLint de Código Não Utilizado e Fast Refresh
- **Severidade:** 🟢 **BAIXO**
- **Categoria:** Higiene e Qualidade de Código
- **Arquivos Afetados:** `DashboardView.tsx`, `InventoryView.tsx`, `NewProductModal.tsx`, `PdvView.tsx`, `SupplierForm.tsx`, Contextos (`AuthContext.tsx`, `StoreContext.tsx`)
- **Explicação Técnica:**
  Avisos de variáveis declaradas e nunca lidas (`CreditCard`, `ChevronDown`, `Trash2`, `formatPhone`), além de warnings do plugin `react-refresh` devido à exportação mista de componentes e funções utilitárias no mesmo arquivo.
- **Sugestão de Correção:**
  Remover imports órfãos e segregar funções auxiliares dos arquivos de componentes.

---

## 4. Plano de Ação e Recomendações Priorizadas

Para mitigar os riscos com segurança e estabilidade, as intervenções devem seguir o princípio de **uma melhoria pequena, segura e de alto impacto por ciclo de execução**, através de branch e PR dedicados:

1. **Prioridade Imediata (P0 — Integridade & Segurança):**
   - **Ticket 1 (Estoque PIX):** Atualizar a RPC `cancel_mp_pix_sale` para decrementar atomicamente `product_variants.reserved_quantity` e recalcular o estoque agregado, eliminando as reservas fantasmas.
   - **Ticket 2 (RLS Saneamento):** Aplicar migration para remover as políticas permissivas residuais (`"Finance viewable by authenticated"`, `"Customers viewable by authenticated"`).
   - **Ticket 3 (Dashboard Multi-Tenant):** Parametrizar `DashboardService.getMetrics` com `storeId` obrigatório.

2. **Prioridade Alta (P1 — RBAC & Dependências):**
   - **Ticket 4 (Entrada de Estoque):** Refatorar `InventoryService.registerStockEntry` para usar a RPC transacional `manage_product`.
   - **Ticket 5 (Segurança de Dependências):** Atualizar pacotes (`vite`, `dompurify`, `zod`) e configurar `overrides` no `package.json` para zerar avisos de auditoria npm.
   - **Ticket 6 (PostgreSQL Triggers & Indexes):** Fixar `SET search_path = public` em triggers legados e criar índices de FKs em `physical_inventories` e `returns`.

3. **Melhoria Contínua (P2 — Desempenho & UX):**
   - **Ticket 7 (Performance PDV & Linter):** Envolver `handleConfirmSale` em `useCallback` e limpar os 26 warnings do ESLint.
   - **Ticket 8 (Dashboard Otimizado):** Migrar agregação em memória do `DashboardView` para a RPC `report_commercial_summary`.

---
*Relatório gerado e validado em conformidade com as diretrizes de governança técnica do CoreSys.*
