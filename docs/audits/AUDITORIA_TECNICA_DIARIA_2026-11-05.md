# Relatório de Auditoria Técnica Diária — CoreSys (VESTRA ERP)
**Data:** 05 de novembro de 2026
**Responsável:** Engenheiro de Software Sênior / Auditoria Técnica Diária Contínua
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Escopo:** Frontend (React + TypeScript), Backend (Supabase PostgreSQL + RLS + PL/pgSQL RPCs), Supabase Auth, Isolamento Multi-tenant, Performance, Edge Functions, LGPD e Tratamento de Erros.
**Diretriz Operacional:** Não foram feitas alterações automáticas em código ou no banco de dados nesta etapa de auditoria.

---

## 1. Resumo Executivo

A auditoria técnica diária do CoreSys analisou detalhadamente a base de código do frontend, as Edge Functions Deno, as mais de 50 migrações do Supabase, as políticas de segurança a nível de linha (RLS), as funções `SECURITY DEFINER`, além de métricas de integridade de dados e isolamento multi-tenant.

O projeto consolidou importantes avanços recentes, como o motor de automações v2, paginação no servidor (Phase 25c), relatórios comerciais sumarizados e controle de integridade transacional de vendas e estoque. Contudo, a auditoria identificou **pontos de atenção críticos e altos** relativos ao isolamento multi-tenant, persistência de políticas RLS permissivas residuais, consultas frontend sem escopo de loja, ausência de isolamento em cadastros complementares, além de vulnerabilidades de dependências e gaps de indexação em chaves estrangeiras.

---

## 2. Quadro Consolidado de Achados

| ID | Classificação | Área | Resumo do Problema |
|---|---|---|---|
| **SEC-01** | 🔴 **CRÍTICO** | Supabase RLS / Multi-tenant | Políticas permissivas legadas (`USING(true)`) ativas em `financial_transactions` e `customers` contornando o isolamento por loja |
| **SEC-02** | 🔴 **CRÍTICO** | Multi-tenant / Frontend / IDOR | `DashboardService.ts` busca vendas globais sem filtro de `store_id`, podendo expor faturamento de outros tenants |
| **SEC-03** | 🟠 **ALTO** | Multi-tenant / Catálogo Compartilhado | `suppliers`, `brands` e `categories` não possuem `store_id` nem particionamento por loja |
| **SEC-04** | 🟠 **ALTO** | Segurança / RPCs & Triggers | Triggers `SECURITY DEFINER` legados sem `SET search_path = public` explícito |
| **SEC-05** | 🟠 **ALTO** | Segurança / Supply Chain | Vulnerabilidades no ecossistema npm (`dompurify`, `undici`, `vite`, `zod`, `vitest`) |
| **PERF-01**| 🟡 **MÉDIO** | Banco de Dados / Performance | Ausência de índices em Foreign Keys críticas (`physical_inventories`, `returns`, `user_store_access`) |
| **ARCH-01**| 🟡 **MÉDIO** | Frontend / Código Morto & Arquitetura | `DashboardService.ts` desacoplado da UI e `DashboardView` calculando métricas em memória |
| **UX-01**  | 🟢 **BAIXO** | Frontend / Resiliência & Feedback | Telas críticas (`DashboardView`, `MovementsView`) sem skeleton visual ou feedback amigável de erro |

---

## 3. Detalhamento dos Problemas e Planos de Remediação

### 🔴 SEC-01: Políticas Permissivas Residuais em RLS (`USING(true)`)
- **Classificação:** 🔴 **CRÍTICO**
- **Arquivos/Tabelas Afetadas:**
  - Tabelas: `public.financial_transactions`, `public.customers`, `public.sales`
  - Arquivos: `supabase/migrations/20260101000000_setup.sql`, `supabase/migrations/20260828000001_hardening_rls.sql`, `supabase/migrations/20260925164958_reconciliacao_multi_loja_20260925.sql`, `supabase/migrations/20260930010321_phase3_finalize_tenant_customers_and_cost_privileges.sql`
- **Explicação:**
  No PostgreSQL, múltiplas políticas RLS para o mesmo comando (`SELECT`, `UPDATE`, `DELETE`) em uma tabela são combinadas através do operador lógico **`OR`** permissivo.
  1. Em `financial_transactions`, a política inicial `"Finance viewable by authenticated"` com `USING (true)` criada em `setup.sql` não foi formalmente descartada com `DROP POLICY IF EXISTS`. Mesmo com a adição da política `"Finance viewable by store access"`, a regra permissiva permite que qualquer usuário autenticado leia movimentações financeiras de qualquer loja.
  2. Em `customers`, embora migrações recentes tenham adicionado `store_id`, a política original `"Customers viewable by authenticated"` (`USING (true)`) permaneceu residual em ambientes não purgados, permitindo a leitura irrestrita da base de clientes entre lojas distintas.
- **Sugestão de Correção:**
  Criar uma migration específica de saneamento de RLS:
  ```sql
  BEGIN;
  -- Remover policies residuais permissivas em financial_transactions
  DROP POLICY IF EXISTS "Finance viewable by authenticated" ON public.financial_transactions;

  -- Remover policies residuais permissivas em customers
  DROP POLICY IF EXISTS "Customers viewable by authenticated" ON public.customers;
  DROP POLICY IF EXISTS "Customers updatable by authenticated" ON public.customers;
  DROP POLICY IF EXISTS "Customers deletable by authenticated" ON public.customers;
  DROP POLICY IF EXISTS "Customers manageable by authenticated" ON public.customers;

  COMMIT;
  ```

---

### 🔴 SEC-02: Vazamento de Dados Multi-tenant em `DashboardService.ts`
- **Classificação:** 🔴 **CRÍTICO**
- **Arquivos/Tabelas Afetadas:**
  - Arquivo: `src/services/dashboard.service.ts`
  - Tabelas: `public.sales`, `public.product_variants`
- **Explicação:**
  O serviço `DashboardService.getMetrics()` executa uma query direta sem filtro de tenant:
  ```ts
  const { data: sales, error: salesError } = await supabase
    .from('sales')
    .select('id, sale_number, total, created_at, customer_name, payments(method, installments), sale_items(product_name, quantity)')
    .eq('status', 'COMPLETED')
    .order('created_at', { ascending: false });
  ```
  O método não recebe nem valida o `storeId`. Usuários com acesso a mais de uma filial ou em caso de contorno de RLS têm seus dados de faturamento consolidados indiscriminadamente. Além disso, calcula `lowStockVariants` consultando `product_variants` globalmente em vez de `store_inventory` por loja.
- **Sugestão de Correção:**
  1. Alterar a assinatura para `getMetrics(storeId: string)`.
  2. Adicionar `.eq('store_id', storeId)` na consulta da tabela `sales`.
  3. Consultar a view ou tabela `store_inventory` filtrada por `store_id` para computar itens com estoque crítico.
  4. Alternativamente, integrar diretamente com a RPC `report_commercial_summary(p_store_id)` já existente no PostgreSQL.

---

### 🟠 SEC-03: Entidades Compartilhadas sem Segregação por Loja (`suppliers`, `brands`, `categories`)
- **Classificação:** 🟠 **ALTO**
- **Arquivos/Tabelas Afetadas:**
  - Tabelas: `public.suppliers`, `public.brands`, `public.categories`
  - Arquivos: `src/services/suppliers.service.ts`, `src/services/brands.service.ts`, `src/services/categories.service.ts`
- **Explicação:**
  As tabelas `suppliers`, `brands` e `categories` não possuem a coluna `store_id`. Qualquer loja parceira ou operador autenticado consegue visualizar, alterar ou excluir fornecedores, marcas e categorias de outras empresas que utilizem a mesma infraestrutura, configurando quebra do modelo de isolamento estrito multi-tenant.
- **Sugestão de Correção:**
  1. Adicionar `store_id UUID REFERENCES public.stores(id)` (ou manter uma flag `is_global boolean DEFAULT false` para itens padrão do sistema).
  2. Ajustar políticas RLS para exigir `store_id = current_store` ou `is_global = true`.
  3. Atualizar os serviços frontend correspondentes para injetar o contexto da loja ativa.

---

### 🟠 SEC-04: Triggers `SECURITY DEFINER` Legados sem `SET search_path`
- **Classificação:** 🟠 **ALTO**
- **Arquivos/Tabelas Afetadas:**
  - Funções: `public.handle_updated_at()`, `public.prevent_inventory_movement_delete()`, `public.protect_profile_role()`
  - Arquivos: `supabase/migrations/20260101000000_setup.sql`, `supabase/migrations/20260825214956_fase3_estoque.sql`, `supabase/migrations/20260828000001_hardening_rls.sql`
- **Explicação:**
  Embora as RPCs comerciais tenham sido devidamente protegidas em migrações de hardening, triggers legados marcados com `SECURITY DEFINER` não fixaram explicitamente `SET search_path = public`. A ausência de caminho de busca estático pode permitir o sequestro de esquemas caso objetos temporários sejam injetados em sessões privilegiadas.
- **Sugestão de Correção:**
  Executar alteração explícita de atributos das funções:
  ```sql
  ALTER FUNCTION public.handle_updated_at() SET search_path = public;
  ALTER FUNCTION public.prevent_inventory_movement_delete() SET search_path = public;
  ALTER FUNCTION public.protect_profile_role() SET search_path = public;
  ```

---

### 🟠 SEC-05: Dependências com Vulnerabilidades Conhecidas no `package.json`
- **Classificação:** 🟠 **ALTO**
- **Arquivos Afetados:** `package.json`, `package-lock.json`
- **Explicação:**
  A execução de `npm run security:dependencies` acusou 19 vulnerabilidades (14 moderadas, 4 altas, 1 crítica):
  - `dompurify <= 3.4.16` (Crítica — evasão de sanitização DOM / templates shadow root)
  - `vite <= 6.4.3` (Alta — segurança do dev server e middleware)
  - `zod < 4.6.6` (Alta — esgotamento de memória em validação de coleções restritas)
  - `undici` (Alta — DoS e bypass em validação de certificados TLS)
- **Sugestão de Correção:**
  1. Atualizar a dependência direta `dompurify` para versão estável corrigida.
  2. Utilizar o campo `overrides` em `package.json` para travar versões de pacotes transitivos como `undici`, `minimatch` e `qs`.
  3. Atualizar pacotes de desenvolvimento (`vite`, `vitest`).

---

### 🟡 PERF-01: Chaves Estrangeiras Sem Índices de Suporte no Banco de Dados
- **Classificação:** 🟡 **MÉDIO**
- **Tabelas Afetadas:**
  - `public.physical_inventories (store_id, created_by, approved_by)`
  - `public.physical_inventory_items (inventory_id, product_variant_id)`
  - `public.returns (customer_id, created_by)`
  - `public.return_items (product_id)`
  - `public.user_store_access (user_id, store_id)`
- **Explicação:**
  No PostgreSQL, chaves estrangeiras sem índices correspondentes provocam table scans e bloqueios desnecessários durante operações concorrentes de atualização ou exclusão na tabela referenciada, impactando a performance de listagens e filtros frequentes.
- **Sugestão de Correção:**
  Adicionar índices de cobertura:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_phys_inv_store ON public.physical_inventories(store_id);
  CREATE INDEX IF NOT EXISTS idx_phys_inv_items_inv ON public.physical_inventory_items(inventory_id);
  CREATE INDEX IF NOT EXISTS idx_returns_customer ON public.returns(customer_id);
  CREATE INDEX IF NOT EXISTS idx_return_items_product ON public.return_items(product_id);
  ```

---

### 🟡 ARCH-01: Código Desconectado / Inerte e Agregações em Memória no Dashboard
- **Classificação:** 🟡 **MÉDIO**
- **Arquivos Afetadas:** `src/components/dashboard/DashboardView.tsx`, `src/services/dashboard.service.ts`
- **Explicação:**
  `DashboardService.ts` não é importado nem consumido por nenhum componente da interface. O componente `DashboardView.tsx` consome listas inteiras de transações, produtos e movimentações a partir do `StoreContext` e calcula ticket médio, Curva ABC e faturamento diário inteiramente no browser via JavaScript. Isso degrada o desempenho do cliente à medida que o volume de dados cresce.
- **Sugestão de Correção:**
  1. Conectar a `DashboardView` a serviços agregadores ou RPCs que executam a consolidação no banco de dados (`report_commercial_summary`).
  2. Ajustar `DashboardService` para expor essas agregações parametrizadas por `storeId`.

---

### 🟢 UX-01: Tratamento de Erros Inconsistente e Falta de Feedback Visual
- **Classificação:** 🟢 **BAIXO**
- **Arquivos Afetadas:** `src/components/dashboard/DashboardView.tsx`, `src/components/movements/MovementsView.tsx`
- **Explicação:**
  Ao contrário de módulos como `FinanceView`, `ReturnsView` e `AutomationsView`, os módulos `DashboardView` e `MovementsView` carecem de skeletons de carregamento unificados e de painéis de tratamento e retry caso ocorram erros de rede ou sincronização.
- **Sugestão de Correção:**
  Implementar componentes padronizados de skeleton e feedback de erro em todas as telas centrais do sistema.

---

## 4. Recomendações e Próximos Passos Priorizados

1. **Prioridade Imediata (P0 / Segurança & Multi-tenant):**
   - Criar migration para remover as políticas permissivas legadas (`Finance viewable by authenticated` e `Customers viewable by authenticated`).
   - Aplicar filtro obrigatório de `store_id` em consultas diretas de vendas e dashboard.
   - Atualizar `dompurify` e configurar `overrides` de segurança para neutralizar o alerta crítico no CI.

2. **Prioridade Média (P1 / Performance & Banco):**
   - Criar índices nas chaves estrangeiras sem suporte em `physical_inventories`, `returns` e tabelas filhas.
   - Fixar `search_path = public` nos triggers residuais.
   - Deliberar arquitetura multi-tenant para `suppliers`, `brands` e `categories`.

3. **Melhoria Contínua (P2 / Arquitetura & UX):**
   - Eliminar cálculos analíticos em memória no `DashboardView` substituindo-os por RPC agregadora no PostgreSQL.
   - Padronizar estados de erro e loading skeletons.
