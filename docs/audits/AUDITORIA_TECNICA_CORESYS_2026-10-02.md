# Relatório de Auditoria Técnica Diária - CoreSys
**Data:** 02 de Outubro de 2026
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Responsável:** Engenheiro de Software Sênior (Auditoria CoreSys)

---

## Resumo Executivo

Esta auditoria técnica diária analisou o código-fonte (React/TypeScript), a camada de serviços/hooks, as regras de negócio, a autenticação Supabase Auth, o isolamento multi-tenant e o banco de dados PostgreSQL/Supabase (migrações SQL, funções `SECURITY DEFINER`, RLS e índices).

As prioridades auditadas englobam:
1. **Segurança e RLS:** Verificação de privilégios de execução, injeção de `search_path`, vazamento de dados via API e bypass de políticas.
2. **Isolamento Multi-tenant:** Garantia de que dados de uma loja nunca vazem ou sejam alterados por usuários de outra loja (`store_id` e `has_store_access`).
3. **Integridade de Dados e Erros Funcionais:** Sincronização de saldo de crédito de clientes, movimentações de estoque, criação de produtos e idempotência.
4. **Performance e Arquitetura:** Análise de índices compostos, cache local de estado e tratamento de exceções.

---

## Achados de Auditoria Classificados por Severidade

### 1. SEVERIDADE: CRÍTICO

#### 1.1. Inconsistência Crítica na Dedução do Saldo de Crédito de Clientes nas Vendas
- **Explicação do Problema:**
  Quando um cliente utiliza saldo de crédito em uma compra no PDV (`creditUsed > 0` no `useSalesDomain.ts`), a interface atualiza o saldo otimista no estado local. Contudo, ao enviar a venda para o Supabase via RPC `complete_sale`, o valor de crédito é repassado como desconto comercial genérico (`discountValue: discountValue + creditUsed`), **sem registrar o débito do crédito na tabela `customer_credit_movements`**.
  Ao recarregar a aplicação ou sincronizar dados (`CustomersService.getAll`), o saldo do cliente é recomputado somando/subtraindo as movimentações da tabela `customer_credit_movements`. Como a movimentação de débito nunca foi persistida no banco, o saldo antigo do cliente é restaurado, permitindo que o mesmo crédito seja utilizado indefinidamente em múltiplas vendas.
- **Arquivos/Tabelas/Funções Afetados:**
  - Frontend: `src/hooks/domains/useSalesDomain.ts`, `src/services/sales.service.ts`
  - Backend (RPC): `public.complete_sale(uuid, ...)`
  - Tabelas: `public.customer_credit_movements`, `public.sales`
- **Sugestão de Correção:**
  Atualizar a assinatura e lógica da RPC `complete_sale` para aceitar os parâmetros opcionais `p_credit_used NUMERIC` e `p_customer_id UUID`. Quando `p_credit_used > 0`, a RPC deve:
  1. Validar se o cliente possui saldo de crédito suficiente em `customer_credit_movements`;
  2. Inserir uma linha com `type = 'DEBIT'`, `amount = p_credit_used`, `reference_id = v_sale_id` e `store_id = p_store_id` dentro da transação atômica da venda.

#### 1.2. Cache Local Não Isolado por Loja em `localStorage` (Risco de Vazamento Multi-tenant)
- **Explicação do Problema:**
  No arquivo `src/contexts/StoreContext.tsx`, dados do estado do ERP (`products`, `suppliers`, `fixedExpenses`, `notifications`) são salvos no `localStorage` sob chaves globais e compartilhadas (`erp_products`, `erp_suppliers`, `erp_fixed_expenses`, `erp_notifications`) sem qualquer vínculo com o `activeStoreId`.
  Ao trocar de loja ativa ou durante a transição de carregamento da sessão, o sistema pode expor temporariamente no navegador dados salvos da loja anterior antes da conclusão de `refreshData()`, violando o isolamento estrito de dados multi-tenant no cliente.
- **Arquivos/Tabelas/Funções Afetados:**
  - Frontend: `src/contexts/StoreContext.tsx`
- **Sugestão de Correção:**
  Remover a persistência síncrona em `localStorage` para ambientes onde o Supabase está configurado como fonte da verdade, ou prefixar rigorosamente as chaves do cache com o usuário e ID da loja ativa (ex: `erp_products_${userId}_${activeStoreId}`), garantindo a limpeza imediata do cache na alternância de contexto.

---

### 2. SEVERIDADE: ALTO

#### 2.1. Função Trigger `SECURITY DEFINER` sem `SET search_path = public`
- **Explicação do Problema:**
  A função trigger `public.protect_profile_role()` definida na migração `20260828000001_hardening_rls.sql` é executada com privilégios elevados de `SECURITY DEFINER`, porém não especifica `SET search_path = public`.
  Se um usuário malicioso puder alterar o `search_path` da sessão antes de disparar um evento `UPDATE` na tabela `profiles`, o PostgreSQL resolverá funções ou esquemas internos com base no caminho definido pelo atacante, abrindo brecha para injeção de código ou elevação de privilégio.
- **Arquivos/Tabelas/Funções Afetados:**
  - Migração: `supabase/migrations/20260828000001_hardening_rls.sql`
  - Função: `public.protect_profile_role()`
  - Tabela: `public.profiles`
- **Sugestão de Correção:**
  Aplicar a seguinte correção no banco:
  ```sql
  ALTER FUNCTION public.protect_profile_role() SET search_path = public;
  ```

#### 2.2. Falha de Permissão ao Cadastrar Produto Inexistente na Entrada de Estoque (`InventoryService.registerStockEntry`)
- **Explicação do Problema:**
  Em `src/services/inventory.service.ts`, quando o operador registra entrada de estoque para um produto não cadastrado, o serviço tenta executar um `.insert({ name, ..., cost_price: custoUnitario })` diretamente na tabela `products`.
  Na migração `20260930010321_phase3_finalize_tenant_customers_and_cost_privileges.sql`, a permissão de inserção/alteração na coluna `cost_price` da tabela `products` foi revogada para roles padrão no Supabase e movida para `product_costs` / RPC `manage_product`. Essa tentativa de `.insert()` direto gera erro de permissão no PostgREST e impede o cadastro do produto pela entrada de estoque.
- **Arquivos/Tabelas/Funções Afetados:**
  - Frontend: `src/services/inventory.service.ts`
  - Tabela: `public.products`, `public.product_costs`
  - RPC: `public.manage_product`
- **Sugestão de Correção:**
  Refatorar `InventoryService.registerStockEntry` para criar o novo produto através da RPC `public.manage_product` ou delegar a criação de produto e variante inteiramente para a RPC `public.register_stock_entry`, evitando chamadas diretas de `.insert()` com campos restritos.

---

### 3. SEVERIDADE: MÉDIO

#### 3.1. Ausência de `store_id` e Isolamento por Tenant nas Tabelas `suppliers` e `coupons`
- **Explicação do Problema:**
  As tabelas `public.suppliers` (fornecedores) e `public.coupons` (cupons de desconto) foram criadas sem a coluna `store_id` e possuem políticas RLS genéricas permitindo leitura/escrita para a role `authenticated`.
  Isso significa que fornecedores e cupons cadastrados por uma loja ficam visíveis e modificáveis por usuários de todas as outras lojas do sistema, o que não atende o modelo multi-tenant completo em caso de tenants independentes.
- **Arquivos/Tabelas/Funções Afetados:**
  - Backend: Tabelas `public.suppliers` e `public.coupons`
  - Frontend: `src/services/suppliers.service.ts`
- **Sugestão de Correção:**
  1. Adicionar coluna `store_id UUID REFERENCES stores(id)` nas tabelas `suppliers` e `coupons`;
  2. Ajustar as políticas RLS para utilizar `USING (has_store_access(store_id))`;
  3. Atualizar o `SuppliersService.ts` e serviços de cupons para filtrar por `storeId`.

#### 3.2. Falta de Notificação de Erro na UI para Atualização Otimista de Despesas Fixas
- **Explicação do Problema:**
  No hook `useFinanceDomain.ts`, a função `toggleExpensePaid` altera o estado React de forma otimista antes da chamada remota ao Supabase. Caso ocorra uma falha de conexão ou negação de permissão RLS em `FinanceService.toggleExpensePaid`, o estado é revertido no bloco `catch`, mas nenhum alerta, mensagem ou notificação visual é exibido para o usuário informando que a alteração da despesa falhou.
- **Arquivos/Tabelas/Funções Afetados:**
  - Frontend: `src/hooks/domains/useFinanceDomain.ts`, `src/services/finance.service.ts`
- **Sugestão de Correção:**
  Propagar a mensagem de erro para o componente invocador ou exibir uma notificação visual (Toast/Alert) na interface informando o fracasso da sincronização com o banco.

---

### 4. SEVERIDADE: BAIXO

#### 4.1. Ausência de Índices Compostos para Consultas Multicritério de Relatórios e Desempenho
- **Explicação do Problema:**
  Consultas frequentes nos serviços de relatórios (`ReportsService.getOverview`, `getPaymentBreakdown`, `getMonthlySeries`) realizam filtros combinando `store_id`, `status` e intervalo de datas em `created_at`. Embora existam índices simples em `store_id` e `created_at`, a falta de um índice composto exige operações adicionais de união de bitmaps no PostgreSQL sob alto volume de registros.
- **Arquivos/Tabelas/Funções Afetados:**
  - Tabelas: `public.sales`, `public.financial_transactions`
- **Sugestão de Correção:**
  Criar índices compostos direcionados às queries de relatório:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_sales_store_status_created
    ON public.sales(store_id, status, created_at);

  CREATE INDEX IF NOT EXISTS idx_finance_store_status_created
    ON public.financial_transactions(store_id, status, created_at);
  ```

#### 4.2. Estrutura Obsoleta nos Fallbacks Locais (`src/data/initialData.ts`)
- **Explicação do Problema:**
  Os dados de demonstração offline em `initialData.ts` contêmIDs numéricos locais que não refletem os campos e restrições UUID/multi-loja do schema vigente do Supabase.
- **Arquivos/Tabelas/Funções Afetados:**
  - Frontend: `src/data/initialData.ts`, `src/contexts/StoreContext.tsx`
- **Sugestão de Correção:**
  Alinhar os tipos e fallbacks com o modelo do banco de dados ou desativar o fallback offline quando a integração Supabase estiver habilitada.

---

## Matriz de Achados e Ações Recomendadas

| ID | Título do Achado | Severidade | Categoria | Ação Necessária |
|---|---|---|---|---|
| **AUD-01** | Abatimento de crédito de cliente sem débito em `customer_credit_movements` | **CRÍTICO** | Regra de Negócio / Integridade | Atualizar RPC `complete_sale` para registrar movimentação de débito no banco. |
| **AUD-02** | Cache de estado do ERP em `localStorage` sem escopo por loja | **CRÍTICO** | Multi-tenant / Privacidade | Remover ou escopar chave por `userId` e `activeStoreId`. |
| **AUD-03** | Trigger `protect_profile_role` sem `SET search_path = public` | **ALTO** | Segurança DB | Executar `ALTER FUNCTION protect_profile_role SET search_path = public`. |
| **AUD-04** | Erro de inserção em `products.cost_price` na entrada de estoque | **ALTO** | Funcional / Permissões | Refatorar `registerStockEntry` para utilizar a RPC `manage_product`. |
| **AUD-05** | Ausência de `store_id` em `suppliers` e `coupons` | **MÉDIO** | Multi-tenant | Adicionar `store_id` e atualizar políticas RLS. |
| **AUD-06** | Falta de feedback visual em falha de atualização de despesas | **MÉDIO** | UI / Tratamento de Erros | Adicionar alerta visual quando a RPC/Update falhar. |
| **AUD-07** | Ausência de índices compostos em `sales` e `financial_transactions` | **BAIXO** | Performance DB | Criar índices compostos `(store_id, status, created_at)`. |
| **AUD-08** | Fallbacks offline obsoletos em `initialData.ts` | **BAIXO** | Qualidade de Código | Atualizar/Sincronizar dados mock com o schema Supabase. |

---

## Conclusão e Próximos Passos

A arquitetura do CoreSys apresenta forte alinhamento com boas práticas de segurança, possuindo RLS ativo em todas as 30 tabelas do sistema e validação estrita de papéis via RPCs com `SECURITY DEFINER`.

No entanto, as duas vulnerabilidades classificadas como **CRÍTICO** (reutilização ilimitada de créditos de clientes por falta de débito transacional e cache local não escopado por loja) demandam priorização imediata na próxima sprint/PR de correções.

1. Registrar estes achados no repositório GitHub para acompanhamento das correções.
2. Criar PR dedicada aplicando os ajustes prioritários (RPC `complete_sale` e isolamento de cache).
