# 🛡️ RELATÓRIO DE AUDITORIA TÉCNICA DIÁRIA - CORESYS
**Data:** 03 de Outubro de 2026
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Auditor:** Engenheiro de Software Sênior (CoreSys)
**Status:** Análise técnica e auditoria concluídas sem alterações automáticas no código da aplicação.

---

## 📊 DASHBOARD EXECUTIVO DA AUDITORIA

| Métrica | Valor |
|---------|-------|
| **Vulnerabilidades Críticas** | 3 |
| **Vulnerabilidades de Alta Severidade** | 3 |
| **Problemas de Média Severidade** | 3 |
| **Melhorias de Baixa Severidade** | 2 |
| **Conconformidade Multi-Tenant** | ⚠ Requer ajustes no isolamento de cache local e mutações diretas |
| **Integridade de Dados e Transações** | ⚠ Falha na débito atômico de crédito do cliente em vendas PDV |
| **Status para Produção** | 🛑 Requer correção dos itens Críticos e Altos antes do próximo release |

---

## 🔴 1. SEVERIDADE CRÍTICA (CRÍTICO)

### 🔴 CRIT-01: Reutilização Infinita de Crédito do Cliente em Vendas PDV (Falha de Persistência no Banco)
- **Classificação:** CRÍTICO
- **Explicação do Problema:**
  Quando uma venda no PDV é realizada utilizando saldo de crédito do cliente (`creditUsed > 0`), o hook `useSalesDomain.ts` adiciona `creditUsed` ao valor do desconto enviado à RPC `SalesService.completeSale` e atualiza apenas o estado local React (`setCustomers`). No entanto, a função SQL `complete_sale` no Supabase não aceita parâmetro de débito de crédito nem insere nenhum registro na tabela `customer_credit_movements` (com `type = 'DEBIT'`).
  Consequentemente, na próxima atualização de dados ou recarregamento da página, a função `CustomersService.getDirectoryPage` / `getDetail` recalcula o saldo de crédito consultando os movimentos na tabela `customer_credit_movements`. Como nenhum débito foi registrado no banco de dados, o saldo do cliente é **restaurado integralmente**. O cliente pode reutilizar o mesmo saldo de crédito infinitas vezes para realizar compras gratuitas.
- **Arquivos/Tabelas/Funções Afetados:**
  - `src/hooks/domains/useSalesDomain.ts`
  - `src/services/sales.service.ts`
  - Função PostgreSQL: `public.complete_sale` (`supabase/migrations/20261003000000_coresys_audit_final_remediation.sql`)
  - Tabela: `public.customer_credit_movements`
- **Sugestão de Correção:**
  1. Alterar a RPC `complete_sale` para aceitar o parâmetro `p_credit_used numeric DEFAULT 0`.
  2. Dentro da transação atômica da RPC `complete_sale`:
     - Validar se o cliente possui saldo de crédito suficiente (`SELECT COALESCE(SUM(CASE WHEN type='CREDIT' THEN amount ELSE -amount END), 0) FROM customer_credit_movements WHERE customer_id = v_customer_id AND store_id = p_store_id`).
     - Inserir um registro em `customer_credit_movements(store_id, customer_id, type, amount, description, reference_id, user_id)` com `type = 'DEBIT'` e `amount = p_credit_used`.
  3. Atualizar a chamada no `SalesService.completeSale` e `useSalesDomain.ts` para repassar o `creditUsed`.

---

### 🔴 CRIT-02: Vazamento de Dados Multi-Tenant via `localStorage` Genérico ao Alternar Lojas
- **Classificação:** CRÍTICO
- **Explicação do Problema:**
  No `StoreContext.tsx`, ao carregar os dados de uma loja (`products`, `suppliers`, `fixedExpenses`, `notifications`), os valores são sincronizados diretamente com o `localStorage` utilizando chaves globais e genéricas (`erp_products`, `erp_suppliers`, `erp_fixed_expenses`, `erp_notifications`).
  Quando um usuário alterna de loja através do seletor multi-tenant ou quando outro usuário autentica no mesmo navegador, os dados em cache da loja anterior persistem no `localStorage`. Em caso de instabilidade de rede ou modo offline, o estado local exibe os dados da loja antiga para o contexto da nova loja.
  Além disso, o `CartContext.tsx` não escuta mudanças na loja ativa (`activeStoreId`), mantendo no carrinho de compras itens adicionados da Loja A ao alternar para a Loja B. Se a venda for concluída na Loja B, o sistema tentará dar baixa em variações de produtos pertencentes à Loja A.
- **Arquivos/Tabelas/Funções Afetados:**
  - `src/contexts/StoreContext.tsx`
  - `src/contexts/CartContext.tsx`
  - Chaves de `localStorage`: `erp_products`, `erp_suppliers`, `erp_fixed_expenses`, `erp_notifications`
- **Sugestão de Correção:**
  1. Parametrizar as chaves de armazenamento local com os identificadores do usuário e da loja ativa: ex. `erp_products_${user.id}_${activeStoreId}`.
  2. No `CartContext.tsx`, adicionar um efeito de monitoramento para o `activeStoreId` ou expor uma instrução de limpeza (`clearCart()`) acionada automaticamente sempre que a loja ativa for alterada no `StoreContext`.

---

### 🔴 CRIT-03: Desaparecimento Imediato de Produtos Criados com Estoque Zero na Interface Multi-loja
- **Classificação:** CRÍTICO
- **Explicação do Problema:**
  A RPC `manage_product` insere novos produtos e variações nas tabelas globais `products` e `product_variants`. Em seguida, o hook `useProductsDomain.ts` chama `InventoryService.registerStockEntry` apenas para os SKUs em que a quantidade inicial é maior que zero (`quantity > 0`).
  Se um produto for cadastrado sem estoque inicial (`qtd = 0`), nenhuma linha é criada na tabela `store_inventory` para a loja ativa (`activeStoreId`). Ao atualizar a listagem via `ProductsService.getAll(storeId)`, a query SQL realiza um filtro exato exigindo a existência de um registro associado ao `store_id` em `store_inventory`. Como a linha em `store_inventory` não foi gerada, o produto recém-cadastrado é sumariamente omitido da listagem da loja.
- **Arquivos/Tabelas/Funções Afetados:**
  - `src/hooks/domains/useProductsDomain.ts` (`addProduct`)
  - `src/services/products.service.ts` (`getAll`)
  - RPC SQL: `public.manage_product`
  - Tabela: `public.store_inventory`
- **Sugestão de Correção:**
  1. Ao criar um produto via `manage_product` ou no fluxo de inicialização, garantir a inserção de um registro em `store_inventory` com `quantity = 0` para cada variante na loja ativa do usuário logado.
  2. Alternativamente, ajustar o filtro de `ProductsService.getAll` para incluir produtos ativos cadastrados pela loja ou com estoque gerenciado na loja.

---

## 🟠 2. SEVERIDADE ALTA (ALTO)

### 🟠 ALTO-01: Mutações Diretas Sem Filtro de Loja (`store_id`) em Clientes e Fornecedores (Risco IDOR/BOLA)
- **Classificação:** ALTO
- **Explicação do Problema:**
  Nos serviços `CustomersService` e `SuppliersService`, os métodos de atualização e remoção realizam consultas diretas ao Supabase:
  - `customers.service.ts`: `supabase.from('customers').update(payload).eq('id', uuid);`
  - `suppliers.service.ts`: `supabase.from('suppliers').update(payload).eq('id', uuid);`

  Estas mutações filtram unicamente pelo UUID do registro (`eq('id', uuid)`) sem validar explicitamente o `store_id` do tenant ativo no cliente HTTP. Se um usuário mal-intencionado possuir o UUID de um cliente/fornecedor pertencente a outra loja, ele pode submeter uma requisição de alteração ou inativação que afete dados fora da loja em que está operando.
- **Arquivos/Tabelas/Funções Afetados:**
  - `src/services/customers.service.ts` (`update`, `remove`)
  - `src/services/suppliers.service.ts` (`update`, `remove`)
  - Tabelas: `public.customers`, `public.suppliers`
- **Sugestão de Correção:**
  1. Adicionar obrigatoriamente a verificação de tenant em todas as chamadas de mutação: `.eq('id', uuid).eq('store_id', storeId)`.
  2. Ou migrar as mutações de clientes e fornecedores para RPCs `SECURITY DEFINER` com validação de papel por loja (`public.get_user_store_role(p_store_id)`).

---

### 🟠 ALTO-02: Destruição e Reinstanciação Excessiva do `CartContext.tsx` Causando Re-renders em Cascata
- **Classificação:** ALTO
- **Explicação do Problema:**
  No `CartContext.tsx`, a função `addItem` foi declarada com `cart` na lista de dependências do `useCallback`: `useCallback(..., [cart])`. Como o estado `cart` é alterado a cada item adicionado ou modificado, a referência da função `addItem` e o objeto `contextValue` são reinstanciados a cada renderização. Isso anula o benefício do `useMemo` no provedor do contexto e provoca a re-renderização em cascata de toda a árvore do PDV e componentes conectados.
- **Arquivos/Tabelas/Funções Afetados:**
  - `src/contexts/CartContext.tsx`
- **Sugestão de Correção:**
  - Reescrever a lógica do `addItem` utilizando exclusivamente atualizações funcionais do React (`setCart(prev => ...)`), removendo `cart` do array de dependências do `useCallback`.

---

### 🟠 ALTO-03: Assinatura Incompatível em `CustomersService.create` e Violação de Restrição `NOT NULL`
- **Classificação:** ALTO
- **Explicação do Problema:**
  A assinatura do método `create` em `CustomersService` define o parâmetro `storeId` como opcional (`storeId?: string`). Contudo, a migração `20260930010321_phase3_finalize_tenant_customers_and_cost_privileges.sql` aplicou uma restrição `ALTER TABLE public.customers ALTER COLUMN store_id SET NOT NULL;`. Se o método for invocado sem fornecer o `storeId`, o Supabase retorna uma exceção de restrição do PostgreSQL, resultando em falha não tratada no cadastro de clientes.
- **Arquivos/Tabelas/Funções Afetados:**
  - `src/services/customers.service.ts` (`create`)
  - Tabela: `public.customers`
- **Sugestão de Correção:**
  - Atualizar a assinatura do método para exigir o `storeId` como segundo parâmetro obrigatório: `create(customer: ..., storeId: string): Promise<any>`.

---

## 🟡 3. SEVERIDADE MÉDIA (MÉDIO)

### 🟡 MED-01: Redirecionamento Abrupto para Login em Instabilidades Temporárias de Refresh de Token
- **Classificação:** MÉDIO
- **Explicação do Problema:**
  No `AuthContext.tsx`, o ouvinte do Supabase `onAuthStateChange` processa o evento `TOKEN_REFRESHED` dentro de um bloco assíncrono. Em situações de desconexão momentânea ou alta latência de rede durante o refresh de token, a exceção é capturada, invoca `clearLocalCaches()` e força um redirecionamento imediato para a página de login (`goToLogin(true)`). Isso causa a perda de dados não salvos no PDV ou formulários abertos.
- **Arquivos/Tabelas/Funções Afetados:**
  - `src/contexts/AuthContext.tsx`
- **Sugestão de Correção:**
  - Implementar um mecanismo de *retry* com tempo limite ajustado antes de invalidar a sessão do usuário, e exibir uma notificação do sistema informando sobre a instabilidade da conexão.

---

### 🟡 MED-02: Ausência de Índice Composto Único para `(store_id, product_variant_id)` em `store_inventory`
- **Classificação:** MÉDIO
- **Explicação do Problema:**
  Consultas frequentes no PDV, listagem de estoque e execução das RPCs `complete_sale` e `create_mp_pix_sale` realizam consultas e bloqueios por `store_id` e `product_variant_id` na tabela `store_inventory`. Embora existam índices simples, a falta de uma restrição/índice composto único `UNIQUE (store_id, product_variant_id)` reduz a eficiência do planejamento de queries e abre margem para inserções duplicadas não intencionais de estoque para a mesma variante em uma loja.
- **Arquivos/Tabelas/Funções Afetados:**
  - Tabela PostgreSQL: `public.store_inventory`
- **Sugestão de Correção:**
  - Criar uma migração SQL adicionando a restrição única:
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_store_inventory_store_variant_unique ON public.store_inventory(store_id, product_variant_id);`

---

### 🟡 MED-03: Avisos do Linter de Dependências em Hooks e Variáveis Não Utilizadas (26 Warnings)
- **Classificação:** MÉDIO
- **Explicação do Problema:**
  A execução de `npm run lint` reporta 26 avisos referentes a variáveis declaradas e não utilizadas e dependências ausentes em arrays de `useEffect` (ex. `loadTransactions`, `loadExpenses`, `loadMovements`, `data`, `labels`). Embora não travem a compilação, essas omissões em dependências podem causar *stale closures* e comportamentos inconsistentes na interface.
- **Arquivos/Tabelas/Funções Afetados:**
  - `src/components/dashboard/RevenueChart.tsx`
  - `src/components/dashboard/TopProductsChart.tsx`
  - `src/components/finance/FinanceView.tsx`
  - `src/components/pdv/PdvView.tsx`
  - `src/components/movements/MovementsView.tsx`
  - `src/components/returns/NewReturnModal.tsx`
- **Sugestão de Correção:**
  - Envolver funções auxiliares em `useCallback` e declarar adequadamente as dependências dos `useEffect` indicados pelo ESLint.

---

## 🟢 4. SEVERIDADE BAIXA (BAIXO)

### 🟢 BAIXO-01: Redundância de Arquivos CSS Locais em Relação ao Tailwind e Variáveis Globais
- **Classificação:** BAIXO
- **Explicação do Problema:**
  Existem múltiplos arquivos CSS específicos de componentes (`src/components/finance/finance.css`, `inventory.css`, `movements.css`, `reports.css`) que contêm estilos legados parcialmente sobrescritos pelo Tailwind CSS e variáveis globais do `src/index.css`.
- **Arquivos/Tabelas/Funções Afetados:**
  - `src/components/finance/finance.css`
  - `src/components/inventory/inventory.css`
  - `src/components/movements/movements.css`
  - `src/components/reports/reports.css`
- **Sugestão de Correção:**
  - Consolidar as regras customizadas remanescentes no CSS global de temas e remover os arquivos `.css` individuais redundantes.

---

### 🟢 BAIXO-02: Incompatibilidade de Versão declarada do Node no `package.json`
- **Classificação:** BAIXO
- **Explicação do Problema:**
  O arquivo `package.json` declara a especificação `"engines": { "node": ">=22.22.2" }`, enquanto a execução do ambiente de desenvolvimento está em `v22.22.1`, gerando alertas contínuos do `npm`.
- **Arquivos/Tabelas/Funções Afetados:**
  - `package.json`
- **Sugestão de Correção:**
  - Ajustar o intervalo de engine no `package.json` para `"node": ">=22.0.0"`.

---

## 📋 PLANO DE AÇÃO RECOMENDADO PARA O PRÓXIMO SPRINT (P0 / P1)

1. **Sprint 1 (Prioridade P0 - Correções Críticas):**
   - Implementar débito atômico de crédito na RPC `complete_sale` e atualizar o `useSalesDomain.ts` (CRIT-01).
   - Ajustar o isolamento do `localStorage` por loja/usuário no `StoreContext.tsx` e resincronizar o `CartContext.tsx` na troca de loja (CRIT-02).
   - Garantir a inicialização de `store_inventory` com `qtd = 0` para produtos cadastrados sem estoque inicial (CRIT-03).

2. **Sprint 2 (Prioridade P1 - Segurança e Otimização):**
   - Adicionar validação explícita de `store_id` nas chamadas diretas de mutação de Clientes e Fornecedores (ALTO-01).
   - Tornar `storeId` parâmetro obrigatório no método `create` de `CustomersService` (ALTO-03).
   - Otimizar o `useCallback` do `CartContext.tsx` para evitar re-renderizações em cascata (ALTO-02).
   - Adicionar o índice composto único na tabela `store_inventory` (MED-02).

---

**Relatório elaborado por:** Engenheiro de Software Sênior (CoreSys Audit Team)
**Assinatura Digital:** CoreSys Daily Automated & Manual Inspection Engine v2.5
