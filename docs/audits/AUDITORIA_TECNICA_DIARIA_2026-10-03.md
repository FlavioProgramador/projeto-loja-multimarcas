# Relatório de Auditoria Técnica Diária do CoreSys

**Data:** 03 de Outubro de 2026
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Escopo:** Frontend React/TypeScript, Serviços de API, Funções RPC PostgreSQL, Políticas RLS, Autenticação Supabase e Arquitetura Multi-Tenant.

---

## 1. Resumo Executivo

Esta auditoria técnica diária analisou integralmente o repositório do CoreSys, cobrindo as camadas de interface (React), serviços de integração no frontend, e a infraestrutura de banco de dados PostgreSQL/Supabase (RPCs, Triggers, RLS e funções `SECURITY DEFINER`).

Foram identificadas vulnerabilidades de isolamento multi-tenant, persistência insegura de cache local no navegador, ineficiências de desempenho no banco de dados e divergências de permissão RBAC.

Nenhuma alteração automática foi realizada no código-fonte ou no banco durante esta etapa de auditoria, conforme a orientação da liderança técnica.

---

## 2. Quadro de Achados e Classificação de Severidade

| ID | Severidade | Categoria | Descrição Sumária |
| :--- | :--- | :--- | :--- |
| **SEC-01** | **CRÍTICO** | Multi-Tenant / Segurança | Ausência de isolamento por `store_id` na tabela `suppliers` e mutações globais destrutivas na tabela `products`. |
| **SEC-02** | **CRÍTICO** | Multi-Tenant / Cache | Vazamento de dados de múltiplos estabelecimentos através de cache desprotegido em `localStorage` (`StoreContext`). |
| **SEC-03** | **ALTO** | IDOR/BOLA / API | Omissão da cláusula de contexto de loja (`store_id`) em atualizações e remoções em `CustomersService` e `SuppliersService`. |
| **PERF-01**| **ALTO** | Performance DB | Execução triplicada e redundante de CTEs de agregação de vendas/créditos na RPC `get_customer_directory_page`. |
| **SEC-04** | **ALTO** | RLS / Autorização | Política de RLS da tabela `product_costs` validando perfil global em vez de perfil por loja (`get_user_store_role`). |
| **BUG-01** | **MÉDIO** | PDV / Resiliência | Tratamento inadequado de erros em requisições de PIX com corpo não-JSON na Edge Function em `PdvView.tsx`. |
| **PERF-02**| **MÉDIO** | Performance DB | Faltam índices secundários de consulta nas colunas de custo e relatórios comerciais. |
| **QUAL-01**| **BAIXO** | Qualidade / Codebase | 27 warnings de linter (variáveis declaradas sem uso e dependências ausentes em hooks `useEffect`). |

---

## 3. Detalhamento dos Achados

### Achado SEC-01: Desconexão e Falha de Isolamento Multi-Tenant em `suppliers` e Mutações Globais em `products`
* **Severidade:** **CRÍTICO**
* **Descrição do Problema:**
  1. A tabela `suppliers` foi criada sem a coluna `store_id`. A política de RLS atual (`"Suppliers viewable by authenticated"`) permite que qualquer usuário autenticado leia todos os fornecedores cadastrados por qualquer loja do sistema. Além disso, gerentes e administradores de qualquer loja conseguem alterar ou remover fornecedores globalmente.
  2. A tabela `products` possui catálogo compartilhado. No entanto, quando um gerente da Loja A executa a remoção/desativação de um produto através do serviço `ProductsService.remove(uuid)`, a flag `is_active = false` é aplicada na tabela global `products`. Isso desativa o produto instantaneamente para todas as outras lojas da rede (Loja B, Loja C), gerando vazamento funcional e destruição de dados do catálogo de outros estabelecimentos.
* **Arquivos / Tabelas / Funções Afetados:**
  - Tabelas: `public.suppliers`, `public.products`
  - Migrações: `supabase/migrations/20260101000000_setup.sql`, `supabase/migrations/20260828000001_hardening_rls.sql`
  - Serviços Frontend: `src/services/suppliers.service.ts`, `src/services/products.service.ts`
* **Sugestão de Correção:**
  1. Para `suppliers`: Adicionar a coluna `store_id uuid REFERENCES public.stores(id)` à tabela `suppliers`, fazer o backfill adequado para as lojas ativas, e substituir as políticas de RLS para exigir `has_store_access(store_id)` nas leituras e `get_user_store_role(store_id) IN ('ADMIN', 'MANAGER')` nas mutações.
  2. Para `products`: Em vez de desativar a entidade global `products` quando uma loja deseja ocultar um produto, a remoção deve ser escopada desativando a variação/estoque local na tabela `store_inventory` para aquela loja específica, mantendo a integridade do catálogo global.

---

### Achado SEC-02: Vazamento de Dados Multi-Tenant em `localStorage` no Frontend (`StoreContext`)
* **Severidade:** **CRÍTICO**
* **Descrição do Problema:**
  O componente `StoreContext.tsx` sincroniza os estados de produtos, fornecedores, despesas fixas e notificações no `localStorage` do navegador utilizando chaves genéricas e sem criptografia (`erp_products`, `erp_suppliers`, `erp_fixed_expenses`, `erp_notifications`).
  Quando um operador alterna entre a Loja 1 e a Loja 2, ou quando diferentes operadores acessam a aplicação no mesmo navegador, dados sensíveis da loja anterior permanecem gravados localmente. Se houver falha de rede ou reconexão parcial, o estado local exibe dados de outro tenant, violando a regra de isolamento multi-tenant do frontend.
* **Arquivos / Tabelas / Funções Afetados:**
  - Frontend: `src/contexts/StoreContext.tsx`, `src/contexts/AuthContext.tsx`
* **Sugestão de Correção:**
  1. Remover a gravação automática de entidades sensíveis de negócios no `localStorage` quando a integração com o Supabase estiver ativa.
  2. Caso o cache em disco seja necessário para modo offline, as chaves de armazenamento devem incluir o ID da loja e do usuário (p.ex. `erp_products_${activeStoreId}_${userId}`) e ser limpas obrigatoriamente na troca de loja (`setActiveStoreId`) e no encerramento de sessão (`signOut`).

---

### Achado SEC-03: Risco de BOLA/IDOR e Omissão do Filtro `store_id` em Mutações de Clientes e Fornecedores
* **Severidade:** **ALTO**
* **Descrição do Problema:**
  As funções `CustomersService.update(uuid, customer)` e `CustomersService.remove(uuid)` executam a query de atualização diretamente via `.from('customers').update(payload).eq('id', uuid)`.
  Embora o RLS no Supabase bloqueie a operação caso o usuário não possua o papel adequado na loja associada à linha, o cliente da API não envia a restrição `.eq('store_id', storeId)` na cláusula `WHERE`. Um atacante ou operador com acesso a múltiplas lojas poderia enviar um payload modificando o registro de outra loja. O mesmo padrão ocorre em `SuppliersService.update` e `SuppliersService.remove`.
* **Arquivos / Tabelas / Funções Afetados:**
  - Serviços Frontend: `src/services/customers.service.ts`, `src/services/suppliers.service.ts`
  - Hooks Domain: `src/hooks/domains/useCustomersDomain.ts`, `src/hooks/domains/useSuppliersDomain.ts`
* **Sugestão de Correção:**
  Atualizar a assinatura das funções de atualização e remoção nos serviços para receber obrigatoriamente o `storeId` da loja ativa e incluir o filtro explicito na query Supabase:
  ```typescript
  await supabase
    .from('customers')
    .update(payload)
    .eq('id', uuid)
    .eq('store_id', storeId);
  ```

---

### Achado PERF-01: Ineficiência de Desempenho e CTEs Triplicadas na RPC `get_customer_directory_page`
* **Severidade:** **ALTO**
* **Descrição do Problema:**
  A função RPC `get_customer_directory_page` (migração `20261002234838_server_pagination_phase25c.sql`) declara e executa três vezes idênticas as CTEs pesadas `sales_agg` e `credit_agg`:
  1. Primeira execução: para calcular `v_total` (contagem de clientes filtrados).
  2. Segunda execução: para selecionar as linhas paginadas `v_rows`.
  3. Terceira execução: para gerar os agregados gerais da loja `v_stats`.

  Essa redundância quadruplica as leituras de disco/I/O e processamento de agregação de vendas no PostgreSQL em cada navegação de página do diretório de clientes.
* **Arquivos / Tabelas / Funções Afetados:**
  - Migração: `supabase/migrations/20261002234838_server_pagination_phase25c.sql`
  - Função RPC: `public.get_customer_directory_page(uuid, text, text, text, integer, integer)`
* **Sugestão de Correção:**
  Reescrever a função RPC consolidando a agregação base em uma única CTE com *Window Functions* (`count(*) OVER()`) para capturar o total geral e os dados paginados em uma única passagem de varredura no banco.

---

### Achado SEC-04: Avaliação de Permissão Global em Vez de Tenant na RLS de `product_costs`
* **Severidade:** **ALTO**
* **Descrição do Problema:**
  A política de Row Level Security para a tabela `product_costs` criada na migração `20260930010142_phase3_secure_cost_price_and_customers.sql`:
  ```sql
  CREATE POLICY "Product costs admin manager" ON public.product_costs
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_costs.product_id
      AND (SELECT current_user_role()) IN ('ADMIN','MANAGER')
  ));
  ```
  A função `current_user_role()` consulta a role global do perfil do usuário em `public.profiles`. O modelo multi-tenant do CoreSys define autorização granular por loja através de `user_store_access` e do helper `get_user_store_role(p_store_id)`.
  Com isso, um operador que possui perfil de `CASHIER` globalmente mas foi promovido a `MANAGER` em uma loja específica terá o acesso ao custo dos produtos bloqueado; inversamente, um `ADMIN` global rebaixado para `OPERATOR` em uma loja específica conseguirá visualizar custos confidenciais.
* **Arquivos / Tabelas / Funções Afetados:**
  - Migração: `supabase/migrations/20260930010142_phase3_secure_cost_price_and_customers.sql`
  - Tabela: `public.product_costs`
* **Sugestão de Correção:**
  Ajustar a política para verificar se o usuário possui papel `ADMIN` ou `MANAGER` em ao menos uma loja associada ao produto no estoque daquela loja (`store_inventory`), utilizando `get_user_store_role(si.store_id) IN ('ADMIN','MANAGER')`.

---

### Achado BUG-01: Falha no Tratamento de Resposta Não-JSON na Edge Function do PIX (`PdvView.tsx`)
* **Severidade:** **MÉDIO**
* **Descrição do Problema:**
  Em `src/components/pdv/PdvView.tsx`, no método `handleConfirmSale`, a chamada para a Supabase Edge Function `create-mp-pix` intercepta erros tratando o contexto de resposta via `await context.clone().json()`.
  Caso a Edge Function sofra um estouro de tempo limite (timeout 504), volte um erro HTML do Gateway Supabase ou caia antes de instanciar a resposta JSON, a chamada `.json()` lança uma exceção secundária de parsing no frontend. Isso faz com que a interface do PDV quebre sem exibir uma mensagem amigável para o operador.
* **Arquivos / Tabelas / Funções Afetados:**
  - Componente: `src/components/pdv/PdvView.tsx` (método `handleConfirmSale`)
* **Sugestão de Correção:**
  Envolver o parsing de erro da Edge Function em um bloco `try/catch` seguro com fallback para leitura textual (`context.text()`) caso o formato JSON seja inválido.

---

### Achado PERF-02: Ausência de Índices de Cobertura para Consultas de Relatórios de Lucratividade e Custos
* **Severidade:** **MÉDIO**
* **Descrição do Problema:**
  A tabela `product_costs` foi separada da tabela `products` para restringir a leitura da coluna `cost_price`. No entanto, as RPCs de relatório de lucratividade por produto e categoria (`get_profitability_by_product` e `get_profitability_by_category`) realizam JOINs frequentes entre `sale_items`, `products` e `product_costs`.
  Atualmente, faltam índices compostos nas colunas `(product_id, updated_at)` em `product_costs` e nos relacionamentos de vendas por período em `sales(store_id, status, created_at)`.
* **Arquivos / Tabelas / Funções Afetados:**
  - Banco de Dados: Tabelas `product_costs`, `sales`, `sale_items`
* **Sugestão de Correção:**
  Criar índices B-Tree específicos nas migrações do Supabase:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_sales_store_status_created
    ON public.sales(store_id, status, created_at);
  ```

---

### Achado QUAL-01: Advertências de Linter ESLint na Suíte de Frontend
* **Severidade:** **BAIXO**
* **Descrição do Problema:**
  A execução de `npm run lint` reportou 27 advertências (warnings) no código do frontend:
  - Importações e variáveis declaradas sem uso (`CreditCard`, `Filter`, `ChevronDown`, `Trash2`, `PlusCircle`, etc.) em `DashboardView.tsx`, `InventoryView.tsx`, `NewProductModal.tsx` e `NewReturnModal.tsx`.
  - Omissão de dependências em hooks `useEffect` em `RevenueChart.tsx`, `TopProductsChart.tsx`, `FinanceView.tsx` e `MovementsView.tsx`.
* **Arquivos / Tabelas / Funções Afetados:**
  - Componentes diversos em `src/components/`
* **Sugestão de Correção:**
  Remover variáveis e componentes não utilizados, e envolver as rotinas de carregamento de dados em `useCallback` para satisfazer o hook de dependências exaustivas do React.

---

## 4. Recomendações e Próximos Passos

1. **Priorização de Resolução:** As correções devem seguir rigorosamente a ordem de severidade **CRÍTICO > ALTO > MÉDIO > BAIXO**.
2. **Submissão via Pull Request:** Nenhuma alteração deve ser enviada diretamente para a branch principal sem a execução e aprovação das rotinas de testes integrados (`npm run typecheck`, `npm run lint`, `npm test`).
3. **Plano de Migração Supabase:** As alterações no schema e nas RLS do Supabase devem ser empacotadas em um novo arquivo de migração versionado (p.ex. `20261003000000_coresys_daily_audit_fixes.sql`).
