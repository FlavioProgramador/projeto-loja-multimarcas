# 📋 Relatório de Auditoria Técnica Diária — CoreSys (Vestra ERP)

**Data:** 20 de Outubro de 2026
**Repositório:** FlavioProgramador/projeto-loja-multimarcas
**Auditor:** Engenharia de Software Sênior (CoreSys Audit)
**Status Geral:** Análise Concluída — 0 Críticos, 1 Alto, 3 Médios, 3 Baixos

---

##  EXECUTIVE SUMMARY & RESUMO EXECUTIVO

Esta auditoria técnica diária avaliou a integridade e segurança do ecossistema **CoreSys**, abrangendo:
- Isolamento Multi-Tenant e Row Level Security (RLS) no Supabase.
- Funções `SECURITY DEFINER` e prevenção contra elevação de privilégios e IDOR/BOLA.
- Consistência entre serviços do Frontend React/TypeScript e RPCs do PostgreSQL.
- Tratamento de erros, idempotência, integridade de estoque e desempenho de queries.

Após as recentes remediações de segurança (incluindo a migração `20261003000000_coresys_audit_final_remediation.sql`), as RPCs de vendas e devoluções foram blindadas com `SET search_path = public`, controle estrito de `auth.uid()` e revogação de permissões para a role `anon`. No entanto, foram identificados pontos de atenção na camada de fornecedores e consultas no frontend.

---

## 📊 TABELA DE ACHADOS DA AUDITORIA

| ID | Severidade | Categoria | Descrição Sucinta | Arquivos / Tabelas / Funções Afetados |
|---|---|---|---|---|
| **AUD-01** | **ALTO** | Multi-tenant / RLS | Tabela `suppliers` sem isolamento por loja (`store_id`) | `public.suppliers`, `src/services/suppliers.service.ts` |
| **AUD-02** | **MÉDIO** | Lógica / PDV | Ocultação não intencional de produtos sem registro prévio em `store_inventory` | `src/services/products.service.ts` (`getAll`), `public.store_inventory` |
| **AUD-03** | **MÉDIO** | Segurança / Frontend | Operações de escrita em `customers` e `fixed_expenses` sem filtro explícito de `store_id` na query cliente | `src/services/customers.service.ts`, `src/services/finance.service.ts` |
| **AUD-04** | **MÉDIO** | Resiliência / Idempotência | Armazenamento de chaves de idempotência de checkout apenas em memória JS (`Map`) | `src/services/sales.service.ts` (`pendingCheckoutKeys`) |
| **AUD-05** | **BAIXO** | Frontend / Qualidade | Warnings de React Hooks (`useEffect`) e variáveis/importações não utilizadas | `RevenueChart.tsx`, `TopProductsChart.tsx`, `FinanceView.tsx`, `MovementsView.tsx`, `PdvView.tsx` |
| **AUD-06** | **BAIXO** | Performance | Buscas com wildcard `ILIKE '%term%'` na tabela `customers` sem índice de trigrama | `src/services/customers.service.ts`, `public.customers` |
| **AUD-07** | **BAIXO** | Arquitetura | Tratamento genérico de erros e mensagens brutas do Supabase exibidas no frontend | `src/services/inventory.service.ts`, `src/services/finance.service.ts` |

---

## 🔍 DETALHAMENTO DOS ACHADOS DE AUDITORIA

### AUD-01: Tabela `suppliers` sem isolamento por loja (`store_id`)
- **Severidade:** **ALTO**
- **Categoria:** Arquitetura Multi-Tenant / Segurança RLS
- **Descrição do Problema:**
  A tabela `public.suppliers` não possui a coluna `store_id`. As políticas RLS vigentes concedem acesso global (`USING (public.current_user_role() IN ('ADMIN', 'MANAGER'))`) a qualquer usuário autenticado com perfil de gestor. Como consequência, fornecedores cadastrados por uma loja ficam visíveis e modificáveis por usuários de outras lojas no sistema multi-tenant.
- **Componentes Afetados:**
  - Tabela do Banco: `public.suppliers`
  - Serviço Frontend: `src/services/suppliers.service.ts` (`getAll`, `create`, `update`, `remove`)
  - Migrações: `20260101000000_setup.sql`, `20260828000001_hardening_rls.sql`
- **Sugestão de Correção:**
  1. Criar migração SQL adicionando a coluna `store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT`.
  2. Atualizar as políticas RLS de `suppliers` para utilizar `has_store_access(store_id)` no `SELECT` e `get_user_store_role(store_id) = ANY(ARRAY['ADMIN','MANAGER'])` para modificações.
  3. Atualizar `SuppliersService` para repassar e filtrar por `storeId` em todas as requisições do frontend.

---

### AUD-02: Produtos sem registro em `store_inventory` ficam ocultos no PDV
- **Severidade:** **MÉDIO**
- **Categoria:** Regra de Negócio / Inconsistência de Dados
- **Descrição do Problema:**
  No método `ProductsService.getAll(storeId)`, a query realiza um filtro no frontend via `.filter(product => product.product_variants?.some(variant => variant.is_active && variant.store_inventory?.some(inventory => inventory.store_id === storeId)))`. Se um produto ou variação for cadastrado mas ainda não possuir uma linha correspondente na tabela `store_inventory` para aquela loja específica, o produto torna-se invisível na listagem de estoque e no PDV.
- **Componentes Afetados:**
  - Serviço Frontend: `src/services/products.service.ts`
  - Função RPC: `public.manage_product`
  - Tabela: `public.store_inventory`
- **Sugestão de Correção:**
  1. Garantir que a RPC `manage_product` crie automaticamente a entrada em `store_inventory` com quantidade `0` para todas as lojas ativas do tenant quando um novo produto/variação for cadastrado.
  2. Ajustar `ProductsService.getAll` para listar variações existentes mesmo se o registro de `store_inventory` estiver ausente, assumindo quantidade `0`.

---

### AUD-03: Atualizações no frontend sem cláusula explícita de `store_id`
- **Severidade:** **MÉDIO**
- **Categoria:** Defesa em Profundidade / Prevenção contra IDOR
- **Descrição do Problema:**
  Nos serviços `CustomersService.update`, `CustomersService.remove` e `FinanceService.toggleExpensePaid`, as queries de atualização executam instruções como `.from('customers').update(payload).eq('id', uuid)` sem incluir `.eq('store_id', storeId)`. Embora as políticas de RLS no banco restrinjam a alteração caso o usuário não pertença à loja do registro, a ausência do filtro no lado do cliente viola a diretriz de defesa em profundidade.
- **Componentes Afetados:**
  - `src/services/customers.service.ts`
  - `src/services/finance.service.ts`
- **Sugestão de Correção:**
  Exigir `storeId` nos métodos de atualização/remoção dos serviços e adicionar `.eq('store_id', storeId)` em todas as chamadas `update` e `delete` do cliente Supabase.

---

### AUD-04: Gerenciamento em memória de chaves de idempotência no checkout
- **Severidade:** **MÉDIO**
- **Categoria:** Resiliência / Tratamento de Estado
- **Descrição do Problema:**
  No arquivo `src/services/sales.service.ts`, o mapa `pendingCheckoutKeys` é mantido como uma variável local no escopo do módulo JavaScript (`const pendingCheckoutKeys = new Map<string, string>();`). Caso a página seja recarregada ou ocorram navegações durante uma requisição lenta, o estado local é perdido. Embora a RPC `complete_sale` possua tabela de idempotência (`sale_idempotency`) que impede duplicações no banco, a perda do mapa no cliente pode resultar em retrabalho de requisição ou experiência inconsistente no PDV.
- **Componentes Afetados:**
  - `src/services/sales.service.ts`
- **Sugestão de Correção:**
  Persistir chaves de idempotência ativas no `sessionStorage` ou depender puramente das chaves geradas e gerenciadas no fluxo de estado do formulário de checkout/cart.

---

### AUD-05: Warnings de ESLint e React Hooks Dependencies
- **Severidade:** **BAIXO**
- **Categoria:** Qualidade de Código e Manutenibilidade
- **Descrição do Problema:**
  O comando `npm run lint` reporta 26 avisos (warnings) no projeto. Entre eles:
  - Dependências ausentes em `useEffect` nos gráficos `RevenueChart.tsx` e `TopProductsChart.tsx`.
  - Ausência de `useCallback` em `handleConfirmSale` dentro do `PdvView.tsx`.
  - Variáveis e ícones importados e não utilizados em `InventoryView.tsx`, `NewProductModal.tsx`, `StockEntryModal.tsx` e `NewReturnModal.tsx`.
- **Componentes Afetados:**
  - `src/components/dashboard/RevenueChart.tsx`
  - `src/components/dashboard/TopProductsChart.tsx`
  - `src/components/pdv/PdvView.tsx`
  - `src/components/inventory/InventoryView.tsx`
  - `src/components/returns/NewReturnModal.tsx`
- **Sugestão de Correção:**
  Refatorar os hooks com `useCallback`/dependências corretas e remover as variáveis/importações não utilizadas para zerar avisos de lint.

---

### AUD-06: Consulta de busca de clientes sem índice de trigrama
- **Severidade:** **BAIXO**
- **Categoria:** Desempenho do Banco de Dados
- **Descrição do Problema:**
  A busca de clientes em `CustomersService.search` utiliza cláusulas `ILIKE` com wildcards bilaterais (`%padrao%`) nos campos `name`, `cpf` e `phone`. Em bancos relacionais sem índice GIN/pg_trgm, essa padrão força varreduras completas de tabela (Seq Scan), prejudicando a resposta à medida que o cadastro de clientes cresce.
- **Componentes Afetados:**
  - `src/services/customers.service.ts`
  - Tabela: `public.customers`
- **Sugestão de Correção:**
  Habilitar a extensão `pg_trgm` (se não habilitada) e criar um índice `GIN` trgm nos campos `name`, `cpf` e `phone` da tabela `public.customers`.

---

### AUD-07: Exibição de mensagens de erro brutas do banco de dados na UI
- **Severidade:** **BAIXO**
- **Categoria:** Tratamento de Erros e Experiência do Usuário (UX)
- **Descrição do Problema:**
  Ao capturar exceções das chamadas Supabase RPC / REST, alguns serviços repassam `error.message` diretamente para a interface. Em caso de falhas de constraint de banco de dados ou exceções internas do PostgreSQL, mensagens em inglês ou técnicas são apresentadas ao usuário final no PDV/Financeiro.
- **Componentes Afetados:**
  - `src/services/inventory.service.ts`
  - `src/services/sales.service.ts`
  - `src/services/finance.service.ts`
- **Sugestão de Correção:**
  Mapear os códigos de erro do PostgreSQL (ex: `P0001`, `23505`, `23503`) para mensagens amigáveis e traduzidas em um helper centralizado de tratamento de erros.

---

## 🎯 CHECKLIST DE VERIFICAÇÃO TÉCNICA

- [x] **Segurança RLS e Multi-tenant:** Verificado. RPCs críticas hardened com `SET search_path = public` e verificação de `has_store_access`. Ponto de atenção reportado na tabela `suppliers` (AUD-01).
- [x] **Injeção de SQL e IDOR:** Nenhuma query dinâmica vulnerável identificada no backend PL/pgSQL. Recomendado adicionar filtros explícitos de `store_id` nas requisições do frontend (AUD-03).
- [x] **Integração de Testes e Tipagem:** `npm run typecheck` executado sem erros. `npm test` executado com 100% dos 11 arquivos de teste aprovados (39 testes).
- [x] **Desempenho e Integridade:** Registros de idempotência, estoque por loja e transações financeiras operando de forma atômica.

---

**Relatório emitido em:** 20/10/2026 — CoreSys Engineering Audit Team
