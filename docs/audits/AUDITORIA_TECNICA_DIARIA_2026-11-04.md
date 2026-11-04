# Relatório de Auditoria Técnica Diária — CoreSys (VESTRA ERP)
**Data:** 04 de novembro de 2026
**Responsável:** Engenheiro de Software Sênior / Auditoria Técnica Contínua
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Escopo:** Frontend (React + TypeScript), Backend (Supabase PostgreSQL + RLS + PL/pgSQL RPCs), Supabase Auth, Isolamento Multi-tenant, Performance, Edge Functions e LGPD.
**Diretriz Operacional:** Não foram feitas alterações automáticas em código ou no banco nesta etapa de auditoria.

---

## 1. Resumo Executivo

A auditoria técnica diária do CoreSys analisou minuciosamente a base de código do frontend, as Edge Functions Deno, as 50+ migrações do Supabase, políticas RLS, rotinas `SECURITY DEFINER`, além de métricas de integridade de dados e isolamento multi-tenant.

O projeto apresentou evoluções sólidas nas últimas iterações (implementação de controle de transações no PDV, soft deletes, motor de automações v2, relatórios consolidados e paginação no backend). Contudo, persistem **riscos críticos e altos de segurança e isolamento multi-tenant** decorrentes de políticas RLS permissivas históricas que não foram expressamente revogadas em migrations subsequentes, consultas no frontend que não utilizam o contexto da loja ativa, além de potenciais vulnerabilidades de dependências e ausência de índices em chaves estrangeiras.

---

## 2. Quadro Consolidado de Achados

| ID | Classificação | Área | Resumo do Problema |
|---|---|---|---|
| **SEC-01** | 🔴 **CRÍTICO** | Supabase RLS / Multi-tenant | Políticas permissivas legadas (`USING(true)`) ativas em `financial_transactions` e `customers` contornando o isolamento por loja |
| **SEC-02** | 🔴 **CRÍTICO** | Multi-tenant / Frontend / IDOR | `DashboardService.ts` busca vendas globais sem filtro de `store_id`, expondo faturamento de todas as lojas |
| **SEC-03** | 🟠 **ALTO** | Multi-tenant / Dados | `suppliers`, `brands` e `categories` não possuem `store_id` nem particionamento por loja |
| **SEC-04** | 🟠 **ALTO** | Segurança / RPCs | Triggers `SECURITY DEFINER` legados sem `SET search_path = public` explícito |
| **SEC-05** | 🟠 **ALTO** | Segurança / Supply Chain | Vulnerabilidades moderadas a críticas no ecossistema npm (`dompurify`, `undici`, `vite`, `zod`, `vitest`) |
| **PERF-01**| 🟡 **MÉDIO** | Banco de Dados / Performance | Ausência de índices em Foreign Keys críticas (`physical_inventories`, `returns`, `user_store_access`) |
| **ARCH-01**| 🟡 **MÉDIO** | Frontend / Código Morto & Estado | Componente `DashboardView` não consome `DashboardService` e calcula métricas em memória a partir de listas completas |
| **UX-01**  | 🟢 **BAIXO** | Frontend / Tratamento de Erros | Telas críticas (`DashboardView`, `MovementsView`) sem estado visual de carregamento ou tratamento de erro amigável |

---

## 3. Detalhamento dos Problemas e Planos de Remediação

### 🔴 SEC-01: Políticas Permissivas Residuais em RLS (`USING(true)`)
- **Classificação:** 🔴 **CRÍTICO**
- **Arquivos/Tabelas Afetadas:**
  - Tabelas: `public.financial_transactions`, `public.customers`, `public.sales`
  - Arquivos: `supabase/migrations/20260101000000_setup.sql`, `supabase/migrations/20260828000001_hardening_rls.sql`, `supabase/migrations/20260925164958_reconciliacao_multi_loja_20260925.sql`
- **Explicação:**
  No PostgreSQL, as políticas de Row Level Security para uma operação (como `SELECT` ou `UPDATE`) são combinadas via operador lógico **`OR`** permissivo padrão.
  1. Na tabela `financial_transactions`, a policy original `"Finance viewable by authenticated"` criada em `setup.sql` com `USING (true)` nunca foi removida por `DROP POLICY IF EXISTS`. Embora a migração `20260925164958` tenha criado `"Finance viewable by store access"`, a presença da regra anterior com `USING (true)` permite que qualquer usuário autenticado leia todas as transações financeiras de qualquer loja no sistema.
  2. Na tabela `customers`, a policy `"Customers viewable by authenticated"` (`USING (true)`) e `"Customers updatable by authenticated"` (`USING (true)`) criadas nas migrações iniciais não foram removidas ao se criar `"Customers viewable by store access"`, permitindo acesso global a dados de clientes entre diferentes tenants.
  3. Na tabela `sales`, a policy `"Sales updatable by Admin/Manager"` criada na migração `20260828000001` permaneceu aberta sem filtro de `store_id`.
- **Sugestão de Correção:**
  Criar uma migration de saneamento imediato (`harden_residual_permissive_rls.sql`):
  ```sql
  BEGIN;
  -- Remover policies residuais permissivas em financial_transactions
  DROP POLICY IF EXISTS "Finance viewable by authenticated" ON public.financial_transactions;

  -- Remover policies residuais em customers
  DROP POLICY IF EXISTS "Customers viewable by authenticated" ON public.customers;
  DROP POLICY IF EXISTS "Customers updatable by authenticated" ON public.customers;
  DROP POLICY IF EXISTS "Customers deletable by authenticated" ON public.customers;

  -- Assegurar que apenas políticas com has_store_access / get_user_store_role permaneçam ativas
  COMMIT;
  ```

---

### 🔴 SEC-02: Vazamento de Dados Multi-tenant em `DashboardService.ts`
- **Classificação:** 🔴 **CRÍTICO**
- **Arquivos/Tabelas Afetadas:**
  - Arquivo: `src/services/dashboard.service.ts`
  - Tabelas: `public.sales`, `public.product_variants`
- **Explicação:**
  O método `DashboardService.getMetrics()` executa uma query direta:
  ```ts
  const { data: sales, error: salesError } = await supabase
    .from('sales')
    .select('id, sale_number, total, created_at, customer_name, payments(method, installments), sale_items(product_name, quantity)')
    .eq('status', 'COMPLETED')
    .order('created_at', { ascending: false });
  ```
  Ele não recebe nem aplica o filtro `.eq('store_id', currentStoreId)`. Caso a RLS falhe ou se o usuário possuir acesso a mais de uma loja, as vendas e o faturamento exibidos misturarão dados de múltiplos tenants. Além disso, busca variantes diretamente em `product_variants` ao invés de consultar o estoque específico da loja em `store_inventory`.
- **Sugestão de Correção:**
  1. Alterar a assinatura do método para `getMetrics(storeId: string)`.
  2. Aplicar `.eq('store_id', storeId)` na consulta da tabela `sales`.
  3. Consultar `store_inventory` com filtro `store_id` para o cálculo de `lowStockCount`.
  4. Melhor prática: substituir por uma RPC agregadora em SQL que já retorne os totais consolidados sem trafegar milhares de linhas de vendas para o frontend.

---

### 🟠 SEC-03: Entidades Compartilhadas sem Segregação por Loja (`suppliers`, `brands`, `categories`)
- **Classificação:** 🟠 **ALTO**
- **Arquivos/Tabelas Afetadas:**
  - Tabelas: `public.suppliers`, `public.brands`, `public.categories`
  - Serviços: `src/services/suppliers.service.ts`, `src/services/brands.service.ts`, `src/services/categories.service.ts`
- **Explicação:**
  As tabelas `suppliers`, `brands` e `categories` não possuem coluna `store_id` nem tabela de relacionamento com lojas. Todos os usuários autenticados de qualquer loja cadastram e visualizam os mesmos fornecedores, marcas e categorias (`USING (true)`). Para operações de redes franquiadas ou lojas independentes na mesma instância do CoreSys, fornecedores e dados de contato sensíveis de uma loja ficam visíveis para concorrentes ou outras filiais sem controle de compartilhamento explícito.
- **Sugestão de Correção:**
  1. Avaliar se o modelo de negócio adota fornecedores globais ou segregados. Caso segregado, adicionar coluna `store_id UUID REFERENCES public.stores(id)` (ou manter flag `is_global boolean DEFAULT false`).
  2. Atualizar as políticas RLS para permitir `SELECT` somente se `store_id` corresponder à loja do usuário ou se for global.

---

### 🟠 SEC-04: Triggers `SECURITY DEFINER` Legados sem `search_path`
- **Classificação:** 🟠 **ALTO**
- **Arquivos/Tabelas Afetadas:**
  - Funções: `public.handle_updated_at()`, `public.prevent_inventory_movement_delete()`, `public.protect_profile_role()`
  - Arquivos: `supabase/migrations/20260101000000_setup.sql`, `supabase/migrations/20260825214956_fase3_estoque.sql`, `supabase/migrations/20260828000001_hardening_rls.sql`
- **Explicação:**
  A maioria das RPCs foi corrigida nas migrações de hardening com `SET search_path = public`. No entanto, funções de trigger criadas nas primeiras migrações foram definidas com `SECURITY DEFINER` sem fixar o `search_path`. Em cenários onde objetos ou esquemas adicionais possam ser manipulados, a ausência de um `search_path` imutável permite sequestro de operadores ou tabelas (search_path hijacking).
- **Sugestão de Correção:**
  Executar alteração nessas funções:
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
  A execução de `npm run security:dependencies` acusou 21 vulnerabilidades (16 moderadas, 4 altas, 1 crítica):
  - `dompurify <= 3.4.16` (Crítica — bypass de sanitização DOM / templates)
  - `vite <= 6.4.3` (Alta — segurança do dev server e middleware)
  - `zod < 4.6.6` (Alta — esgotamento de memória em validação)
  - `undici` (Alta — DoS e bypass em TLS/HTTP)
- **Sugestão de Correção:**
  1. Atualizar `dompurify` para `>= 3.2.4` ou versão estável corrigida.
  2. Utilizar o campo `overrides` no `package.json` para travar versões seguras de dependências transitivas.
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
  No PostgreSQL, foreign keys sem índice geram `table scans` e travamentos (table locks prolongados) durante operações de exclusão ou atualização em cascata na tabela pai, além de degradarem o tempo de resposta das queries de junção frequentes (ex: carregar todos os itens de um inventário ou devoluções de um cliente).
- **Sugestão de Correção:**
  Criar migration adicionando índices dedicados:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_phys_inv_store ON public.physical_inventories(store_id);
  CREATE INDEX IF NOT EXISTS idx_phys_inv_items_inv ON public.physical_inventory_items(inventory_id);
  CREATE INDEX IF NOT EXISTS idx_returns_customer ON public.returns(customer_id);
  CREATE INDEX IF NOT EXISTS idx_return_items_product ON public.return_items(product_id);
  ```

---

### 🟡 ARCH-01: Código Duplicado / Desconectado e Processamento em Memória no Dashboard
- **Classificação:** 🟡 **MÉDIO**
- **Arquivos Afetados:** `src/components/dashboard/DashboardView.tsx`, `src/services/dashboard.service.ts`
- **Explicação:**
  O arquivo `src/services/dashboard.service.ts` foi construído para buscar e calcular métricas via Supabase, mas **nenhum componente da aplicação importa ou utiliza esse serviço** (código inerte/morto).
  Em vez disso, `src/components/dashboard/DashboardView.tsx` recebe as listas globais `movements`, `transactions` e `products` diretamente do `StoreContext` e calcula ticket médio, Curva ABC, faturamento diário e distribuição de pagamentos iterando arrays inteiros no cliente via JavaScript. Em um ambiente com dezenas de milhares de vendas, esse modelo sobrecarrega a CPU do navegador e consome tráfego excessivo.
- **Sugestão de Correção:**
  1. Conectar `DashboardView` a um serviço otimizado ou RPC dedicada no banco (`get_commercial_summary` ou similar).
  2. Remover `DashboardService.ts` ou refatorá-lo para alimentar a view com paginação e agregações feitas no PostgreSQL.

---

### 🟢 UX-01: Tratamento de Erros Inconsistente e Falta de Feedback Visual
- **Classificação:** 🟢 **BAIXO**
- **Arquivos Afetados:** `src/components/dashboard/DashboardView.tsx`, `src/components/movements/MovementsView.tsx`
- **Explicação:**
  Enquanto componentes como `FinanceView`, `ReturnsView` e `AutomationsView` possuem skeletons e tratamento explícito de estados de erro e loading, a `DashboardView` e `MovementsView` dependem exclusivamente do estado estático em memória, sem exibir indicadores visuais claros de carregamento ou mensagens caso o sincronismo com o backend falhe.
- **Sugestão de Correção:**
  Padronizar a exibição de loading skeletons e alertas de erro consistentes em todos os módulos principais.

---

## 4. Recomendações Priorizadas para a Próxima Iteração (Roadmap)

1. **Sprint Imediata (P0 / Segurança Máxima):**
   - Aplicar migração para `DROP POLICY IF EXISTS` nas regras permissivas legadas (`Finance viewable by authenticated` e `Customers viewable by authenticated`).
   - Bloquear chamadas globais de `DashboardService` sem `store_id`.
   - Atualizar dependência crítica `dompurify` e configurar `overrides`.

2. **Sprint Curto Prazo (P1 / Integridade & Performance):**
   - Adicionar índices de foreign keys faltantes (`physical_inventory_items`, `returns`).
   - Aplicar `SET search_path = public` nas 3 funções de trigger legadas.
   - Decidir a arquitetura multi-tenant para `suppliers` (adicionar `store_id` ou manter formalmente como catálogo global compartilhado com isolamento por perfil).

3. **Sprint Médio Prazo (P2 / Qualidade de Código & UX):**
   - Conectar o Dashboard aos endpoints de resumo em banco em substituição aos loops em memória no React.
   - Adicionar Skeletons e tratamento de exceções na `DashboardView`.
