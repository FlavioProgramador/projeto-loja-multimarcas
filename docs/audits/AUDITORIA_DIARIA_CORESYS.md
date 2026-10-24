# 🛡️ Relatório de Auditoria Técnica Diária — CoreSys ERP/PDV

**Data:** 08 de Outubro de 2026
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Escopo:** Frontend (React/TypeScript), Backend (Supabase Services, Edge Functions) e Banco de Dados (PostgreSQL, RLS, RPCs, Auth, Multi-tenant)

---

## 📊 RESUMO EXECUTIVO DA AUDITORIA

| Categoria | Status | Observações |
|-----------|--------|-------------|
| **Isolamento Multi-Tenant & RLS** | 🟡 BOM (Com ressalvas no frontend) | RLS e RPCs no Supabase aplicam isolamento `store_id` rigorosamente. No frontend, `DashboardService` e `SuppliersService` possuem consultas globais/não escopadas por loja. |
| **Segurança Supabase Auth & RPCs** | 🟢 EXCELENTE | RPCs críticas contêm proteção fail-closed para funções de perfil/loja, `SET search_path = public`, revogação para `anon`/`PUBLIC` e permissões restritas. |
| **Edge Functions & Webhooks (PIX)** | 🟢 EXCELENTE | Validação HMAC SHA-256 no webhook do Mercado Pago, token worker para reconciliação e idempotência transacional. |
| **Proteção de Dados Sensíveis (Preço de Custo)** | 🟢 EXCELENTE | Coluna `products.cost_price` protegida no banco. RPCs segregam visualização por privilégio (`get_product_for_management` / `manage_product`). |
| **Qualidade de Código & Linting** | 🟡 BOM (26 Avisos ESLint) | Ausência de erros críticos de compilação ou tipo TypeScript, mas 26 avisos no ESLint (variáveis não utilizadas e dependências de `useEffect`). |

---

## 🚨 DIAGNÓSTICO DE PROBLEMAS E VULNERABILIDADES

---

### 1. `DashboardService.getMetrics` Consulta Vendas e Estoque Sem Escopo de Loja (`store_id`)

- **Severidade:** **MÉDIO**
- **Descrição:**
  A função `DashboardService.getMetrics()` em `src/services/dashboard.service.ts` realiza consultas diretamente nas tabelas `sales` e `product_variants` sem aplicar o filtro `.eq('store_id', storeId)`. Em um ambiente multi-tenant ou para usuários administradores com acesso a múltiplas lojas, o dashboard agrega faturamento e métricas de estoque baixo de todas as lojas, quebrando o isolamento de dados no nível de apresentação.
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivo: `src/services/dashboard.service.ts` (Função `DashboardService.getMetrics`)
  - Tabelas: `sales`, `product_variants`
- **Sugestão de Correção:**
  Atualizar a assinatura para `getMetrics(storeId?: string)` e incluir o parâmetro `.eq('store_id', storeId)` na busca de vendas, bem como correlacionar os itens de baixo estoque via `store_inventory` filtrado por `store_id`.

---

### 2. Gestão de Fornecedores Sem Escopamento Multi-Tenant

- **Severidade:** **MÉDIO**
- **Descrição:**
  O serviço `SuppliersService` em `src/services/suppliers.service.ts` consulta e altera a tabela `suppliers` de forma global (`.from('suppliers').select('*')`), sem suporte ou filtro por `store_id`. Embora a tabela seja protegida por RLS por papel (`ADMIN`/`MANAGER`), os fornecedores ficam expostos globalmente para todas as lojas.
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivo: `src/services/suppliers.service.ts`
  - Tabela: `suppliers`
- **Sugestão de Correção:**
  Se os fornecedores devem ser segregados por loja, adicionar a coluna `store_id` à tabela `suppliers` e estender `SuppliersService` para exigir `storeId` em todas as operações de listagem e mutação. Se for um catálogo compartilhado intencional, documentar e manter restrição por RBAC.

---

### 3. Criação de Cliente com Parâmetro de Loja Opcional (`storeId?: string`)

- **Severidade:** **BAIXO**
- **Descrição:**
  No arquivo `src/services/customers.service.ts`, a função `CustomersService.create` define o parâmetro `storeId` como opcional (`storeId?: string`). Caso um chamador invoque a função sem passar a loja ativa, o registro será inserido com `store_id: undefined` (que se converte em NULL), podendo causar erro de restrição NOT NULL ou falha de isolamento no Supabase.
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivo: `src/services/customers.service.ts` (Método `create`)
  - Tabela: `customers`
- **Sugestão de Correção:**
  Tornar `storeId: string` um parâmetro obrigatório na assinatura de `CustomersService.create(customer, storeId: string)`.

---

### 4. Avisos de Qualidade de Código e Módulos React (26 Avisos ESLint)

- **Severidade:** **BAIXO**
- **Descrição:**
  Foram identificados 26 avisos de ESLint no projeto, incluindo:
  - Variáveis/ícones importados e não utilizados (ex: `CreditCard`, `formatPaymentMethod`, `StockStatus`, `Trash2`, `PlusCircle`).
  - Dependências ausentes em Hooks `useEffect` em `RevenueChart.tsx`, `TopProductsChart.tsx`, `FinanceView.tsx`, `MovementsView.tsx` e `PdvView.tsx`.
  - Exportação de funções/constantes utilitárias no mesmo arquivo de componentes nos contextos `AuthContext`, `CartContext`, `StoreContext` e `ThemeContext` (aviso de Fast Refresh).
- **Arquivos/Tabelas/Funções Afetados:**
  - `src/components/dashboard/DashboardView.tsx`
  - `src/components/dashboard/RevenueChart.tsx`
  - `src/components/dashboard/TopProductsChart.tsx`
  - `src/components/finance/FinanceView.tsx`
  - `src/components/inventory/InventoryView.tsx`
  - `src/components/movements/MovementsView.tsx`
  - `src/components/pdv/PdvView.tsx`
  - `src/components/returns/NewReturnModal.tsx`
  - `src/components/suppliers/SupplierForm.tsx`
  - `src/contexts/*.tsx`
- **Sugestão de Correção:**
  - Remover variáveis não utilizadas.
  - Envolver funções de manipuladores em `useCallback` e ajustar arrays de dependências dos `useEffect`.
  - Mover ajudantes de contextos para arquivos utilitários dedicados.

---

## 🔒 ANÁLISE DE SEGURANÇA, AUTH E SUPABASE RLS

1. **Row Level Security (RLS) & Isolação Multi-Tenant:**
   - As tabelas críticas (`sales`, `store_inventory`, `financial_transactions`, `fixed_expenses`, `customers`, `returns`, `physical_inventories`, `automation_rules`) possuem políticas RLS alinhadas a `public.has_store_access(store_id)` e `public.get_user_store_role(store_id)`.
   - A imunidade de alterações diretas na tabela `sales` garante integridade de faturamento, exigindo o uso de RPCs com controle transacional (`complete_sale`, `cancel_sale`).

2. **Segurança de RPCs (`SECURITY DEFINER`):**
   - A migração `20261003000000_coresys_audit_final_remediation.sql` remediou e endureceu as funções RPCs:
     - `complete_sale`, `create_mp_pix_sale`, `cancel_sale`, `register_stock_entry`, `process_return`, `manage_product`.
     - Definidas com `SET search_path = public`.
     - Verificação fail-closed: `IF v_role IS NULL OR v_role NOT IN (...) THEN RAISE EXCEPTION 'Permissão negada'; END IF;`.
     - Permissões explícitas: `REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated;`.

3. **Edge Functions e Integração PIX:**
   - `create-mp-pix`: Valida autenticação Bearer JWT do chamador e invoca a RPC do usuário `create_mp_pix_sale`.
   - `mp-webhook`: Implementa verificação de assinatura HMAC SHA-256 (`x-signature`), janelas de expiração (600s) e tratamento idempotente anti-replay (`claim_mp_webhook_event`).
   - `mp-pix-reconciliation-worker`: Valida token de worker via `verify_pix_worker_token` antes de processar vendas estagnadas.

---

## 📈 PERFORMANCE E BANCO DE DADOS

- **Índices de Chave Estrangeira e Tenant:**
  - Índices criados para consultas multi-loja frequentes: `idx_customers_store_id`, `idx_sales_store_status`, `idx_inventory_movements_store_created`, `idx_automation_runs_store_id`.
- **Concorrência e Idempotência:**
  - O uso de `pg_advisory_xact_lock` e tabela `sale_idempotency` em `complete_sale` impede duplicação de vendas sob concorrência intensa.

---

## 🎯 CONCLUSÃO E PRÓXIMOS PASSOS

Nenhum problema de severidade **CRÍTICO** ou **ALTO** foi encontrado nesta auditoria. O sistema apresenta excelente maturidade de segurança no banco de dados e backend.

**Ações recomendadas para as próximas iterações:**
1. Atualizar `DashboardService.getMetrics` para aceitar `storeId`.
2. Tornar `storeId` obrigatório em `CustomersService.create`.
3. Executar refatoração de código morto e pequenos avisos de linting no frontend.
