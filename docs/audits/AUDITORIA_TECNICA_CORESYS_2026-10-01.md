# 📊 RELATÓRIO DE AUDITORIA TÉCNICA DIÁRIA - CORESYS / VESTRA ERP
**Data:** 01 de Outubro de 2026
**Repositório:** FlavioProgramador/projeto-loja-multimarcas
**Auditor Responsável:** Engenheiro de Software Sênior (CoreSys Technical Audit Lead)
**Status:** Concluído (Sem alterações automáticas nesta etapa)

---

## 🎯 RESUMO EXECUTIVO

Foi realizada uma análise minuciosa no código-fonte do frontend (React / TypeScript), na camada de serviços, nas definições de banco de dados do Supabase (SQL Migrations, RLS Policies, Triggers e RPCs PL/pgSQL) e nas Edge Functions (Mercado Pago / PIX).

| Métrica / Categoria | Resultado |
| :--- | :--- |
| **Nota Geral de Segurança & Multi-Tenant** | 6.5 / 10 |
| **Pronto para Produção (Multi-loja)** | ⚠️ **Não** (Requer ajustes de RLS e integridade de saldo antes de go-live) |
| **Problemas Críticos (CRÍTICO)** | 4 |
| **Problemas de Alto Impacto (ALTO)** | 2 |
| **Problemas de Médio Impacto (MÉDIO)** | 2 |
| **Problemas de Baixo Impacto (BAIXO)** | 2 |

---

## 📋 CATALOGAÇÃO DOS ACHADOS POR SEVERIDADE

### 🔴 SEVERIDADE: CRÍTICO

#### 1. Quebra de Isolamento Multi-Tenant em `public.customers` (Vulnerabilidade BOLA / IDOR & Vazamento de PII)
- **Explicação:**
  A tabela `customers` recebeu a coluna `store_id` na migração `20260828000003_multi_store.sql`. No entanto, as políticas de Row Level Security (RLS) mantiveram a regra `USING (true)` para `SELECT` e `UPDATE` (`"Customers viewable by authenticated"`, `"Customers updatable by authenticated"`).
  Isso permite que qualquer usuário autenticado de qualquer loja consulte, altere ou limpe os dados sensíveis (Nome, CPF, RG, Telefone, E-mail, Endereço, Histórico) de clientes pertencentes a **outras lojas**. Além disso, o serviço no frontend `CustomersService.update` executa `.from('customers').update(...).eq('id', uuid)` sem restringir por `store_id`.
- **Arquivos / Tabelas / Funções Afetados:**
  - Tabela: `public.customers`
  - Migrações: `supabase/migrations/20260828000001_hardening_rls.sql`, `20260828000003_multi_store.sql`
  - Frontend: `src/services/customers.service.ts` (`update`, `remove`)
- **Sugestão de Correção:**
  1. Recriar as políticas RLS na tabela `customers` para exigir que `store_id` pertença à loja acessível do usuário (`public.has_store_access(store_id)` ou `current_user_role() = 'ADMIN'`).
  2. Ajustar `CustomersService.update` e `CustomersService.remove` no frontend para incluir `.eq('store_id', storeId)`.

---

#### 2. Reuso Indevido e Duplo Gasto de Crédito de Cliente em Vendas PDV (Double-Spending / Exploit)
- **Explicação:**
  No fluxo de finalização de venda no PDV (`useSalesDomain.ts`), quando o cliente utiliza saldo de crédito acumulado (`creditUsed > 0`), o valor é repassado no parâmetro `discountValue` para a RPC `complete_sale`. A RPC aplica o desconto no valor final da venda, contudo **NÃO registra nenhum débito na tabela `customer_credit_movements`**.
  Ao terminar a venda, o frontend chama `refreshData()`, que busca os clientes atualizados do banco de dados. Como nenhuma movimentação de débito foi inserida no banco, a consulta recalcula o saldo de crédito com base no histórico no banco e **restaura o saldo total do cliente**. O cliente pode utilizar o mesmo saldo de crédito indefinidamente em compras ilimitadas.
- **Arquivos / Tabelas / Funções Afetados:**
  - RPC: `public.complete_sale`, `public.create_mp_pix_sale`
  - Tabela: `public.customer_credit_movements`
  - Frontend: `src/hooks/domains/useSalesDomain.ts`, `src/services/sales.service.ts`
- **Sugestão de Correção:**
  1. Alterar a RPC `complete_sale` para aceitar `p_credit_used numeric DEFAULT 0` e, quando `p_credit_used > 0`, inserir atomicamente um registro em `customer_credit_movements` do tipo `'DEBIT'` (com `reference_type = 'SALE'` e `reference_id = v_sale_id`).
  2. Passar o valor do crédito utilizado separadamente do desconto comercial no frontend.

---

#### 3. Quebra de Isolamento Multi-Tenant em `public.financial_transactions`
- **Explicação:**
  A política RLS para `SELECT` na tabela `financial_transactions` (`"Finance viewable by Admin and Manager"`) valida unicamente `public.current_user_role() IN ('ADMIN', 'MANAGER')`, sem conferir `public.has_store_access(store_id)`.
  Consequentemente, qualquer usuário que seja Gerente ou Admin em **qualquer** loja do sistema consegue ler a totalidade do faturamento, receita e despesas financeiras de todas as outras lojas do tenant via cliente Supabase REST.
- **Arquivos / Tabelas / Funções Afetados:**
  - Tabela: `public.financial_transactions`
  - Migrações: `supabase/migrations/20260101000000_setup.sql`, `20260828000003_multi_store.sql`
- **Sugestão de Correção:**
  Atualizar a política de `SELECT` da tabela `financial_transactions` para incluir a checagem `public.has_store_access(store_id) OR public.current_user_role() = 'ADMIN'`.

---

#### 4. Ausência de Isolamento Multi-Tenant e Vulnerabilidade BOLA em Despesas Fixas (`public.fixed_expenses`)
- **Explicação:**
  As políticas RLS de `fixed_expenses` (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) utilizam apenas a checagem global `current_user_role() IN ('ADMIN', 'MANAGER')`, desconsiderando o `store_id`.
  Paralelamente, no frontend, `FinanceService.toggleExpensePaid(uuid, currentPaidState)` executa um `UPDATE` filtrando apenas pelo UUID (`.eq('id', uuid)`). Um Gerente da Loja A consegue visualizar, alternar o status de pagamento ou apagar despesas da Loja B.
- **Arquivos / Tabelas / Funções Afetados:**
  - Tabela: `public.fixed_expenses`
  - Migrações: `supabase/migrations/20260101000000_setup.sql`, `20260828000001_hardening_rls.sql`
  - Frontend: `src/services/finance.service.ts` (`toggleExpensePaid`)
- **Sugestão de Correção:**
  1. Recriar todas as políticas RLS em `fixed_expenses` garantindo a verificação de `has_store_access(store_id)`.
  2. Adicionar o `storeId` como parâmetro obrigatório em `FinanceService.toggleExpensePaid` e incluir `.eq('store_id', storeId)`.

---

### 🟠 SEVERIDADE: ALTO

#### 5. Regressão de Leitura de Coluna Restrita (`products.cost_price`) no Cadastro de Estoque
- **Explicação:**
  A migração `20260930024000_restrict_product_cost_column_reads.sql` revogou o privilégio de `SELECT` na coluna `cost_price` da tabela `products` para a role `authenticated` (protegendo margens de custo).
  No entanto, no frontend, `InventoryService.registerStockEntry` tenta cadastrar novos produtos executando `.from('products').insert({...}).select().single()`. O método `.select()` do Supabase sem argumentos tenta ler todas as colunas (`SELECT *`), o que gera uma exceção imediata do PostgREST (`permission denied for column cost_price of table products`). A entrada de novos produtos pelo módulo de estoque falha por erro de permissão.
- **Arquivos / Tabelas / Funções Afetados:**
  - Tabela: `public.products`
  - Migração: `supabase/migrations/20260930024000_restrict_product_cost_column_reads.sql`
  - Frontend: `src/services/inventory.service.ts` (linhas 134-138)
- **Sugestão de Correção:**
  Especifique explicitamente as colunas no `select('id, name, sale_price, brand_id, category_id')` ou migre a criação do produto para a RPC `manage_product`.

---

#### 6. Inserção Direta em Tabelas Bloqueadas por RLS para Operador de Caixa (`CASHIER`) em `InventoryService`
- **Explicação:**
  `InventoryService.registerStockEntry` tenta realizar inserção direta nas tabelas `products` e `product_variants` via SDK JS antes de invocar a RPC `register_stock_entry`.
  Políticas de RLS proíbem escrita direta em `products` e `product_variants` para papéis como `CASHIER`. Se um operador de caixa tentar registrar uma entrada de estoque de um produto novo, a operação será bloqueada pela política RLS.
- **Arquivos / Tabelas / Funções Afetados:**
  - Arquivo: `src/services/inventory.service.ts`
  - Tabelas: `public.products`, `public.product_variants`
- **Sugestão de Correção:**
  Substituir a lógica de inserção direta pela chamada da RPC `manage_product` (que executa sob `SECURITY DEFINER` com as devidas verificações de permissão e auditoria).

---

### 🟡 SEVERIDADE: MÉDIO

#### 7. Armazenamento Local Unscoped no `localStorage` em Ambientes Multi-Tenant (`StoreContext`)
- **Explicação:**
  No `StoreContext`, as informações de produtos, fornecedores, despesas fixas e notificações são persistidas no `localStorage` sob chaves fixas (`erp_products`, `erp_suppliers`, `erp_fixed_expenses`, `erp_notifications`), sem associação ao `activeStoreId`.
  Em computadores compartilhados ou na alternância rápida entre lojas, dados em cache da Loja A permanecem visíveis temporariamente antes do recarregamento dos dados da Loja B, podendo causar vazamento visual entre tenants.
- **Arquivos / Tabelas / Funções Afetados:**
  - Frontend: `src/contexts/StoreContext.tsx` (linhas 89-92)
- **Sugestão de Correção:**
  Adicionar o sufixo da loja ativa nas chaves de armazenamento (ex: `erp_products_${activeStoreId}`) e limpar os dados locais no evento de logout ou troca de contexto.

---

#### 8. Ausência de `SET search_path = public` na Função de Trigger `protect_profile_role`
- **Explicação:**
  A função de trigger `protect_profile_role()` está definida com o modificador `SECURITY DEFINER`, mas não possui a instrução `SET search_path = public`. Funções `SECURITY DEFINER` sem `search_path` restrito ficam suscetíveis a ataques de injeção no caminho de busca SQL (`search path hijacking`).
- **Arquivos / Tabelas / Funções Afetados:**
  - Função: `public.protect_profile_role()`
  - Migração: `supabase/migrations/20260828000001_hardening_rls.sql`
- **Sugestão de Correção:**
  Aplicar `ALTER FUNCTION public.protect_profile_role() SET search_path = public;`.

---

### 🟢 SEVERIDADE: BAIXO

#### 9. Captura Silenciosa de Erro em `ProductsService.getById`
- **Explicação:**
  Ao buscar um produto por ID no `ProductsService.getById`, se ocorrer uma falha na RPC `get_product_for_management`, o código captura o erro apenas em `console.error` e retorna `null`. O componente chamador não diferencia um produto inexistente de um erro de conexão ou permissão.
- **Arquivos / Tabelas / Funções Afetados:**
  - Frontend: `src/services/products.service.ts`
- **Sugestão de Correção:**
  Lançar a exceção capturada para que a camada de UI exiba um aviso amigável de erro ao usuário.

---

#### 10. Formulário Frontend Permite Cadastro Sem Alerta de Margem de Custo
- **Explicação:**
  No modal `NewProductModal.tsx`, a interface não valida se o preço de venda informado é menor que o preço de custo antes do envio para a RPC `manage_product`. Embora o banco trate os dados, a validação no cliente melhoraria a experiência e previria erros operacionais do usuário.
- **Arquivos / Tabelas / Funções Afetados:**
  - Frontend: `src/components/inventory/NewProductModal.tsx`
- **Sugestão de Correção:**
  Inserir um aviso de validação no formulário prevenindo preços de venda zerados ou com margem negativa.

---

## 🛠️ PLANO DE AÇÃO RECOMENDADO PARA PRÓXIMA SPRINT

1. **Sprint P0 (Segurança & Multi-Tenant):**
   - Criar migração SQL para corrigir RLS de `customers`, `financial_transactions` e `fixed_expenses`.
   - Atualizar a RPC `complete_sale` para registrar débitos em `customer_credit_movements` quando houver uso de saldo de crédito.
   - Ajustar `SET search_path = public` na função `protect_profile_role`.

2. **Sprint P1 (Bugs Funcionais de Estoque & Cache):**
   - Corrigir o `.select(...)` em `InventoryService.registerStockEntry` para evitar a coluna restrita `cost_price`.
   - Refatorar a criação de produtos na entrada de estoque para usar a RPC `manage_product`.
   - Parametrizar o `localStorage` com `activeStoreId` em `StoreContext`.

---
**Relatório registrado em `docs/audits/AUDITORIA_TECNICA_CORESYS_2026-10-01.md`.**
