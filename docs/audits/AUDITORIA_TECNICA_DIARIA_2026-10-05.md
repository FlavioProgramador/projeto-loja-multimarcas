# Relatório de Auditoria Técnica Diária — CoreSys
**Data:** 05 de outubro de 2026
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Audor:** Engenharia de Software Sênior / Auditoria CoreSys

---

## 📊 Resumo Executivo & Status do Sistema

Nesta auditoria técnica diária, foi realizada uma análise minuciosa do código-fonte (frontend React/TypeScript), das Edge Functions Deno/Supabase, dos arquivos de migração PostgreSQL/Supabase (`supabase/migrations/`) e da suíte de testes do projeto CoreSys.

### Indicadores Gerais
- **Status dos Testes Automatizados:** 11 arquivos de teste passando (39/39 testes unitários OK).
- **TypeScript (`npm run typecheck`):** 0 erros.
- **ESLint (`npm run lint`):** 0 erros, 27 avisos (variáveis não utilizadas e hooks de dependência `useEffect`).
- **Nível de Prontidão Multi-Tenant:** Intermediário-Avançado (Núcleo de vendas/estoque/financeiro/automações devidamente isolado via `store_id`, porém entidades globais compartilhadas sem isolamento por tenant no frontend).

---

## 🔴 ACHADOS DE AUDITORIA

---

### 1. ALTO — Descontinuidade no Isolamento Multi-Tenant em Entidades Globais (Marcas, Categorias e Fornecedores)

- **Severidade:** ALTO
- **Descrição:**
  As tabelas `brands`, `categories` e `suppliers` são gerenciadas como tabelas globais sem coluna `store_id` no schema e sem isolamento por tenant nos serviços do frontend (`BrandsService`, `CategoriesService`, `SuppliersService`).

  Embora o compartilhamento de um catálogo global possa ser intencional em redes de lojas do mesmo grupo, qualquer usuário autenticado de *qualquer loja* (tenant) possui permissão para visualizar, criar, editar e excluir registros nessas tabelas globais. Além disso, no serviço `InventoryService.registerStockEntry`, novas marcas e categorias são inseridas diretamente no banco via queries no frontend sem verificar se já existem no contexto da loja ou grupo.

- **Arquivos / Tabelas Afetados:**
  - `src/services/brands.service.ts`
  - `src/services/categories.service.ts`
  - `src/services/suppliers.service.ts`
  - `src/services/inventory.service.ts`
  - Tabelas Supabase: `public.brands`, `public.categories`, `public.suppliers`

- **Sugestão de Correção:**
  1. Avaliar a inclusão de `store_id` (ou suporte a `organization_id`) nas tabelas `brands`, `categories` e `suppliers`, com políticas RLS restritas por `has_store_access(store_id)`.
  2. Alternativamente, se o catálogo for mantido global por decisão de negócio, restringir as operações de alteração (`INSERT`, `UPDATE`, `DELETE`) nas RLS apenas para administradores globais (`current_user_role() = 'ADMIN'`), impedindo que operadores de caixa ou gerentes de uma loja alterem dados cadastrais compartilhados.

---

### 2. ALTO — Inserções e Atualizações Diretas em Tabelas do Banco via Frontend Ignorando Validação Transacional de Tenant

- **Severidade:** ALTO
- **Descrição:**
  Em `InventoryService.registerStockEntry`, quando um produto ou variante não existe no banco, o frontend realiza consultas e chamadas `insert()` diretas sobre as tabelas `products`, `product_variants`, `brands` e `categories` antes de invocar a RPC `register_stock_entry`.

  Isso gera um risco de inconsistência e contorno de regras de negócio:
  - Se a chamada `register_stock_entry` falhar em seguida, os registros de `products` e `product_variants` já criados permanecem no banco (sem transação atômica).
  - O custo unitário do produto é passado no frontend e pode ser atualizado na tabela `products` diretamente sem passar por validações de permissão restrita de custos (`can_access_product_cost`).

- **Arquivos / Tabelas Afetados:**
  - `src/services/inventory.service.ts` (linhas 72-150)
  - Tabelas Supabase: `products`, `product_variants`, `brands`, `categories`

- **Sugestão de Correção:**
  Encapsular todo o fluxo de criação/localização de produto e registro de entrada de estoque em uma única RPC transacional com `SECURITY DEFINER` (por exemplo, estender `register_stock_entry` ou utilizar `manage_product`), garantindo atomicidade e bloqueio de alterações diretas na tabela via cliente.

---

### 3. MÉDIO — Dependências Incompletas em `useEffect` nos Componentes de Dashboard e Financeiro

- **Severidade:** MÉDIO
- **Descrição:**
  A análise do ESLint revelou avisos em componentes chave do sistema:
  - `RevenueChart.tsx` e `TopProductsChart.tsx`: `useEffect` possui array de dependências que omite `data` e `labels`, podendo gerar relatórios desatualizados na interface quando as propriedades mudam.
  - `FinanceView.tsx`: `useEffect` omite `loadTransactions` e `loadExpenses`.
  - `PdvView.tsx`: a função `handleConfirmSale` recria instâncias sem `useCallback`, fazendo com que o `useEffect` da linha 372 dispare desnecessariamente ou feche sobre estados obsoletos (*stale closures*).

- **Arquivos Afetados:**
  - `src/components/dashboard/RevenueChart.tsx`
  - `src/components/dashboard/TopProductsChart.tsx`
  - `src/components/finance/FinanceView.tsx`
  - `src/components/pdv/PdvView.tsx`

- **Sugestão de Correção:**
  - Envolver funções assíncronas chamadas em `useEffect` em `useCallback` ou declará-las internamente ao hook.
  - Incluir as dependências corretas nos hooks conforme indicado pelas regras do React ESLint.

---

### 4. MÉDIO — Risco de Inconsistência de Estado e Falta de Truncamento em Variáveis Não Utilizadas

- **Severidade:** MÉDIO
- **Descrição:**
  Foram identificados 27 avisos do ESLint referentes a variáveis atribuídas mas não utilizadas (ex: `setSelectedColecao`, `setSelectedEstacao`, `setSelectedGenero` em `PdvView.tsx`, `formatPhone` em `SupplierForm.tsx`, `setCustomReason` em `NewReturnModal.tsx`).

  Em formulários como o PDV e Devoluções, o fato de estados estarem declarados e alterados na memória sem aplicação no payload final indica trechos de código morto ou filtros do PDV que não estão sendo enviados para as RPCs de busca e conclusão de venda.

- **Arquivos Afetados:**
  - `src/components/pdv/PdvView.tsx`
  - `src/components/returns/NewReturnModal.tsx`
  - `src/components/suppliers/SupplierForm.tsx`
  - `src/components/dashboard/DashboardView.tsx`

- **Sugestão de Correção:**
  Remover variáveis mortas ou integrar os filtros selecionados pelo usuário (como Coleção, Estação e Gênero no PDV) no envio das requisições para o backend.

---

### 5. BAIXO — Ausência de Truncamento de Log de Erro em Edge Functions (`create-mp-pix`)

- **Severidade:** BAIXO
- **Descrição:**
  Na Edge Function `create-mp-pix`, ao tratar erros retornados pelo Mercado Pago ou por RPCs do Supabase, o objeto de resposta do provedor é registrado em log com `console.error('Mercado Pago request rejected:', mpResponse.status, JSON.stringify(mpData ?? {}))`.

  Caso o provedor retorne respostas muito extensas contendo dados contextuais do pagador, logs volumosos podem ser gerados nos servidores do Supabase.

- **Arquivos Afetados:**
  - `supabase/functions/create-mp-pix/index.ts`

- **Sugestão de Correção:**
  Sanitizar e truncar as mensagens de log de erro de integrações de terceiros para registrar apenas campos essenciais (`error`, `message`, `status_detail`), garantindo conformidade com privacidade e eficiência no gerenciamento de logs.

---

## ✅ PONTOS DE DESTAQUE E BOAS PRÁTICAS OBSERVADAS

1. **Proteção Rigorosa de Preço de Custo (`cost_price`):**
   As migrações recentes (`20260929235908` e `20260930010142`) removeram privilégios diretos de `SELECT` da coluna `cost_price` da tabela `products` para roles não autorizadas, restringindo o acesso exclusivamente a funções protegidas e usuários autorizados (`can_access_product_cost`).
2. **Hardening de Idempotência nas Vendas e Pix:**
   A RPC `complete_sale` e as Edge Functions do Mercado Pago possuem controle de chave de idempotência escopadas por loja (`p_store_id`), prevenindo duplicidade de vendas ou cobranças simultâneas.
3. **Padrão Transacional Atômico no PDV e Devoluções:**
   Operações críticas como `complete_sale`, `cancel_sale` e `process_return` utilizam funções PL/pgSQL com `SECURITY DEFINER` e `SET search_path = public`, garantindo o isolamento da sessão e integridade de estoque e financeiro.

---

## 📋 PLANO DE AÇÃO RECOMENDADO

1. **Prioridade 1 (Próxima Sprint):**
   - Refatorar `InventoryService.registerStockEntry` para mover a criação de produtos e variantes para a RPC de banco.
   - Definir regras RLS/permissões explícitas para as tabelas `brands`, `categories` e `suppliers`.
2. **Prioridade 2:**
   - Corrigir as dependências do `useEffect` e remover variáveis mortas nos componentes do PDV e Financeiro.
3. **Prioridade 3:**
   - Adicionar testes de integração cobrindo os cenários multi-loja e verificando o isolamento de dados entre tenants distintos.
