# Relatório de Auditoria Técnica Diária — CoreSys (Vestra ERP/PDV)
**Data:** 03 de Outubro de 2026
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Auditor:** Engenheiro de Software Sênior (CoreSys Tech Audit)

---

## 1. RESUMO EXECUTIVO

Esta auditoria técnica diária avaliou o estado atual do código-fonte (frontend React/TypeScript, backend Supabase/Edge Functions em Deno e banco PostgreSQL/RLS/migrations).

A arquitetura passou por importantes evoluções de endurecimento e isolamento multi-tenant (com migrações recentes estabelecendo `user_store_access`, `store_inventory`, e funções RPC com `SECURITY DEFINER` travadas com `SET search_path = public`). Contudo, identifiou-se um conjunto de inconsistências, vetores de BOLA/IDOR no client-side, compartilhamento global de fornecedores/marcas e gargalos de performance que exigem remediação prioritária.

---

## 2. ACHADOS POR SEVERIDADE

### 🔴 SEVERIDADE: CRÍTICO

#### CRIT-01 — Falta de Isolamento Multi-Tenant na Tabela de Fornecedores (`suppliers`)
- **Descrição:** A tabela `suppliers` não possui a coluna `store_id` nem constraint de pertencimento a tenant. A política de RLS em `suppliers` concede permissão de `SELECT` a qualquer usuário autenticado (`TO authenticated USING (true)`). No frontend, `SuppliersService.getAll()` busca todos os fornecedores sem qualquer filtro por loja. Com isso, usuários de uma loja conseguem visualizar, editar e excluir fornecedores de qualquer outra loja cadastrada no sistema.
- **Arquivos/Tabelas/Funções Afetados:**
  - Tabela: `public.suppliers`
  - Arquivo SQL: `supabase/migrations/20260101000000_setup.sql`, `supabase/migrations/20260828000001_hardening_rls.sql`
  - Service: `src/services/suppliers.service.ts` (`getAll`, `create`, `update`, `remove`)
- **Sugestão de Correção:**
  1. Adicionar coluna `store_id UUID NOT NULL REFERENCES public.stores(id)` na tabela `suppliers`.
  2. Atualizar RLS de `suppliers` para restrigir leitura/escrita com `store_id IN (SELECT store_id FROM public.user_store_access WHERE user_id = auth.uid())` ou via `public.get_user_store_role(store_id)`.
  3. Atualizar `SuppliersService` para obrigatoriamente exigir `storeId` em todas as operações (`getAll`, `create`, `update`, `remove`).

#### CRIT-02 — Vulnerabilidade IDOR / BOLA em Atualização e Exclusão de Clientes (`CustomersService`)
- **Descrição:** Os métodos `CustomersService.update` e `CustomersService.remove` executam mutações diretas no Supabase (`UPDATE customers SET ... WHERE id = uuid`) identificando o registro apenas pela chave primária `id`, sem incluir a cláusula de escopo `.eq('store_id', storeId)`. Se a política RLS permitir `UPDATE` com base apenas no papel global do usuário sem validar se o cliente pertence à loja ativa do contexto, um usuário mal-intencionado autenticado pode manipular ou desativar clientes de outras lojas enviando seus UUIDs.
- **Arquivos/Tabelas/Funções Afetados:**
  - Tabela: `public.customers`
  - Service: `src/services/customers.service.ts` (métodos `update` e `remove`)
- **Sugestão de Correção:**
  1. No frontend, alterar os métodos para passar o `storeId` ativo e forçar `.eq('id', uuid).eq('store_id', storeId)`.
  2. No Supabase, garantir que a policy de `UPDATE` na tabela `customers` exija `public.get_user_store_role(store_id) IS NOT NULL`.

#### CRIT-03 — Escrita Direta no Cliente ao Criar Produtos/Estoque Bypassando RPCs de Segurança (`InventoryService.registerStockEntry`)
- **Descrição:** No método `InventoryService.registerStockEntry`, quando um produto ou variação não é localizado no banco, o código faz `INSERT` direto via cliente nas tabelas `products`, `product_variants`, `brands` e `categories`, em vez de invocar as RPCs consolidadas de gerenciamento de catálogo (`manage_product`). As regras de hardening de multi-tenant restrigem writes diretos no client para prevenir inconsistência entre `product_variants` e `store_inventory`.
- **Arquivos/Tabelas/Funções Afetados:**
  - Tabelas: `products`, `product_variants`, `brands`, `categories`
  - Service: `src/services/inventory.service.ts` (linhas ~90-130)
- **Sugestão de Correção:**
  - Refatorar `InventoryService.registerStockEntry` para utilizar exclusivamente a RPC `manage_product` para criação/atualização de produtos e marcas, ou tratar a criação de produto diretamente dentro da RPC `register_stock_entry` no banco PostgreSQL.

---

### 🟠 SEVERIDADE: ALTO

#### ALTO-01 — Cache Local Não Criptografado e Sem Isolamento Multi-Tenant em `localStorage`
- **Descrição:** O `StoreContext.tsx` persiste coleções de dados (`products`, `suppliers`, `fixedExpenses`, `notifications`) em `localStorage` sob chaves genéricas (`erp_products`, `erp_suppliers`, etc.). Além de expor PII/dados comerciais sensíveis sem criptografia no navegador, ao trocar de loja ou usuário na mesma máquina, o cache pode vazar dados de outro tenant ou ser sobrescrito por arrays vazios `[]` durante a inicialização do estado do React.
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivo: `src/contexts/StoreContext.tsx` (linhas 47-52, 81-84)
- **Sugestão de Correção:**
  - Remover a sincronização automática de produtos, fornecedores e despesas no `localStorage` quando o Supabase estiver configurado (`isSupabaseConfigured = true`). Para o modo local (demo), escopar as chaves por `userId_storeId`.

#### ALTO-02 — Full Table Scan e Ineficiência de Filtro Client-Side em `ProductsService.getAll`
- **Descrição:** O método `ProductsService.getAll(storeId)` realiza uma consulta global na tabela `products` selecionando todas as variantes e todos os registros de `store_inventory` do banco de dados, e só então aplica um `.filter()` em memória JavaScript no cliente para verificar se existe estoque na loja informada. Conforme o catálogo da rede cresce, essa query gera varreduras completas ($O(N)$), transferências desnecessárias de dados pela rede e potencial vazamento de catálogo de outras lojas antes do filtro no cliente.
- **Arquivos/Tabelas/Funções Afetados:**
  - Tabela: `public.products`, `public.product_variants`, `public.store_inventory`
  - Service: `src/services/products.service.ts` (método `getAll`)
- **Sugestão de Correção:**
  - Refatorar a query para realizar `JOIN` e filtrar no Postgres por `store_inventory.store_id = p_store_id`, ou criar uma RPC/View otimizada `get_store_catalog(p_store_id uuid)`.

#### ALTO-03 — Falta de Validação de Tenant na Alternância de Pagamento de Despesas (`FinanceService.toggleExpensePaid`)
- **Descrição:** O método `FinanceService.toggleExpensePaid(uuid, currentPaidState)` atualiza a tabela `fixed_expenses` buscando apenas por `id = uuid`. Não há validação de `store_id` na query, dependendo exclusivamente do RLS do banco.
- **Arquivos/Tabelas/Funções Afetados:**
  - Tabela: `public.fixed_expenses`
  - Service: `src/services/finance.service.ts` (método `toggleExpensePaid`)
- **Sugestão de Correção:**
  - Alterar a assinatura do método para aceitar `storeId` e incluir `.eq('store_id', storeId)` na instrução de `.update()`.

---

### 🟡 SEVERIDADE: MÉDIO

#### MED-01 — Re-renderização e Re-vínculo Constante de Event Listeners Globais no PDV (`PdvView.tsx`)
- **Descrição:** O componente `PdvView.tsx` declara a função `handleConfirmSale` sem `useCallback`, porém a inclui no array de dependências do `useEffect` responsável pelos atalhos globais de teclado (`F2`, `F4`, `ESC`). A cada digitação no campo de busca do PDV ou alteração no carrinho, a referência de `handleConfirmSale` muda, forçando o desvínculo e re-vínculo contínuo dos event listeners no elemento `window`.
- **Arquivos/Tabelas/Funções Afetados:**
  - Componente: `src/components/pdv/PdvView.tsx` (linhas 235 e 372)
- **Sugestão de Correção:**
  - Envolver `handleConfirmSale` em `useCallback` ou utilzar uma `ref` mutável para guardar o handler do teclado sem causar re-inscrições desnecessárias.

#### MED-02 — Ausência de Índice Composto em `sale_idempotency` para Verificação de Idempotência
- **Descrição:** As funções RPC `complete_sale` e `create_mp_pix_sale` realizam consultas de trava/leitura na tabela `sale_idempotency` filtrando simultaneamente por `idempotency_key`, `store_id` e `user_id`. Atualmente, a busca recorre a buscas parciais sem um índice composto dedicado para essas três colunas.
- **Arquivos/Tabelas/Funções Afetados:**
  - Tabela: `public.sale_idempotency`
  - Migração: `supabase/migrations/20260929234854_20260930020000_scope_sale_idempotency.sql`
- **Sugestão de Correção:**
  - Criar o índice:
    ```sql
    CREATE INDEX IF NOT EXISTS idx_sale_idempotency_lookup
    ON public.sale_idempotency(store_id, user_id, idempotency_key);
    ```

#### MED-03 — Avisos de Linter e Dependências Faltantes em Hooks do React
- **Descrição:** A execução de `npm run lint` reporta 26 warnings em componentes principais (ex.: `DashboardView`, `RevenueChart`, `TopProductsChart`, `FinanceView`, `InventoryView`, `MovementsView`, `PdvView`, `NewReturnModal`, `SupplierForm`, e contextos de Auth/Cart/Store/Theme devido a exportação de constantes/helpers junto aos componentes).
- **Arquivos/Tabelas/Funções Afetados:**
  - 13 arquivos em `src/components/` e `src/contexts/`
- **Sugestão de Correção:**
  - Ajustar arrays de dependência de `useEffect`/`useCallback` e mover helpers exportados para arquivos utilitários dedicados em `src/lib/` ou `src/utils/`.

---

### 🟢 SEVERIDADE: BAIXO

#### BAIX-01 — Dependências Mortas no `package.json`
- **Descrição:** Os pacotes `express` e `@google/genai` constam na lista de dependências do `package.json`, mas não são importados em nenhum arquivo da aplicação `src/`.
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivo: `package.json`
- **Sugestão de Correção:**
  - Remover as dependências não utilizadas executando `npm uninstall express @google/genai`.

#### BAIX-02 — IDs Numéricos Sintéticos Recalculados por Índice de Array (`id: index + 1`)
- **Descrição:** Diversos serviços (`products.service.ts`, `customers.service.ts`, `finance.service.ts`, `sales.service.ts`) geram IDs numéricos sintéticos baseados no índice do array retornado (`id: index + 1`) para compatibilidade com interfaces legadas. Isso pode causar re-renderizações ou falhas de chave única no React quando itens são reordenados ou filtrados.
- **Arquivos/Tabelas/Funções Afetados:**
  - Serviços em `src/services/`
- **Sugestão de Correção:**
  - Padronizar os componentes de UI para utilizarem exclusivamente a propriedade `uuid` (UUID estável retornado do banco Supabase) como chave de identificação.

---

## 3. CHECKLIST DE VERIFICAÇÃO TÉCNICA

- [x] **Segurança e Isolamento Multi-Tenant:** Identificado vazamento em `suppliers` e falta de escopo `store_id` em mutações no `customers.service.ts` e `finance.service.ts`.
- [x] **Funções SECURITY DEFINER:** Funções críticas (`complete_sale`, `create_mp_pix_sale`, `cancel_sale`) possuem `SET search_path = public` e checagem de papel por loja (`get_user_store_role`).
- [x] **Performance do Banco:** Identificada necessidade de índice composto em `sale_idempotency` e otimização de busca de produtos por loja.
- [x] **Frontend e Inconsistências:** Mapeados 26 avisos de linter, re-renders no PDV e dependências não utilizadas.

---

## 4. CONCLUSÃO E PRÓXIMOS PASSOS

Nenhuma alteração de código da aplicação foi realizada nesta etapa de auditoria, conforme orientação. Registrou-se este relatório detalhado em `docs/audits/AUDITORIA_DIARIA_2026-10-03.md`. As correções identificadas (com prioridade para `CRIT-01`, `CRIT-02` e `CRIT-03`) devem ser planejadas e executadas na próxima sprint de correção.
