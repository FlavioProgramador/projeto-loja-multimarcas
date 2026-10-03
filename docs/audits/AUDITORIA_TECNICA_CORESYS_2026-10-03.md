# Relatório de Auditoria Técnica Diária - CoreSys
**Data:** 2026-10-03
**Repositório:** FlavioProgramador/projeto-loja-multimarcas
**Auditor Responsável:** Engenheiro de Software Sênior (CoreSys Tech Lead / Security & Architecture Auditor)

---

## 1. Visão Geral do Sistema e Escopo da Auditoria
A auditoria diária do CoreSys analisou integralmente a camada de banco de dados Supabase (PostgreSQL, RLS, RPCs, Triggers, Migrations, Edge Functions) e a aplicação frontend (React, TypeScript, Services, Contexts e Hooks).

**Foco Principal da Análise:**
- Segurança e permissões em RLS (Row Level Security) e funções `SECURITY DEFINER`.
- Isolamento multi-tenant (`store_id` e controle de acesso por loja).
- Prevenção contra IDOR / BOLA, bypass de autorização e privilégios elevados.
- Validações de entradas em RPCs e borda (Edge Functions Mercado Pago & Automações).
- Desempenho do banco de dados (índices, consultas, CTEs e métricas lentas).
- Consistência de tipos, tratamento de erros e integridade funcional no frontend/backend.

---

## 2. Resumo Executivo dos Achados por Severidade

| Severidade | Quantidade | Descrição Sintética |
| :--- | :---: | :--- |
| **CRÍTICO** | 3 | Brechas de `search_path` em triggers `SECURITY DEFINER`, bloqueio de execução de trigger em `sales` para usuários autenticados, e parâmetro `store_id` opcional em `CustomersService.create`. |
| **ALTO** | 3 | Tabela `suppliers` sem coluna `store_id` (escopo global sem isolamento tenant), risco de vazamento/erro em leitura de `cost_price` em listagens diretas de produtos, e tratamento de replay no webhook Mercado Pago em exceções não tratadas. |
| **MÉDIO** | 2 | Fallbacks legados em memória no frontend (Reports, Returns, Customers) que realizam scan completo de tabelas e falta de índices compostos `(store_id, created_at)`. |
| **BAIXO** | 2 | Redundância de parsing numérico em utilitários e discrepância de fuso horário no filtro de datas (`Z` UTC vs `America/Sao_Paulo`). |

---

## 3. Detalhamento dos Achados Técnicos

### 🔴 SEVERIDADE: CRÍTICO

#### C1: Ausência de `SET search_path = public` em Triggers com `SECURITY DEFINER`
- **Descrição:** As funções `public.protect_profile_role()`, `public.prevent_inventory_movement_delete()`, `public.prevent_inventory_movement_update()` e `public.handle_updated_at()` foram criadas com `SECURITY DEFINER` sem definir explicitamente o `search_path`.
- **Risco / Impacto:** Permite ataques de sequestro de esquema (`search_path hijacking`). Um usuário com permissões de criar tabelas/funções temporárias em outro esquema pode forçar a execução de código malicioso com os privilégios do proprietário da função (`postgres` / `supabase_admin`).
- **Arquivos/Funções Afetados:**
  - `supabase/migrations/20260828000001_hardening_rls.sql` (`public.protect_profile_role()`)
  - `supabase/migrations/20260825214956_fase3_estoque.sql` (`public.prevent_inventory_movement_delete()`, `public.prevent_inventory_movement_update()`)
  - `supabase/migrations/20260101000000_setup.sql` (`public.handle_updated_at()`)
- **Sugestão de Correção:** Aplicar uma nova migration redefinindo as funções com a cláusula explícita `SET search_path = public`.

#### C2: Revogação de Permissão de Execução em Trigger Function `resolve_sale_customer_link()` Bloqueia Inserções de Vendas
- **Descrição:** Na migration `20261002234838_server_pagination_phase25c.sql`, a função de trigger `public.resolve_sale_customer_link()` foi configurada com `REVOKE ALL ON FUNCTION public.resolve_sale_customer_link() FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;`.
- **Risco / Impacto:** No PostgreSQL 15+, quando um usuário com a role `authenticated` insere ou atualiza registros na tabela `public.sales` (diretamente ou via RPCs de PDV/PIX), o PostgreSQL exige a permissão `EXECUTE` na função do trigger `trg_resolve_sale_customer_link`. A falta do `GRANT EXECUTE` para `authenticated` resulta no erro em runtime: `permission denied for function resolve_sale_customer_link`.
- **Arquivos/Funções Afetados:**
  - `supabase/migrations/20261002234838_server_pagination_phase25c.sql` (`public.resolve_sale_customer_link()`)
- **Sugestão de Correção:** Adicionar a instrução `GRANT EXECUTE ON FUNCTION public.resolve_sale_customer_link() TO authenticated;`.

#### C3: Assinatura Opcional do `storeId` em `CustomersService.create` Pode Inserir Registros Inválidos
- **Descrição:** O método `CustomersService.create(customer, storeId?: string)` define `storeId` como opcional em sua assinatura TypeScript, porém no banco de dados a coluna `customers.store_id` é `NOT NULL REFERENCES public.stores(id)`.
- **Risco / Impacto:** Se qualquer componente ou hook invocar a criação de cliente sem fornecer explicitamente o `storeId` da loja ativa, a transação falhará no Supabase com uma exceção não tratada (`null value in column "store_id" violates not-null constraint`), impactando a experiência no PDV/Cadastro.
- **Arquivos/Funções Afetados:**
  - `src/services/customers.service.ts` (`CustomersService.create`)
  - `src/hooks/domains/useCustomersDomain.ts`
- **Sugestão de Correção:** Tornar o parâmetro `storeId: string` obrigatório na interface de `CustomersService.create` e adicionar validação prévia na camada de serviço.

---

### 🟠 SEVERIDADE: ALTO

#### H1: Módulo de Fornecedores (`suppliers`) Operando Sem Isolamento Multi-Tenant (`store_id`)
- **Descrição:** A tabela `public.suppliers` não possui a coluna `store_id` e o serviço `SuppliersService` (`src/services/suppliers.service.ts`) executa consultas globais (`.from('suppliers').select('*').eq('is_active', true)`).
- **Risco / Impacto:** Quebra o princípio de isolamento estrito entre lojas. Fornecedores cadastrados por uma loja ficam visíveis e podem ser alterados/removidos por operadores de outras lojas no mesmo ambiente multi-tenant.
- **Arquivos/Tabelas Afetados:**
  - `supabase/migrations/20260101000000_setup.sql` (Tabela `public.suppliers`)
  - `src/services/suppliers.service.ts`
- **Sugestão de Correção:** Criar uma migration para adicionar a coluna `store_id UUID NOT NULL REFERENCES public.stores(id)` à tabela `suppliers`, criar a política de RLS filtrando por `public.has_store_access(store_id)` e atualizar o `SuppliersService` para repassar e filtrar pelo `storeId`.

#### H2: Risco de Bloqueio por Restrição de Coluna `cost_price` em Consultas Diretas de Produtos
- **Descrição:** A migration `20260930010321_phase3_finalize_tenant_customers_and_cost_privileges.sql` revogou o acesso de leitura da coluna `cost_price` da tabela `products` para as roles `authenticated` e `anon`.
- **Risco / Impacto:** Consultas diretas do frontend que tentem realizar `.select('*')` na tabela `products` executadas por usuários sem papel de ADMIN/MANAGER (como operadores/caixas) falham com `permission denied for column cost_price`.
- **Arquivos/Funções Afetados:**
  - `src/services/products.service.ts`
  - `src/services/inventory.service.ts`
- **Sugestão de Correção:** Garantir que todas as consultas diretas especifiquem explicitamente as colunas permitidas (`id, brand_id, category_id, name, description, sale_price, minimum_stock, is_active, image_url, created_at, updated_at`) ou utilizem a RPC dedicada `get_product_for_management`.

#### H3: Tratamento de Falha no Registro do Webhook Mercado Pago Em Caso de Exceção Inesperada
- **Descrição:** Na Edge Function `mp-webhook/index.ts`, caso ocorra um erro de infraestrutura ou parsing antes da execução da RPC `claim_mp_webhook_event`, a tentativa de falhar graciosamente no bloco `catch` pode falhar sem registrar o id do evento.
- **Risco / Impacto:** Reinvocações do webhook pelo provedor podem ser processadas de forma duplicada ou sem rastreabilidade de auditoria.
- **Arquivos/Funções Afetados:**
  - `supabase/functions/mp-webhook/index.ts`
- **Sugestão de Correção:** Estruturar o fluxo de extração de cabeçalhos e registro de intenção de webhook de forma atômica e com logging idempotente.

---

### 🟡 SEVERIDADE: MÉDIO

#### M1: Processamento de Paginamento em Memória no Cliente (Fallback Legado)
- **Descrição:** Os serviços `ReportsService`, `ReturnsService` e `CustomersService` mantêm blocos de fallback legados (`getLegacyCommercialSummary`, `getAll`, `getLegacyAll`) que buscam todas as linhas do banco para o cliente quando RPCs retornam determinados códigos de erro de ambiente.
- **Risco / Impacto:** Em ambientes com grande volume de vendas ou clientes, o carregamento de milhares de registros no frontend causa alto consumo de memória e congelamento da UI do navegador.
- **Arquivos/Funções Afetados:**
  - `src/services/reports.service.ts`
  - `src/services/returns.service.ts`
  - `src/services/customers.service.ts`
- **Sugestão de Correção:** Remover o fallback legado em builds de produção, garantindo o uso exclusivo de RPCs com paginação no servidor (`get_customer_directory_page`, `get_returns_page`, `report_commercial_summary`).

#### M2: Ausência de Índices Compostos para Consultas Frequentes com Filtro por Loja e Período
- **Descrição:** Consultas e RPCs de relatórios e extratos financeiros (como `report_commercial_summary` e `get_finance_page`) realizam filtragem frequente por `store_id` acompanhada de intervalo de data `created_at`.
- **Risco / Impacto:** Sob carga elevada de transações, a falta de índices compostos em `(store_id, created_at)` resulta em `Sequential Scan` nas tabelas `sales` e `financial_transactions`.
- **Tabelas/Campos Afetados:**
  - Tabela `sales` (colunas `store_id`, `created_at`, `status`)
  - Tabela `financial_transactions` (colunas `store_id`, `created_at`, `type`, `status`)
- **Sugestão de Correção:** Criar migration adicionando os índices:
  - `CREATE INDEX idx_sales_store_status_created ON public.sales (store_id, status, created_at DESC);`
  - `CREATE INDEX idx_fin_tx_store_type_created ON public.financial_transactions (store_id, type, status, created_at DESC);`

---

### 🔵 SEVERIDADE: BAIXO

#### L1: Redundâncias na Conversão e Parsing de Números nos Serviços Frontend
- **Descrição:** Diversos serviços contêm declarações locais duplicadas da função auxiliar `toNumber(value: unknown)` e mapeamento de campos manuais.
- **Arquivos Afetados:**
  - `src/services/reports.service.ts`
  - `src/services/returns.service.ts`
  - `src/services/customers.service.ts`
- **Sugestão de Correção:** Centralizar as funções de parsing numérico e sanitização em `src/lib/utils.ts`.

#### L2: Inconsistência de Fuso Horário em Filtros de Data Local no Frontend
- **Descrição:** O utilitário `toDateStart` em `reports.service.ts` concatena `'T00:00:00.000Z'` diretamente à string YYYY-MM-DD.
- **Risco / Impacto:** Usuários no fuso horário do Brasil (`GMT-3` / `America/Sao_Paulo`) podem observar deslocamento de 3 horas nas bordas dos relatórios de início/fim de dia.
- **Arquivos Afetados:**
  - `src/services/reports.service.ts`
- **Sugestão de Correção:** Utilizar a formatação ISO considerando a comutação de fusos do fuso padrão da aplicação (`America/Sao_Paulo`).

---

## 4. Plano de Ação Recomendado para Próxima Sprint de Correção

1. **Sprint Security & Multi-Tenant Hardening (Imediato):**
   - Criar migration corrigindo o `GRANT EXECUTE` da função `public.resolve_sale_customer_link()` para `authenticated`.
   - Adicionar `SET search_path = public` nas funções `SECURITY DEFINER` listadas no item C1.
   - Migrar a tabela `suppliers` para o modelo multi-tenant com coluna `store_id` e políticas de RLS apropriadas.

2. **Sprint Frontend & Performance:**
   - Atualizar a assinatura de `CustomersService.create` exigindo obrigatoriamente o `storeId`.
   - Adicionar índices compostos `idx_sales_store_status_created` e `idx_fin_tx_store_type_created`.
   - Limpar os fallbacks legados de busca total em memória no frontend.

---
**Status da Validação do Repositório:**
- `npm run typecheck`: Aprovado sem erros de compilação.
- `npm test`: 11 suítes de testes aprovadas (39 testes no total).
- Estado da Working Tree: Limpo / Relatório gerado.
