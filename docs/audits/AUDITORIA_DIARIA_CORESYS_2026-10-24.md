# 📊 AUDITORIA TÉCNICA DIÁRIA - CORESYS
**Data:** 24 de outubro de 2026
**Auditor:** Engenheiro de Software Sênior (Jules)
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Status:** Auditado — Achados e Recomendações Registrados

---

## 🎯 RESUMO EXECUTIVO

Foi realizada a auditoria técnica diária do sistema **CoreSys**, cobrindo o código frontend (React/TypeScript), hooks de contexto/domínio, serviços de integração Supabase, políticas de Row Level Security (RLS) e funções em PL/pgSQL.

### Quadro Geral de Vulnerabilidades e Inconsistências
| Severidade | Quantidade | Descrição Sucinta |
|:---:|:---:|:---|
| **CRÍTICO** | 1 | Riscos de BOLA/IDOR em mutações de Clientes e Despesas por falta de parâmetro `store_id` nas queries diretas |
| **ALTO** | 2 | Desincronização de estado de Clientes no frontend e Fornecedores operando sem isolamento de tenant (`store_id`) |
| **MÉDIO** | 2 | `ProductsService.getAll` sem filtragem/paginação no banco e ausência de feedback de erro visual no cadastro |
| **BAIXO** | 1 | Consultas com ILIKE `%pattern%` sem índice trigram em buscas de vendas para devolução |

---

## 🔴 1. ACHADOS CRÍTICOS (CRÍTICO)

### FINDING-01: Riscos BOLA/IDOR por Omissão do Filtro `store_id` em Mutações de Clientes e Despesas
* **Severidade:** **CRÍTICO**
* **Explicação do Problema:**
  Em `CustomersService.update` e `CustomersService.remove`, o código executa atualizações diretamente via `supabase.from('customers').update(...).eq('id', uuid)`. Similarmente, em `FinanceService.toggleExpensePaid`, a alteração executa `supabase.from('fixed_expenses').update(...).eq('id', uuid)`.
  Embora o RLS limite acessos por loja no banco de dados, a ausência de `.eq('store_id', storeId)` no código do cliente viola o princípio de Defesa em Profundidade. Se um usuário tiver acesso a múltiplas lojas da organização ou se houver regresso nas políticas RLS, ele poderá alterar clientes ou despesas de outra loja fornecendo apenas o `uuid`.
* **Arquivos e Tabelas Afetados:**
  - `src/services/customers.service.ts` (`CustomersService.update`, `CustomersService.remove`)
  - `src/services/finance.service.ts` (`FinanceService.toggleExpensePaid`)
  - Tabelas: `public.customers`, `public.fixed_expenses`
* **Sugestão de Correção:**
  Exigir e passar `storeId` obrigatoriamente para as rotinas de alteração/exclusão em `CustomersService` e `FinanceService`, incluindo a cláusula `.eq('store_id', storeId)` em todas as mutações Supabase.

---

## 🟠 2. ACHADOS DE ALTA SEVERIDADE (ALTO)

### FINDING-02: Desincronização do Estado do Frontend na Criação de Clientes e Vendas com Crédito
* **Severidade:** **ALTO**
* **Explicação do Problema:**
  1. Em `useCustomersDomain.ts`, a função `addCustomer` chama `await CustomersService.create(data, activeStoreId)`, porém **não atualiza o estado local `setCustomers` nem chama `refreshDomains('customers')`**. O cliente recém-cadastrado não aparece na UI até o recarregamento da página.
  2. Em `useSalesDomain.ts`, quando uma venda utiliza saldo de crédito do cliente (`creditUsed > 0`), a função invoca `refreshDomains('products', 'sales', 'transactions')`, **omitindo `'customers'`**. O saldo de crédito atualizado no Supabase não é sincronizado no estado de clientes do frontend.
* **Arquivos e Funções Afetados:**
  - `src/hooks/domains/useCustomersDomain.ts` (`addCustomer`)
  - `src/hooks/domains/useSalesDomain.ts` (`processSale`)
  - `src/contexts/StoreContext.tsx`
* **Sugestão de Correção:**
  1. Em `useCustomersDomain.ts`, invocar `refreshDomains('customers')` após a chamada bem-sucedida de `CustomersService.create`.
  2. Em `useSalesDomain.ts`, incluir `'customers'` nos domínios recarregados via `refreshDomains('products', 'sales', 'transactions', 'customers')`.

### FINDING-03: Operações de Fornecedores sem Isolamento por Tenant (`store_id`)
* **Severidade:** **ALTO**
* **Explicação do Problema:**
  O serviço `SuppliersService` realiza `getAll()`, `create()`, `update()` e `remove()` diretamente na tabela `suppliers` sem considerar nem aplicar filtro por `store_id`. Se os fornecedores forem específicos de cada loja, isso expõe parceiros comerciais entre lojas concorrentes na mesma plataforma multi-tenant.
* **Arquivos e Tabelas Afetados:**
  - `src/services/suppliers.service.ts` (`SuppliersService.getAll`, `create`, `update`, `remove`)
  - `src/hooks/domains/useSuppliersDomain.ts`
  - Tabela: `public.suppliers`
* **Sugestão de Correção:**
  Garantir a presença da coluna `store_id` na tabela `suppliers`, aplicar políticas RLS baseadas em `has_store_access(store_id)` e incluir a restrição de `store_id` nas requisições do `SuppliersService`.

---

## 🟡 3. ACHADOS DE MÉDIA SEVERIDADE (MÉDIO)

### FINDING-04: Carga Completa do Catálogo em `ProductsService.getAll` sem Paginação Server-Side
* **Severidade:** **MÉDIO**
* **Explicação do Problema:**
  Em `ProductsService.getAll(storeId)`, o sistema realiza a seleção de **todos** os produtos do banco e efetua a filtragem por `store_id` e estado ativo no código TypeScript via `.filter(...)`. Com o crescimento do catálogo, essa abordagem causará latência excessiva, consumo elevado de memória no cliente e sobrecarga de rede.
* **Arquivos e Tabelas Afetados:**
  - `src/services/products.service.ts` (`ProductsService.getAll`)
  - Tabelas: `public.products`, `public.product_variants`, `public.store_inventory`
* **Sugestão de Correção:**
  Migrar a listagem de produtos para uma RPC paginada no Supabase que aplique o filtro `store_id` diretamente nas cláusulas SQL.

### FINDING-05: Tratamento de Erros e Feedback de Loading Insuficientes no Cadastro de Entidades
* **Severidade:** **MÉDIO**
* **Explicação do Problema:**
  Ao realizar criações/edições nos modais de formulário (ex.: `NewCustomerModal`, `NewSupplierModal`), em caso de falha de comunicação com o Supabase ou erro de validação do banco, a mensagem de erro pode não ser devidamente exposta na interface do usuário (exibindo no máximo erro no console). Além disso, botões de ação não são desabilitados durante o envio, permitindo múltiplos cliques e submissões duplicadas.
* **Arquivos Afetados:**
  - `src/components/customers/NewCustomerModal.tsx`
  - `src/components/suppliers/NewSupplierModal.tsx`
  - `src/components/inventory/NewProductModal.tsx`
* **Sugestão de Correção:**
  Adicionar captura de erros com exibição de mensagem descritiva (toast/alert) e controlar o estado de `isSubmitting` para desabilitar botões de envio durante requisições.

---

## 🟢 4. ACHADOS DE BAIXA SEVERIDADE (BAIXO)

### FINDING-06: Consultas Textuais com Curinga Inicial (`%pattern%`) sem Índice Trigram
* **Severidade:** **BAIXO**
* **Explicação do Problema:**
  Em `SalesService.searchMovements`, a busca por vendas utiliza operadores `ilike.%pattern%` nas colunas `sale_number`, `customer_name` e `customer_cpf`. Como o padrão contém um curinga no início, o PostgreSQL realiza um scan sequencial (*Seq Scan*) na tabela `sales`.
* **Arquivos e Tabelas Afetados:**
  - `src/services/sales.service.ts` (`SalesService.searchMovements`)
  - Tabela: `public.sales`
* **Sugestão de Correção:**
  Criar índices GIN trigram (`pg_trgm`) para colunas de busca textual frequente na tabela `sales` ou utilizar a RPC de relatório comercial/vendas já indexada.

---

## 📋 CONCLUSÃO E RECOMENDAÇÕES

1. **Ações Prioritárias para a Próxima Sprint:**
   - Adicionar validações de `store_id` explícitas nas mutações de `CustomersService` e `FinanceService`.
   - Adicionar a chamada de `refreshDomains('customers')` em `useCustomersDomain.ts` e `useSalesDomain.ts`.
   - Verificar a estrutura multi-tenant da tabela `suppliers`.

2. **Integridade das Operações Críticas:**
   - As RPCs de checkout atômico (`complete_sale`), cancelamento (`cancel_sale`), devolução (`process_return`) e entrada de estoque (`register_stock_entry`) mantêm isolamento rigoroso por `store_id`, travas pessimistas `FOR UPDATE` / `pg_advisory_xact_lock` e proteções contra execução pública (`REVOKE FROM PUBLIC, anon`).

---
*Relatório gerado automaticamente via Auditoria Técnica Diária do CoreSys.*
