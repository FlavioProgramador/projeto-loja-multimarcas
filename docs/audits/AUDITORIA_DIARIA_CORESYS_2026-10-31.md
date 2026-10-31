# Relatório de Auditoria Técnica Diária — CoreSys (VESTRA ERP/PDV)
**Data:** 31 de Outubro de 2026
**Responsável:** Engenheiro de Software Sênior (Auditoria Técnica CoreSys)
**Repositório:** FlavioProgramador/projeto-loja-multimarcas

---

## 1. Resumo Executivo

Nesta auditoria técnica diária foi realizada uma análise minuciosa de toda a base de código do CoreSys, cobrindo:
- **Segurança da Informação e Controle de Acesso:** Avaliação de vulnerabilidades em dependências, integridade de políticas RLS (Row Level Security), autorização em funções `SECURITY DEFINER` e vetores de IDOR/BOLA.
- **Isolamento Multi-Tenant:** Verificação de integridade referencial por loja (`store_id`), vazamento de dados entre inquilinos e escopo de operações em estoque, clientes, produtos e financeiro.
- **Consistência Frontend vs. Backend (Supabase):** Auditoria de contratos de chamadas RPC, queries diretas nas tabelas e desvios de privilégios.
- **Qualidade, Estabilidade e Resiliência:** Testes unitários com Vitest, checagens estáticas TypeScript (`tsc`), linting ESLint e integridade arquitetural.

Conforme a diretriz de auditoria técnica do CoreSys, **não foram realizadas alterações automáticas no código-fonte nesta etapa**. Os problemas encontrados foram rigorosamente catalogados, avaliados quanto ao risco e detalhados com as respectivas propostas de remediação.

---

## 2. Status Geral do Sistema

- **TypeScript Typecheck:** Aprovado (`npm run typecheck` sem erros).
- **Testes Unitários:** Aprovados (11 arquivos de teste, 39 asserções aprovadas com Vitest).
- **ESLint:** Aprovado com 26 warnings de variáveis não utilizadas / hooks `exhaustive-deps` (limite de tolerância mantido abaixo de 50).
- **Vite Build:** Aprovado (`npm run build` gerando artefatos de produção em 8.96s).
- **Vulnerabilidades de Dependências (`npm audit`):** 21 vulnerabilidades identificadas (16 moderadas, 4 altas, 1 crítica no `dompurify`).

---

## 3. Achados de Auditoria Classificados por Severidade

---

### [CRÍTICO] SEC-01: Vulnerabilidade de bypass e mutação em `dompurify` (<= 3.4.16)
- **Severidade:** CRÍTICO
- **Categoria:** Segurança de Dependências / Cross-Site Scripting (XSS)
- **Arquivos/Componentes Afetados:** `package.json`, `package-lock.json`, dependência `dompurify` (utilizada em relatórios e impressões de cupom)
- **Descrição do Problema:**
  O relatório de auditoria de dependências (`npm audit`) revelou vulnerabilidades críticas em versões do `dompurify` (GHSA-cg2g-xh64-v4q7, GHSA-mrv2-3pqr-j5jr, GHSA-c6gr-qvv4-5v3f). Estas falhas permitem contornar a sanitização através de mutações em template expressions no Shadow DOM e hooks incorretos de remoção de nós, abrindo margem para XSS caso conteúdo não confiável seja manipulado antes de renderização ou geração de relatórios/impressão (`src/lib/pdf/reports-pdf.ts`, `src/components/pdv/ReceiptPrinter.tsx`).
- **Sugestão de Correção:**
  Atualizar a biblioteca `dompurify` para a versão segura mais recente via patch direcionado no `package.json` / `npm audit fix`, validando os módulos de impressão e relatórios.

---

### [ALTO] SEC-02: Bypass do RPC `manage_product` e inserção direta no `InventoryService.registerStockEntry`
- **Severidade:** ALTO
- **Categoria:** Isolamento Multi-Tenant / Violação de RBAC / Integridade de Dados
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivo: `src/services/inventory.service.ts` (linhas 110-150)
  - Tabelas: `public.products`, `public.product_variants`, `public.brands`, `public.categories`
  - Função RPC associada: `public.manage_product`
- **Descrição do Problema:**
  Quando um usuário autenticado registra entrada de estoque para um novo produto que ainda não existe no catálogo, o método `InventoryService.registerStockEntry` executa `supabase.from('products').insert(...)` e `supabase.from('product_variants').insert(...)` diretamente pelo client, em vez de invocar a RPC `manage_product`.
  1. A tabela `products` possui restrição de coluna em `cost_price` (com `REVOKE SELECT (cost_price)` para usuários normais), porém ao usar `.insert(...).select().single()`, o client solicita todas as colunas ou tenta gravar o campo diretamente.
  2. A criação de produtos deve ser restrita estritamente a papéis autorizados (`ADMIN` e `MANAGER`) através da RPC validada `manage_product`, que valida limites de catálogo e higienização de nomes e SKUs.
  3. Ao realizar inserts diretos no client antes de chamar `register_stock_entry`, uma falha de rede intermediária pode deixar produtos e variantes órfãos sem estoque associado em nenhuma loja.
- **Sugestão de Correção:**
  Refatorar `InventoryService.registerStockEntry` para que o fluxo de criação de novos produtos e variantes seja orquestrado via `ProductsService.create` (que utiliza a RPC `manage_product`) ou unificar a criação dentro da própria transação da RPC `register_stock_entry`, eliminando `supabase.from('products').insert` direto do client.

---

### [ALTO] SEC-03: Vulnerabilidades de Alto Risco em `undici`, `vite` e `body-parser`
- **Severidade:** ALTO
- **Categoria:** Segurança da Cadeia de Suprimentos (Supply Chain)
- **Arquivos/Componentes Afetados:** `package.json`, `package-lock.json`
- **Descrição do Problema:**
  O `npm audit` identificou avisos de alta severidade:
  - `undici` (8.0.0 - 8.12.1): DoS por consumo descontrolado de memória no parser de EventSource e desvio de verificação TLS (GHSA-4qv8-2p9j-2685, GHSA-2m5v-pch6-74hx).
  - `vite` (<=6.4.3): execução arbitrária e contorno de `server.fs.allow` no launch-editor em ambientes Windows e middlewares customizados (GHSA-698v-4r3x-3vcv, GHSA-rq7h-c2jc-7f22).
  - `body-parser` (<1.20.9): DoS via trailing bytes em payloads compactados.
- **Sugestão de Correção:**
  Aplicar atualização das dependências de desenvolvimento e runtime para suas revisões corrigidas através de testes de regressão de build e preview.

---

### [ALTO] TEN-01: Potencial IDOR/BOLA e Ausência de Escopo de Loja nas Mutações de Fornecedores e Clientes
- **Severidade:** ALTO
- **Categoria:** Isolamento Multi-Tenant / Controle de Acesso (IDOR/BOLA)
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivos: `src/services/suppliers.service.ts` (linhas 65-85), `src/services/customers.service.ts` (linhas 485-505)
  - Tabelas: `public.suppliers`, `public.customers`
- **Descrição do Problema:**
  1. No `SuppliersService.update` e `SuppliersService.remove`, as operações realizam `.update(...).eq('id', uuid)` sem incluir validação ou filtro do tenant (`store_id`), e a tabela `public.suppliers` não possui coluna `store_id` (opera globalmente apenas por role de sistema `ADMIN`/`MANAGER`).
  2. No `CustomersService.update` e `CustomersService.remove`, o método recebe apenas o `uuid` do cliente, executando `.update(...).eq('id', uuid)` sem enviar `store_id` como condição explícita no filtro do client (`.eq('store_id', storeId)`). Embora a RLS filtre por `has_store_access(store_id)`, a falta do filtro explícito no frontend aumenta o risco de mutação acidental caso permissões sofram desvio ou em ambientes multi-loja onde o usuário pertença a mais de uma loja.
- **Sugestão de Correção:**
  - Em `CustomersService.update` e `remove`, exigir o parâmetro obrigatório `storeId` e aplicar `.eq('store_id', storeId)` em conjunto com `.eq('id', uuid)`.
  - Avaliar a introdução de `store_id` na tabela `suppliers` com chave composta ou associação por loja (`store_suppliers`), garantindo que uma loja não altere nem desative fornecedores cadastrados por outra loja.

---

### [MÉDIO] ARC-01: Discrepância na ordem dos parâmetros da RPC `register_stock_entry`
- **Severidade:** MÉDIO
- **Categoria:** Inconsistência de Contrato RPC Frontend vs. Supabase
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivo Frontend: `src/services/inventory.service.ts` (linha 153)
  - Migrações: `supabase/migrations/20260925165225_rpcs_multiloja_vendas_estoque_20260925_v2.sql`, `supabase/migrations/20260929000000_coresys_audit_fixes.sql`
  - Função RPC: `public.register_stock_entry(uuid, integer, numeric, text, uuid, text, text)`
- **Descrição do Problema:**
  Na assinatura SQL da função `register_stock_entry`, os parâmetros posicionais são:
  `(p_variant_id, p_quantity, p_unit_cost, p_product_name, p_store_id, p_reason, p_type)`.
  No frontend, o Supabase SDK utiliza chamada nomeada:
  `{ p_store_id, p_variant_id, p_quantity, p_unit_cost, p_product_name }`.
  Embora o PostgreSQL resolva parâmetros nomeados via JSON-RPC, a falta de padronização na ordem dos parâmetros nos arquivos de teste e nas definições do TypeScript pode ocasionar falhas sutis caso ocorra fallback para chamada posicional ou alteração na assinatura.
- **Sugestão de Correção:**
  Padronizar a assinatura do objeto no frontend e alinhar a interface em `src/types/database.ts` ou criar um wrapper tipado estrito no `InventoryService`.

---

### [MÉDIO] CODE-01: Warnings de React Hooks (`exhaustive-deps`) em Telas Críticas (PDV, Financeiro, Dashboard)
- **Severidade:** MÉDIO
- **Categoria:** Qualidade de Código / Risco de Estado Desatualizado (Stale State)
- **Arquivos Afetados:**
  - `src/components/pdv/PdvView.tsx` (linha 235: `handleConfirmSale` recriado em cada render)
  - `src/components/finance/FinanceView.tsx` (linhas 84, 86: `loadTransactions` e `loadExpenses`)
  - `src/components/movements/MovementsView.tsx` (linha 81: `loadMovements`)
  - `src/components/dashboard/RevenueChart.tsx` (linha 106)
  - `src/components/dashboard/TopProductsChart.tsx` (linha 98)
- **Descrição do Problema:**
  Diversos componentes essenciais possuem avisos de `exhaustive-deps`. No `PdvView.tsx`, `handleConfirmSale` causa disparos sucessivos ou risco de execução com referências obsoletas de estado de carrinho e loja, o que pode levar a comportamentos imprevisíveis durante o checkout se o usuário interagir rapidamente.
- **Sugestão de Correção:**
  Envolver `handleConfirmSale` e as funções de carregamento (`loadTransactions`, `loadMovements`) em `useCallback` com dependências estáveis, garantindo previsibilidade no ciclo de vida dos componentes.

---

### [BAIXO] LINT-01: Variáveis não utilizadas e exportações mistas com Fast Refresh
- **Severidade:** BAIXO
- **Categoria:** Manutenibilidade e Limpeza de Código
- **Arquivos Afetados:**
  - Contextos: `AuthContext.tsx`, `CartContext.tsx`, `StoreContext.tsx`, `ThemeContext.tsx`
  - Componentes: `InventoryView.tsx`, `NewProductModal.tsx`, `StockEntryModal.tsx`, `NewReturnModal.tsx`, `SupplierForm.tsx`
  - Serviços: `src/services/store.service.ts`
- **Descrição do Problema:**
  Existem 26 avisos reportados pelo ESLint relacionados a ícones Lucide importados e não renderizados, funções de formatação declaradas localmente e não utilizadas (`formatPhone`), além de múltiplos contextos que exportam constantes e hooks auxiliares junto aos componentes provedores, o que prejudica a eficiência do Fast Refresh do Vite.
- **Sugestão de Correção:**
  Remover imports desnecessários, prefixar variáveis propositalmente não utilizadas com `_` e segregar helpers/tipos dos arquivos que contêm componentes React.

---

## 4. Auditoria de Multi-Tenancy e Supabase RLS

1. **Isolamento de Dados por Loja:**
   - As tabelas de transações e movimentações (`sales`, `sale_items`, `inventory_movements`, `store_inventory`, `financial_transactions`, `customers`) estão devidamente amarradas à chave estrangeira `store_id`.
   - As RPCs vitais (`complete_sale`, `create_mp_pix_sale`, `cancel_sale`, `process_return`) validam estritamente o papel do usuário na loja correspondente através do helper `get_user_store_role(store_id)` e exigem que a loja e o perfil estejam ativos (`is_active = true`).
2. **Funções `SECURITY DEFINER` e Search Path:**
   - As funções críticas foram atualizadas com `SET search_path = public`, evitando vetores de sequestro de caminho de busca (search_path injection).
   - O privilégio `EXECUTE` foi revogado da role `anon` e `PUBLIC` e concedido estritamente a `authenticated`.
   - As checagens de role nas RPCs tratam explicitamente o caso de valor nulo (`v_role IS NULL OR v_role NOT IN (...)`), operando em modo fail-closed seguro.
3. **Idempotência de Vendas:**
   - O mecanismo de idempotência em `sale_idempotency` garante unicidade tripla `(idempotency_key, store_id, user_id)` com trava concorrente via `pg_advisory_xact_lock`, prevenindo duplicações mesmo sob conexões instáveis de PDV.

---

## 5. Recomendações e Próximos Passos Priorizados

1. **Segurança de Pacotes:** Atualizar com prioridade as dependências com avisos abertos (`dompurify`, `undici`, `vite`).
2. **Refatoração no Cadastro de Produtos via PDV/Estoque:** Ajustar `InventoryService.registerStockEntry` para eliminar inserções diretas em `products` e `product_variants`, garantindo o uso exclusivo da RPC `manage_product`.
3. **Escopo Explícito Multi-Tenant em Clientes e Fornecedores:** Garantir que mutações em `CustomersService` e `SuppliersService` exijam o contexto da loja ativa.
4. **Estabilização de Hooks no PDV:** Envolver `handleConfirmSale` em `useCallback` para sanar o warning de ciclo de renderização no caixa.
5. **Higienização de Linters:** Tratar os 26 warnings do ESLint para alcançar 0 warnings.
