# 📊 RELATÓRIO DE AUDITORIA TÉCNICA DIÁRIA — CORESYS ERP
**Data:** 10 de Outubro de 2026
**Engenheiro Responsável:** Engenheiro de Software Sênior (Jules)
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Status da Auditoria:** Concluída

---

## 🎯 RESUMO EXECUTIVO

A auditoria técnica diária do **CoreSys ERP / PDV** analisou o estado atual do código-fonte (Frontend React/TypeScript, Backend Supabase Edge Functions em Deno, Schema do banco PostgreSQL, políticas Row Level Security (RLS) e Funções Pl/pgSQL RPC).

A arquitetura do sistema evoluiu significativamente com as últimas migrações de hardening e isolamento de tenant (`user_store_access`, `store_inventory`, e RPCs atômicas com `SECURITY DEFINER` e `search_path = public`). Contudo, foram identificadas vulnerabilidades relevantes de isolamento multi-tenant, queries desprotegidas no frontend, divergências de permissões em conectores de fornecedores e pontos de atenção em Edge Functions.

| Severidade | Quantidade | Principais Áreas Afetadas |
|---|---|---|
| 🔴 **CRÍTICO** | 2 | Isolation Failure em Fornecedores (Multi-tenant), RLS e direct update de suppliers |
| 🟠 **ALTO** | 3 | Exposição de Custo de Produtos no Frontend, Rate Limiting / DoS em Webhooks, Idempotência de Devolução |
| 🟡 **MÉDIO** | 3 | Truncamento e Vazamento em Logs de Edge Functions, Falta de Validação de Input no PDV/Filtros, Inconsistência de Tipagem TypeScript |
| 🔵 **BAIXO** | 2 | Código Morto / Unused Variables no Frontend, Ausência de Indexação em Queries de Relatórios Secundários |

---

## 🔍 DETALHAMENTO DOS ACHADOS DE AUDITORIA

### 1. 🔴 [CRÍTICO] Falha de Isolamento Multi-tenant em Fornecedores (`SuppliersService.getAll()` e RLS)

- **Severidade:** CRÍTICO
- **Categoria:** Isolamento Multi-tenant / IDOR / BOLA
- **Descrição:**
  A função `SuppliersService.getAll()` do frontend efetua consulta direta na tabela `suppliers` sem filtrar pelo parâmetro `store_id` (executa apenas `.select('*').eq('is_active', true)`).
  Adicionalmente, se as políticas de RLS ou sub-queries na tabela `suppliers` permitirem leitura global ou se a tabela for compartilhada sem vínculo forte com `user_store_access`, usuários de uma loja conseguirão listar e visualizar dados confidenciais (fornecedores, contatos e documentos) pertencentes a outra loja do ecossistema.
- **Arquivos / Tabelas / Funções Afetados:**
  - `src/services/suppliers.service.ts` (`SuppliersService.getAll`, `create`, `update`, `remove`)
  - Tabela `public.suppliers`
  - Política RLS em `suppliers`
- **Impacto:** Vazamento de dados comerciais confidenciais entre tenants concorrentes.
- **Sugestão de Correção:**
  1. Alterar a assinatura de `SuppliersService.getAll(storeId: string)` para exigir e incluir `.eq('store_id', storeId)`.
  2. Garantir que a tabela `suppliers` possua a coluna `store_id NOT NULL` e que a política RLS exija `store_id IN (SELECT store_id FROM public.get_user_stores(auth.uid()))`.

---

### 2. 🔴 [CRÍTICO] Atualizações e Exclusões Diretas sem Verificação de Tenant em `SuppliersService.update()` e `remove()`

- **Severidade:** CRÍTICO
- **Categoria:** Segurança / Vulnerabilidade IDOR
- **Descrição:**
  Em `SuppliersService.update(uuid, supplier)` e `SuppliersService.remove(uuid)`, a instrução Supabase `supabase.from('suppliers').update(payload).eq('id', uuid)` filtra o registro unicamente por `id` (UUID), sem passar o contexto de `store_id` na cláusula `.eq()`. Se a RLS da tabela permitir escrita baseada apenas em perfil genérico autenticado sem validar o vínculo da loja na instrução ou na policy, um usuário mal-intencionado da Loja A pode enviar o UUID de um fornecedor da Loja B e alterá-lo/deletá-lo.
- **Arquivos / Tabelas / Funções Afetados:**
  - `src/services/suppliers.service.ts`
  - Tabela `public.suppliers`
- **Impacto:** Injeção/Modificação maliciosa de registros de terceiros (IDOR/BOLA).
- **Sugestão de Correção:**
  Passar sempre o parâmetro `storeId` no frontend e incluir `.eq('store_id', storeId)` em todas as mutações na tabela `suppliers`.

---

### 3. 🟠 [ALTO] Exposição e Leitura Insegura do Preço de Custo (`cost_price`) de Produtos

- **Severidade:** ALTO
- **Categoria:** Segurança / Vazamento de Informações Sensíveis
- **Descrição:**
  Embora migrações recentes tenham restringido a view/coluna de preço de custo (`cost_price`) no banco de dados para roles não-ADMIN, o serviço de produtos no frontend (`src/services/products.service.ts`) em certas rotas de busca de catálogo inclui seleções gerais de `products`. Se um operador de caixa (`CASHIER`) acessar visualizações do PDV, a requisição Supabase REST do frontend pode falhar ou vazar a margem de lucro e preço de custo se a RLS/GRANT não bloquear estritamente no nível da coluna/RPC.
- **Arquivos / Tabelas / Funções Afetados:**
  - `src/services/products.service.ts`
  - Tabela `public.products` (coluna `cost_price`)
  - `public.get_user_store_role(store_id)`
- **Impacto:** Exposição de margem comercial e custos operacionais para caixas e usuários sem privilégios administrativos.
- **Sugestão de Correção:**
  Centralizar o carregamento de produtos do PDV e inventário através de RPCs dedicadas (ex: `get_store_products_for_pdv`) que omitem o campo `cost_price` na projeção SQL para papéis `CASHIER`.

---

### 4. 🟠 [ALTO] Ausência de Rate Limiting e Proteção Contra DoS no Webhook do Mercado Pago (`mp-webhook`)

- **Severidade:** ALTO
- **Categoria:** Edge Functions / Segurança & Resiliência
- **Descrição:**
  A Edge Function `supabase/functions/mp-webhook/index.ts` realiza a validação de assinatura HMAC `x-signature` e verificação de replay window (60 segundos). Porém, requisições com cabeçalhos malformados ou inválidos consomem recursos de execução de CPU/Crypto antes de rejeitar a requisição no Supabase Edge Runtime. Se um atacante disparar flood de requisições POST para a URL do webhook, causará consumo excessivo de quota/créditos de Edge Functions e negação de serviço parcial.
- **Arquivos / Tabelas / Funções Afetados:**
  - `supabase/functions/mp-webhook/index.ts`
- **Impacto:** Esgotamento de limites de Edge Functions do Supabase / DoS.
- **Sugestão de Correção:**
  Implementar verificação rápida e prematura de tamanho/formato de payload e utilizar mecanismo de rate-limiting (Upstash Redis ou Supabase API Gateway rate-limiters) na rota pública do webhook.

---

### 5. 🟠 [ALTO] Tratamento de Idempotência e Lock Concorrente em Devoluções (`process_return`)

- **Severidade:** ALTO
- **Categoria:** Integridade de Dados / Concorrência
- **Descrição:**
  A RPC de devoluções `process_return` valida adequadamente a quantidade vendida e os créditos do cliente. Contudo, na devolução simultânea do mesmo item de venda por duas requisições paralelas (ex: clique duplo no frontend ou falha de rede com retry), não há lock explícito via `pg_advisory_xact_lock` sobre a venda/item como existe em `complete_sale`. Isso pode gerar *race condition* onde a verificação `quantidade devolvida <= quantidade vendida` é aprovada em duas transações paralelas simultâneas.
- **Arquivos / Tabelas / Funções Afetados:**
  - Função Pl/pgSQL `public.process_return(...)`
  - Migração `20260925165149_persistencia_devolucoes_creditos_20260925.sql`
- **Impacto:** Devolução duplicada de estoque e emissão dupla de crédito de cliente.
- **Sugestão de Correção:**
  Adicionar `PERFORM pg_advisory_xact_lock(hashtextextended('return:' || p_sale_id::text, 0));` e `FOR UPDATE` na seleção do item da venda no início da função `process_return`.

---

### 6. 🟡 [MÉDIO] Logs com Dados Sensíveis e Erros Genéricos em Edge Functions

- **Severidade:** MÉDIO
- **Categoria:** Edge Functions / Observabilidade & Privacidade (LGPD)
- **Descrição:**
  Em `supabase/functions/create-mp-pix/index.ts`, ao ocorrer falha na comunicação com o Mercado Pago ou no banco, o erro bruto e parâmetros de identificação (como CPF do cliente e detalhes de erro do provedor) são impressos diretamente via `console.error`.
- **Arquivos / Tabelas / Funções Afetados:**
  - `supabase/functions/create-mp-pix/index.ts`
  - `supabase/functions/mp-pix-reconciliation-worker/index.ts`
- **Impacto:** Vazamento de Dados Pessoais Identificáveis (PII / CPF) em logs do Supabase Dashboard, em desacordo parcial com as diretrizes da LGPD.
- **Sugestão de Correção:**
  Sanitizar dados nos logs, mascarando CPFs e IDs de clientes (ex: `***.456.789-**`) e registrando apenas mensagens de erro padronizadas e códigos de referência sanitizados.

---

### 7. 🟡 [MÉDIO] Inconsistência na Validação de Descontos e Parcelamento no PDV Frontend

- **Severidade:** MÉDIO
- **Categoria:** Frontend / Regras de Negócio
- **Descrição:**
  Enquanto a RPC `complete_sale` valida rigorosamente no banco que o desconto em percentual deve estar entre 0 e 100% e as parcelas entre 1 e 24, a UI do PDV (`src/components/pdv/CheckoutModal.tsx` e `PdvView.tsx`) permite digitação livre nos campos numéricos sem aplicar restrição imediata no evento `onChange` antes de disparar a chamada RPC.
- **Arquivos / Tabelas / Funções Afetados:**
  - `src/components/pdv/CheckoutModal.tsx`
  - `src/components/pdv/PdvView.tsx`
- **Impacto:** Má experiência do usuário (UX) com mensagens de erro genéricas retornadas da RPC em vez de validação amigável e preventiva em tempo real na interface.
- **Sugestão de Correção:**
  Aplicar validações Zod ou schema preventivo no frontend utilizando `src/lib/validation.ts` e bloquear valores negativos ou percentuais > 100% no campo input do Modal de Checkout.

---

### 8. 🟡 [MÉDIO] Discrepâncias de Tipagem TypeScript vs Schema do Supabase

- **Severidade:** MÉDIO
- **Categoria:** Manutenibilidade / TypeScript
- **Descrição:**
  Foram identificados 26 avisos (warnings) do ESLint e TypeScript sobre variáveis declaradas mas não utilizadas e hooks com arrays de dependências incompletos (ex: em `DashboardView.tsx`, `RevenueChart.tsx`, `TopProductsChart.tsx`, `PdvView.tsx`).
- **Arquivos / Tabelas / Funções Afetados:**
  - `src/components/dashboard/RevenueChart.tsx`
  - `src/components/dashboard/TopProductsChart.tsx`
  - `src/components/pdv/PdvView.tsx`
  - `src/components/finance/FinanceView.tsx`
- **Impacto:** Possíveis loops de re-renderização infinitos ou comportamentos desatualizados de componentes React devido a dependências de hooks omitidas.
- **Sugestão de Correção:**
  Refatorar os hooks `useEffect` envoltos com `useCallback` apropriado e remover importações/variáveis não utilizadas para zerar avisos de linter.

---

### 9. 🔵 [BAIXO] Otimização de Performance e Índices Secundários no Banco

- **Severidade:** BAIXO
- **Categoria:** Banco de Dados / Performance
- **Descrição:**
  Queries analíticas da tela de relatórios e exportações de dados LGPD realizam buscas ordenadas por campos de data como `created_at` e `status` combinados com `store_id`. A maioria das tabelas principais possui índice em `store_id`, porém índices compostos para filtros de intervalo de datas (ex: `(store_id, created_at DESC)`) em `financial_transactions` e `customer_credit_movements` reduzem o tempo de varredura sob volumes massivos de dados.
- **Arquivos / Tabelas / Funções Afetados:**
  - Tabelas `financial_transactions`, `customer_credit_movements`, `privacy_requests`
- **Impacto:** Lentidão progressiva em dashboards e relatórios consolidados em lojas com grande histórico de movimentações.
- **Sugestão de Correção:**
  Adicionar migração com índices compostos ordenados:
  `CREATE INDEX IF NOT EXISTS idx_fin_trans_store_created ON financial_transactions (store_id, created_at DESC);`

---

### 10. 🔵 [BAIXO] Limpeza de Código Morto e Refatoração do Header/Sidebar

- **Severidade:** BAIXO
- **Categoria:** Arquitetura / Manutenibilidade
- **Descrição:**
  Existem trechos de código com variáveis comentadas e utilitários não utilizados declarados em `src/services/store.service.ts` (`Store` type import) e `src/components/inventory/InventoryView.tsx`.
- **Arquivos / Tabelas / Funções Afetados:**
  - `src/services/store.service.ts`
  - `src/components/inventory/InventoryView.tsx`
  - `src/components/suppliers/SupplierForm.tsx`
- **Impacto:** Sujeira no código-fonte e pequenos ruídos durante revisões de código.
- **Sugestão de Correção:**
  Realizar refatoração preventiva e remoção dos trechos e dependências sem uso no repositório.

---

## 📋 CHECKLIST DE PRONTIDÃO PARA PRODUÇÃO

- [x] Transações atômicas de venda e baixa de estoque via RPC (`complete_sale`)
- [x] Proteção contra escalonamento de privilégios (`role` RLS & `SECURITY DEFINER` com `search_path`)
- [x] Chaves de idempotência em vendas PDV e PIX
- [x] Reconciliação automatizada de pagamentos PIX Mercado Pago
- [ ] Isolamento de tenant total em `SuppliersService` (Pendente - Item 1 & 2)
- [ ] Lock transacional de concorrência em devoluções (Pendente - Item 5)
- [ ] Zerar warnings do Linter/Hooks no Frontend (Pendente - Item 8)

---

## 🚀 PRÓXIMOS PASSOS RECOMENDADOS

1. Criar branch dedicada para aplicação das correções dos itens **CRÍTICOS** (Isolamento de Fornecedores) e **ALTOS** (Lock de Devoluções e Exposição de Custos).
2. Aplicar ajustes no `SuppliersService` e migração RLS correspondente.
3. Submeter Pull Request mantendo todos os testes automatizados verdes (`npm run test:all`).
