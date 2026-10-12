# Relatório de Auditoria Técnica Diária — CoreSys
**Data:** 03 de Outubro de 2026
**Responsável:** Engenheiro de Software Sênior (Auditoria Técnica)
**Repositório:** FlavioProgramador/projeto-loja-multimarcas
**Status Geral:** Análise Concluída — 9 Achados Catalogados

---

## 📋 Resumo Executivo

A auditoria técnica diária do sistema **CoreSys** analisou o código-fonte frontend (React/TypeScript), a camada de serviços, a configuração do Supabase, as políticas de segurança de nível de linha (RLS), as funções em banco de dados (`SECURITY DEFINER`) e os pipelines de integração.

### Distribuição dos Achados por Severidade

| Severidade | Quantidade | Descrição Sintética |
| :--- | :---: | :--- |
| **CRÍTICO** | 0 | Nenhum bloqueio imediato de vazamento multi-tenant direto encontrado nas RPCs mais recentes de vendas. |
| **ALTO** | 2 | Desempenho crítico no banco de dados e sobrecarga massiva no cliente. |
| **MÉDIO** | 4 | Exposição indevida de dados de custo a papéis não autorizados, falhas em fallback local e re-renderizações no PDV. |
| **BAIXO** | 3 | Inconsistência de cache local multi-loja e avisos de linting/hooks. |

---

## 🔎 Detalhamento dos Achados de Auditoria

---

### 1. [SEVERIDADE: ALTA] Tripla Execução de CTEs Agregadas Pesadas na RPC `get_customer_directory_page`

- **Severidade:** **ALTO**
- **Categoria:** Performance no Banco de Dados / Otimização de Query
- **Descrição do Problema:**
  Na migração `20261002234838_server_pagination_phase25c.sql`, a função `get_customer_directory_page` executa três vezes consecutivas e idênticas o bloco de Common Table Expressions (`WITH sales_agg ... credit_agg ... base ... filtered`).
  - A 1ª execução calcula a contagem total de registros (`v_total`).
  - A 2ª execução recomputa e formata as linhas da página solicitada (`v_rows`).
  - A 3ª execução recomputa as métricas e acumulados globais de clientes (`v_stats`).
  Em bases de dados com milhares de vendas e movimentações de crédito, essa tripla varredura e agregação por página gera alto consumo de CPU no PostgreSQL e latência elevada nas respostas de paginação do diretório de clientes.
- **Arquivos / Funções / Tabelas Afetadas:**
  - Arquivo: `supabase/migrations/20261002234838_server_pagination_phase25c.sql`
  - Função RPC: `public.get_customer_directory_page(uuid, text, text, text, integer, integer)`
  - Tabelas: `public.customers`, `public.sales`, `public.customer_credit_movements`
- **Sugestão de Correção:**
  Refatorar a RPC para agregar as estatísticas globais e calcular o total de registros e as linhas paginadas a partir de um único cálculo temporário ou reutilizar o resultado filtrado em uma CTE única, evitando re-execuções das junções e agrupamentos pesados.

---

### 2. [SEVERIDADE: ALTA] Download Global de Produtos e Filtragem Multi-Tenant em Memória no Cliente

- **Severidade:** **ALTO**
- **Categoria:** Performance Frontend / Arquitetura Multi-Tenant
- **Descrição do Problema:**
  O método `ProductsService.getAll(storeId)` em `src/services/products.service.ts` realiza uma consulta Supabase na tabela `products` trazendo **todos os produtos e variações de todas as lojas** e faz a filtragem por `store_id` no JavaScript do navegador:
  ```ts
  .filter(product => product.product_variants?.some(variant =>
    variant.is_active && variant.store_inventory?.some(inventory => inventory.store_id === storeId)
  ))
  ```
  Conforme novas lojas forem adicionadas à plataforma e o catálogo global crescer, essa estratégia provocará tráfego excessivo de dados pela rede, consumo elevado de memória no dispositivo do cliente e vazamento de metadados do catálogo entre lojas no payload da requisição REST/PostgREST.
- **Arquivos / Funções / Tabelas Afetadas:**
  - Arquivo: `src/services/products.service.ts`
  - Função: `ProductsService.getAll`
  - Tabelas: `public.products`, `public.product_variants`, `public.store_inventory`
- **Sugestão de Correção:**
  Aplicar o filtro de `store_id` diretamente no banco de dados Supabase utilizando o operador `!inner` no PostgREST (`store_inventory!inner(store_id, quantity)` com `.eq('store_inventory.store_id', storeId)`) ou criar/utilizar uma RPC otimizada que retorne apenas o estoque da loja solicitada.

---

### 3. [SEVERIDADE: MÉDIA] Permissão de Execução e Exposição do Preço de Custo a Operadores (`CASHIER`) nas RPCs de Lucratividade

- **Severidade:** **MÉDIO**
- **Categoria:** Segurança / Controle de Acesso (RBAC) / Sigilo Comercial
- **Descrição do Problema:**
  As funções `get_profitability_by_product` e `get_profitability_by_category` são marcadas como `SECURITY DEFINER` e realizam consultas à coluna restrita `cost_price` (preço de custo) para calcular margem de lucro. Embora o acesso direto à coluna `cost_price` na tabela `products` tenha sido revogado para a role `authenticated`, qualquer usuário com acesso à loja (incluindo o operador de caixa / `CASHIER`) pode invocar essas RPCs informando o `p_store_id` e obter os preços de custo e margens financeiras de todos os produtos.
- **Arquivos / Funções / Tabelas Afetadas:**
  - Arquivos: `supabase/migrations/20260929000000_coresys_audit_fixes.sql`, `supabase/migrations/20260928230000_auth_integrity_hardening.sql`
  - Funções RPC: `public.get_profitability_by_product(uuid, date, date)`, `public.get_profitability_by_category(uuid, date, date)`
  - Tabela: `public.products` (`cost_price`)
- **Sugestão de Correção:**
  Inserir a validação explícita do papel do usuário no início de ambas as funções RPC:
  ```sql
  v_role := public.get_user_store_role(p_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN', 'MANAGER') THEN
    RAISE EXCEPTION 'Permissão negada para relatórios de lucratividade desta loja.';
  END IF;
  ```

---

### 4. [SEVERIDADE: MÉDIA] Venda no Modo Local/Fallback Atribuída como Despesa (`tipo: 'EXPENSE'`)

- **Severidade:** **MÉDIO**
- **Categoria:** Bug Funcional / Regra de Negócio
- **Descrição do Problema:**
  Em `src/hooks/domains/useSalesDomain.ts` (linha 76), durante a execução em modo local/fallback (quando `isSupabaseConfigured` é `false`), a movimentação de venda criada para atualização do histórico (`newMovement`) é instanciada incorretamente com `tipo: 'EXPENSE'` em vez de `tipo: 'INCOME'`:
  ```ts
  const newMovement: SaleMovement = {
    id: nextMovId,
    tipo: 'EXPENSE', // ERRO: Venda é uma receita (INCOME)
    valor: totalFinal,
    ...
  ```
  Isso faz com que vendas realizadas no ambiente de demonstração/offline distorçam os totais financeiros locais, contabilizando receitas como despesas.
- **Arquivos / Funções / Tabelas Afetadas:**
  - Arquivo: `src/hooks/domains/useSalesDomain.ts`
  - Função: `processSale`
- **Sugestão de Correção:**
  Alterar a propriedade `tipo` de `'EXPENSE'` para `'INCOME'` na criação de `newMovement`.

---

### 5. [SEVERIDADE: MÉDIA] Recriação de Listeners Globais de Teclado no PDV (`PdvView.tsx`)

- **Severidade:** **MÉDIO**
- **Categoria:** Bug de Interface / Estabilidade e Performance
- **Descrição do Problema:**
  No componente `src/components/pdv/PdvView.tsx`, a função `handleConfirmSale` é declarada no corpo do componente sem `useCallback`. Como ela é incluída no array de dependências do `useEffect` responsável pelos atalhos globais de teclado (F2, F4, ESC), os listeners da janela (`window.addEventListener('keydown')`) são destruídos e reinstalados a cada mudança de estado da tela do PDV. Isso pode gerar perda de atalhos e falha no disparo de finalização da venda durante digitação acelerada do operador.
- **Arquivos / Funções / Tabelas Afetadas:**
  - Arquivo: `src/components/pdv/PdvView.tsx`
  - Função: `handleConfirmSale`, `useEffect`
- **Sugestão de Correção:**
  Envolver a função `handleConfirmSale` em um `useCallback` adequadamente tipado e parametrizado.

---

### 6. [SEVERIDADE: MÉDIA] Validação do Perfil do Usuário Ausente nas RPCs do Diretório de Clientes

- **Severidade:** **MÉDIO**
- **Categoria:** Segurança / Validação de Autenticação
- **Descrição do Problema:**
  As RPCs `get_customer_directory_page` e `get_customer_detail` em `20261002234838_server_pagination_phase25c.sql` validam se `auth.uid()` tem acesso à loja via `public.has_store_access(p_store_id)`, porém não checam o papel ativo da loja (`get_user_store_role`), ao contrário de `get_finance_page`, `report_commercial_summary` e `complete_sale`. Se um usuário for desativado da loja ou se sua função for revogada, as chamadas podem continuar retornando dados do diretório de clientes.
- **Arquivos / Funções / Tabelas Afetadas:**
  - Arquivo: `supabase/migrations/20261002234838_server_pagination_phase25c.sql`
  - Funções RPC: `public.get_customer_directory_page`, `public.get_customer_detail`
- **Sugestão de Correção:**
  Adicionar a validação de papel fail-closed em ambas as RPCs:
  ```sql
  IF public.get_user_store_role(p_store_id) IS NULL THEN
    RAISE EXCEPTION 'Acesso negado à loja.';
  END IF;
  ```

---

### 7. [SEVERIDADE: BAIXA] Ausência do Parâmetro `store_id` nas Mutações do `CustomersService`

- **Severidade:** **BAIXO**
- **Categoria:** Isolamento Multi-Tenant / Defesa em Profundidade
- **Descrição do Problema:**
  Em `src/services/customers.service.ts`, os métodos `update` e `remove` executam atualizações diretamente na tabela `customers` do Supabase usando apenas `.eq('id', uuid)`.
  Embora as políticas de RLS na tabela `customers` apliquem `has_store_access(store_id)` e impeçam vazamentos entre tenants, a prática recomendada de defesa em profundidade exige que o filtro `.eq('store_id', storeId)` seja passado explicitamente na query do cliente para prevenir edições acidentais em chamadas de API.
- **Arquivos / Funções / Tabelas Afetadas:**
  - Arquivo: `src/services/customers.service.ts`
  - Métodos: `CustomersService.update`, `CustomersService.remove`
- **Sugestão de Correção:**
  Atualizar a assinatura dos métodos para aceitar `storeId` e encadear `.eq('store_id', storeId)` em todas as queries de atualização/exclusão.

---

### 8. [SEVERIDADE: BAIXA] Inconsistência do Cache do LocalStorage na Alternância de Lojas no `StoreContext`

- **Severidade:** **BAIXO**
- **Categoria:** Arquitetura Frontend / Estado Multi-Loja
- **Descrição do Problema:**
  Em `src/contexts/StoreContext.tsx`, os `useEffect` persistem estados como `products`, `suppliers` e `fixedExpenses` em chaves genéricas de `localStorage` (`erp_products`, `erp_suppliers`, etc.). Quando o usuário altera a loja ativa através de `setActiveStoreId`, o estado é redefinido para array vazio antes do carregamento dos dados da nova loja, sobrescrevendo a chave genérica no `localStorage`.
- **Arquivos / Funções / Tabelas Afetadas:**
  - Arquivo: `src/contexts/StoreContext.tsx`
- **Sugestão de Correção:**
  Insuflar o ID da loja ativa nas chaves do `localStorage` (ex.: `erp_products_${activeStoreId}`) ou desativar completamente a sincronização com `localStorage` quando o Supabase estiver devidamente configurado e ativo.

---

### 9. [SEVERIDADE: BAIXA] Avisos de ESLint e Dependências Ausentes em Hooks do React

- **Severidade:** **BAIXO**
- **Categoria:** Qualidade de Código / Linter
- **Descrição do Problema:**
  Foram identificados 26 avisos de linter no comando `npm run lint`. Os avisos incluem variáveis declaradas e não utilizadas (`CreditCard`, `formatPaymentMethod`, `ChevronDown`, `Trash2`, `StockStatus`, `PlusCircle`, `ArrowUp`, `setCustomReason`, `formatPhone`) e hooks `useEffect` com dependências incompletas (`RevenueChart`, `TopProductsChart`, `FinanceView`, `MovementsView`).
- **Arquivos / Funções / Tabelas Afetadas:**
  - Arquivos: `src/components/dashboard/DashboardView.tsx`, `RevenueChart.tsx`, `TopProductsChart.tsx`, `FinanceView.tsx`, `InventoryView.tsx`, `NewProductModal.tsx`, `StockEntryModal.tsx`, `MovementsView.tsx`, `PdvView.tsx`, `NewReturnModal.tsx`, `SupplierForm.tsx`
- **Sugestão de Correção:**
  Remover as importações e variáveis não utilizadas e ajustar as dependências do `useEffect` usando `useCallback` ou desestruturação quando apropriado.

---

## ⚙️ Verificação de Testes e Integração

Foi executada a suíte completa de verificação do projeto:
- **`npm run typecheck`**: Aprovado sem erros de compilação TypeScript.
- **`npm run lint`**: Aprovado (0 erros, 26 avisos catalogados).
- **`npm test`**: Aprovado (11 arquivos de teste passando, 39 casos de teste aprovados).
- **`npm run security:dependencies`**: Aprovado (0 vulnerabilidades em dependências).

---

## 🎯 Recomendações e Próximos Passos

1. **Sprint Próxima (Prioridade Alta):**
   - Refatorar a RPC `get_customer_directory_page` para eliminar as re-execuções das CTEs.
   - Refatorar `ProductsService.getAll` para realizar o filtro de loja diretamente no banco Supabase.
   - Restringir o acesso das RPCs `get_profitability_by_product` e `get_profitability_by_category` aos papéis `ADMIN` e `MANAGER`.
2. **Qualidade de Código & Manutenibilidade:**
   - Corrigir a atribuição de `tipo: 'INCOME'` no fallback de vendas de `useSalesDomain.ts`.
   - Envolver `handleConfirmSale` em `useCallback` em `PdvView.tsx`.
