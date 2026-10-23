# Relatório de Auditoria Técnica Diária — CoreSys (Vestra ERP)
**Data:** 04 de Outubro de 2026
**Auditor:** Engenheiro de Software Sênior
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`

---

## Executive Summary

Foi realizada uma análise abrangente no estado atual do repositório, englobando o código do frontend (React / TypeScript), os serviços e contextos, as funções Edge (Deno), as políticas de segurança RLS (Row Level Security), as funções `SECURITY DEFINER`, e os esquemas do Supabase PostgreSQL.

A análise confirmou os recentes avanços e endurecimentos de segurança (como o isolamento por `store_id` nas RPCs de venda, devolução e controle financeiro). No entanto, foram identificados pontos que requerem atenção contínua e mitigação, variando entre isolamento multi-tenant de cadastros globais, falta de parâmetros defensivos em chamadas REST no cliente, criações não atômicas de produtos no fluxo de estoque e otimização de índices.

---

## Tabela Resumo dos Achados

| ID | Severidade | Categoria | Descrição Sucinta | Afetados |
|---|---|---|---|---|
| **AUD-01** | **ALTO** | Multi-tenant / Segurança | Tabela e serviço `suppliers` sem isolamento escopado por `store_id` | `SuppliersService`, tabela `suppliers` |
| **AUD-02** | **MÉDIO** | BOLA / IDOR | Chamadas do cliente `CustomersService.update` / `remove` sem `.eq('store_id', storeId)` | `src/services/customers.service.ts` |
| **AUD-03** | **ALTO** | Integridade / Transação | `InventoryService.registerStockEntry` realiza inserções REST diretas e encadeadas sem transação atômica | `src/services/inventory.service.ts` |
| **AUD-04** | **ALTO** | Segurança / DB | Funções `SECURITY DEFINER` e sobrecargas legadas requerem `REVOKE` explícito universal para assinaturas antigas | Migrações SQL e `pg_proc` |
| **AUD-05** | **MÉDIO** | Performance / Banco | Tabelas `fixed_expenses` e `customer_credit_movements` carecem de índice composto cobrindo `store_id` | `fixed_expenses`, `customer_credit_movements` |
| **AUD-06** | **BAIXO** | Qualidade / Frontend | Warnings de React Hooks (`useEffect`), Fast Refresh e variáveis não utilizadas no frontend | Vários componentes e contextos React |
| **AUD-07** | **MÉDIO** | Resiliência / Resposta de Erros | Truncamento e log de erros genéricos nas Edge Functions de Webhook e Reconciliação do Mercado Pago | `supabase/functions/mp-webhook/` |

---

## Análise Detalhada dos Problemas

### AUD-01 — Falta de Isolamento Escopado por Loja na Tabela e Serviço de Fornecedores (`suppliers`)
* **Severidade:** **ALTO**
* **Explicação:**
  A tabela `suppliers` e o serviço `SuppliersService` (`getAll`, `create`, `update`, `remove`) não possuem a coluna `store_id` nem realizam o filtro por loja. Atualmente, a política RLS concede permissão de gerenciamento global a usuários com papéis `ADMIN` ou `MANAGER`. Em um cenário multi-tenant com múltiplas lojas operadas por gestores distintos, alterações de fornecedores por um gestor afetam todas as lojas do ecossistema.
* **Arquivos / Tabelas / Funções Afetados:**
  - `src/services/suppliers.service.ts`
  - Tabela `public.suppliers`
* **Sugestão de Correção:**
  1. Adicionar a coluna `store_id uuid references public.stores(id)` à tabela `suppliers`.
  2. Ajustar as políticas RLS para verificar `has_store_access(store_id)`.
  3. Atualizar `SuppliersService` no frontend para incluir `storeId` em todas as consultas e atualizações.

---

### AUD-02 — Ausência do Filtro Defensivo `store_id` nas Operações `CustomersService.update` e `remove`
* **Severidade:** **MÉDIO**
* **Explicação:**
  No arquivo `src/services/customers.service.ts`, os métodos `update` e `remove` executam queries no Supabase utilizando apenas o identificador da entidade: `.eq('id', uuid)`. Embora as políticas de RLS garantam a verificação de permissão no banco, a prática de Defense-in-Depth para mitigação de IDOR/BOLA exige que o cliente passe obrigatoriamente a loja ativa em `.eq('store_id', storeId)`.
* **Arquivos / Tabelas / Funções Afetados:**
  - `src/services/customers.service.ts`
  - Tabela `public.customers`
* **Sugestão de Correção:**
  Alterar a assinatura de `update` e `remove` no `CustomersService` para aceitar `storeId` e incluir `.eq('store_id', storeId)` em todas as mutações no banco.

---

### AUD-03 — Criação Não Atômica de Produtos em `InventoryService.registerStockEntry`
* **Severidade:** **ALTO**
* **Explicação:**
  Quando a entrada de estoque refere-se a um produto inexistente, o método `InventoryService.registerStockEntry` faz inserções diretas em sequência REST cliente-side nas tabelas `brands`, `categories`, `products` e `product_variants` antes de invocar a RPC `register_stock_entry`. Se a conexão for interrompida ou ocorrer erro no meio do processo, são gerados registros órfãos ou incompletos no banco sem rollback transacional.
* **Arquivos / Tabelas / Funções Afetados:**
  - `src/services/inventory.service.ts`
  - Tabelas `products`, `product_variants`, `brands`, `categories`
* **Sugestão de Correção:**
  Refatorar a criação do produto para utilizar a RPC atômica `manage_product` ou encapsular todo o fluxo de entrada de novo produto em uma única RPC transacional no banco de dados.

---

### AUD-04 — Sobrecargas Antigas de Funções `SECURITY DEFINER` e Rigor de `search_path`
* **Severidade:** **ALTO**
* **Explicação:**
  Diversas migrações históricas definiram sobrecargas de funções como `complete_sale`, `register_stock_entry` e `process_return`. Embora as migrations recentes tenham revogado permissões de funções legadas (como `complete_sale` de 9 parâmetros), qualquer sobrecarga antiga remanescente com `SECURITY DEFINER` sem `SET search_path = public` representa risco de execução inadvertida ou sequestro de schema.
* **Arquivos / Tabelas / Funções Afetados:**
  - `supabase/migrations/*.sql`
  - Funções no esquema `public` (`register_stock_entry`, `process_return`, etc.)
* **Sugestão de Correção:**
  Realizar varredura em `pg_proc` no Supabase e garantir scripts de revogação explícita `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon` para todas as sobrecargas antigas, reforçando `SET search_path = public` em todas as funções `SECURITY DEFINER`.

---

### AUD-05 — Falta de Índices Compostos por `store_id` em Tabelas Financeiras
* **Severidade:** **MÉDIO**
* **Explicação:**
  Enquanto a tabela `customers` recebeu índice em `store_id`, as tabelas `fixed_expenses` e `customer_credit_movements` não possuem índice composto dedicado em `store_id` e em colunas de filtro como `due_date` ou `created_at`. Em ambientes com grande volume de dados por loja, isso gera escaneamentos sequenciais (`Seq Scan`) no PostgreSQL ao gerar relatórios e dashboards.
* **Arquivos / Tabelas / Funções Afetados:**
  - Tabela `public.fixed_expenses`
  - Tabela `public.customer_credit_movements`
* **Sugestão de Correção:**
  Criar os índices:
  - `CREATE INDEX IF NOT EXISTS idx_fixed_expenses_store_due ON public.fixed_expenses(store_id, due_date);`
  - `CREATE INDEX IF NOT EXISTS idx_credit_movements_store_customer ON public.customer_credit_movements(store_id, customer_id);`

---

### AUD-06 — Warnings de React Hooks (`useEffect`), Fast Refresh e Código Não Utilizado
* **Severidade:** **BAIXO**
* **Explicação:**
  A execução de `npm run lint` reportou 26 avisos (0 erros) referentes a dependências ausentes em hooks `useEffect` (ex: `DashboardView.tsx`, `RevenueChart.tsx`, `TopProductsChart.tsx`, `FinanceView.tsx`, `PdvView.tsx`), exportações incompatíveis com Fast Refresh em contextos e variáveis declaradas sem uso.
* **Arquivos / Tabelas / Funções Afetados:**
  - `src/components/dashboard/RevenueChart.tsx`
  - `src/components/dashboard/TopProductsChart.tsx`
  - `src/components/finance/FinanceView.tsx`
  - `src/components/pdv/PdvView.tsx`
  - `src/contexts/AuthContext.tsx`, `CartContext.tsx`, `StoreContext.tsx`
* **Sugestão de Correção:**
  Ajustar os arrays de dependência dos hooks com `useCallback` apropriado, remover variáveis não utilizadas e mover funções auxiliares para arquivos utilitários fora dos componentes React.

---

### AUD-07 — Melhoria na Captura e Log Estruturado de Erros nas Edge Functions de Integrador
* **Severidade:** **MÉDIO**
* **Explicação:**
  Na Edge Function `supabase/functions/mp-webhook/index.ts`, ao encontrar falhas com o Mercado Pago, o erro é capturado e retornado como HTTP 502/500 com mensagens genéricas. Para fins de auditoria de operabilidade e reconciliação de cobranças PIX, é recomendado registrar logs estruturados no Supabase sem expor segredos.
* **Arquivos / Tabelas / Funções Afetados:**
  - `supabase/functions/mp-webhook/index.ts`
  - `supabase/functions/create-mp-pix/index.ts`
* **Sugestão de Correção:**
  Enriquecer o log estruturado com contexto mascarado da transação e ID da loja.

---

## Conclusão e Recomendações

O CoreSys possui uma base sólida com RLS configurada e isolamento multi-loja em suas funções críticas de venda e financeiro. Recomenda-se priorizar as correções de severidade **ALTO** (escopo de fornecedores por loja e refatoração da criação não atômica de produtos) em sprints subsequentes.
