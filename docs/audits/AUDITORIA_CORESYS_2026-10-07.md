# 🔍 Relatório de Auditoria Técnica Diária - CoreSys
**Data:** 07 de Outubro de 2026
**Repositório:** FlavioProgramador/projeto-loja-multimarcas
**Auditor Responsável:** Jules (Engenheiro de Software Sênior)

---

## 📋 Resumo Executivo

A auditoria técnica diária abrangeu a verificação completa da aplicação **CoreSys (Vestra ERP/PDV)**, analisando o estado atual do código-fonte do frontend em React/TypeScript (Contextos, Hooks, Serviços e Componentes) e a infraestrutura de backend no Supabase (Schema PostgreSQL, políticas de isolamento Row Level Security - RLS, funções RPC transacionais com `SECURITY DEFINER` e Edge Functions).

A auditoria focou em:
1. **Segurança e Isolamento Multi-Tenant**: Garantia de estrita segregação de dados entre diferentes lojas.
2. **Integridade de Dados e Regras de Negócio**: Análise de fluxos transacionais, baixas de estoque e movimentações financeiras/créditos.
3. **Funções SECURITY DEFINER e RLS**: Verificação de autorização e proteções contra IDOR/BOLA.
4. **Performance do Banco de Dados**: Análise de índices, estratégias de busca e paginação.
5. **Arquitetura e Qualidade do Frontend**: Tratamento de erros, vazamentos de estado, reatividade e alertas de código.

---

## 🚨 Matriz de Achados e Classificação por Severidade

| ID | Descrição do Problema | Categorização | Severidade |
|---|---|---|---|
| **BUG-01** | Uso Infinito e Não Persistido de Crédito do Cliente no PDV | Integridade Financeira / BOLA | 🔴 **CRÍTICO** |
| **SEC-01** | BOLA/IDOR na Vinculação de Clientes em Vendas e Devoluções | Segurança Multi-Tenant | 🔴 **CRÍTICO** |
| **SEC-02** | Ausência de Isolamento Multi-Tenant na Tabela de Fornecedores (`suppliers`) | Segurança Multi-Tenant / RLS | 🟠 **ALTO** |
| **BUG-02** | Vazamento de Estado de Fornecedores no React Context (`StoreContext`) | Arquitetura Frontend / Estado | 🟠 **ALTO** |
| **PERF-01**| Ausência de Índices Compostos para Consultas do Diretório de Clientes | Performance no Banco | 🟡 **MÉDIO** |
| **ARCH-01**| Fallback Incondicional para Memória em Serviços de Paginação Frontend | Resiliência / Frontend | 🟡 **MÉDIO** |
| **CODE-01**| Avisos de ESLint (Hooks com Dependências Incompletas e Variáveis Mortas) | Qualidade de Código | 🟢 **BAIXO** |

---

## 🛠️ Detalhamento dos Achados

---

### 🔴 SEVERIDADE: CRÍTICO

#### 1. [BUG-01] Uso Infinito e Não Persistido de Créditos de Cliente no PDV
* **Explicação do Problema:**
  Quando um cliente utiliza saldo de crédito para abater o pagamento de uma venda no PDV (`creditUsed > 0`), a camada de domínio do frontend (`useSalesDomain.ts`) adiciona o valor do crédito ao parâmetro `discountValue` e invoca a RPC `complete_sale`. A RPC registra a venda com um desconto comercial estendido (`discount`), porém **não insere nenhum registro do tipo `'DEBIT'` na tabela `customer_credit_movements`**, nem valida se o cliente possui saldo de crédito real suficiente no banco de dados.
  O abatimento ocorre apenas no estado em memória da aplicação React (`setCustomers`). Assim que a página é atualizada ou os dados são re-sincronizados via `refreshDomains`, o saldo do cliente é recalculado no banco através de `customer_credit_movements`, onde o crédito permanece intacto. Isso permite que um cliente reutilize o mesmo saldo de crédito indefinidamente.
* **Componentes / Funções / Tabelas Afetados:**
  - **Frontend:** `src/hooks/domains/useSalesDomain.ts`, `src/services/sales.service.ts`
  - **Backend SQL:** Functions `public.complete_sale`, `public.create_mp_pix_sale`
  - **Tabela:** `public.customer_credit_movements`
* **Sugestão de Correção:**
  1. Alterar a assinatura das RPCs `complete_sale` e `create_mp_pix_sale` para aceitarem explicitamente o parâmetro `p_credit_used NUMERIC DEFAULT 0`.
  2. Dentro da RPC, calcular o saldo de crédito atual do cliente na loja (`SUM(CREDIT) - SUM(DEBIT)`) e levantar exceção se `saldo < p_credit_used`.
  3. Se `p_credit_used > 0`, inserir atomicamente um registro em `public.customer_credit_movements`:
     ```sql
     INSERT INTO public.customer_credit_movements (
       store_id, customer_id, type, amount, description, reference_type, reference_id
     ) VALUES (
       p_store_id, v_customer_id, 'DEBIT', round(p_credit_used, 2),
       'Uso de crédito na venda ' || v_sale_number, 'SALE', v_sale_id
     );
     ```
  4. Atualizar o frontend (`useSalesDomain.ts` e `SalesService.ts`) para passar `creditUsed` separadamente do desconto da venda.

---

#### 2. [SEC-01] BOLA / IDOR na Vinculação de Clientes em Vendas e Devoluções
* **Explicação do Problema:**
  Nas funções SQL com `SECURITY DEFINER` (`complete_sale`, `create_mp_pix_sale` e `process_return`), a verificação de existência do cliente informado (`p_customer_id`) realiza apenas:
  `EXISTS (SELECT 1 FROM public.customers WHERE id = v_customer_id AND is_active = true)`
  sem checar a restrição de loja `AND store_id = p_store_id`.
  Além disso, o fallback de busca automática por CPF em `process_return` e `create_mp_pix_sale` executa `SELECT id FROM customers WHERE cpf = p_customer_cpf AND is_active = true LIMIT 1` sem limitar ao `store_id`.
  Um operador malicioso ou usuário autenticado na Loja A pode enviar o ID ou CPF de um cliente pertencente à Loja B, provocando a criação de vendas, movimentações financeiras e emissão/abatimento de créditos de devolução associados a um cliente de outra loja (quebra do isolamento multi-tenant / BOLA).
* **Componentes / Funções / Tabelas Afetados:**
  - **Backend SQL:** Functions `public.complete_sale`, `public.create_mp_pix_sale`, `public.process_return`
  - **Tabela:** `public.customers`
* **Sugestão de Correção:**
  Em todas as consultas e subqueries que acessam `public.customers` dentro de funções SQL transacionais, incluir obrigatoriamente a cláusula `AND store_id = p_store_id`:
  ```sql
  IF v_customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers
    WHERE id = v_customer_id AND store_id = p_store_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Cliente não encontrado ou não pertence a esta loja.';
  END IF;
  ```

---

### 🟠 SEVERIDADE: ALTO

#### 3. [SEC-02] Ausência de Isolamento Multi-Tenant na Tabela de Fornecedores (`suppliers`)
* **Explicação do Problema:**
  A tabela `suppliers` não possui a coluna `store_id`. Suas políticas de Row Level Security (RLS) autorizam qualquer usuário autenticado com perfil `ADMIN` ou `MANAGER` a visualizar e manipular qualquer fornecedor na tabela global.
  No frontend, `SuppliersService.getAll()` realiza a leitura em `suppliers` sem nenhum filtro de loja. Consequentemente, gestores da Loja A conseguem visualizar, editar e inativar fornecedores cadastrados pelos gestores da Loja B.
* **Componentes / Funções / Tabelas Afetados:**
  - **Tabela:** `public.suppliers`
  - **Frontend:** `src/services/suppliers.service.ts`, `src/hooks/useStoreData.ts`
  - **Migrações:** `20260101000000_setup.sql`, `20260828000001_hardening_rls.sql`
* **Sugestão de Correção:**
  1. Criar migração adicionando a coluna `store_id UUID NOT NULL REFERENCES public.stores(id)` à tabela `suppliers`.
  2. Atualizar as políticas RLS para exigir `has_store_access(store_id)` nas consultas e mutações.
  3. Atualizar o `SuppliersService` no frontend para incluir `store_id` nas leituras e criações.

---

#### 4. [BUG-02] Vazamento de Estado de Fornecedores no React Context (`StoreContext`)
* **Explicação do Problema:**
  No arquivo `StoreContext.tsx`, o efeito colateral (`useEffect`) que detecta a alteração de loja ativa (`activeStoreId`) reseta os estados de produtos, transações, movimentações, clientes, devoluções, despesas fixas e notificações, mas **omite o estado `suppliers`**.
  Como resultado, ao trocar de loja na interface, a lista de fornecedores da loja anterior permanece mantida em memória no componente React.
* **Componentes / Funções / Tabelas Afetados:**
  - **Frontend:** `src/contexts/StoreContext.tsx`
* **Sugestão de Correção:**
  Incluir a chamada `setSuppliers([])` dentro da função de limpeza do `useEffect` acionado por mudança de `activeStoreId` em `StoreContext.tsx`.

---

### 🟡 SEVERIDADE: MÉDIO

#### 5. [PERF-01] Ausência de Índices Compostos para Consultas do Diretório de Clientes
* **Explicação do Problema:**
  As buscas e listagens paginadas de clientes (`get_customer_directory_page` e `search`) filtram repetidamente pela combinação de `store_id = p_store_id AND is_active = true`. A tabela possui índices individuais em `name` e `cpf`, mas não possui um índice composto cobrindo `(store_id, is_active)` nem `(store_id, cpf)`.
  Em bases de clientes de grande porte, isso resulta em custo desnecessário de varredura (*Seq Scan*) e maior tempo de resposta no banco de dados.
* **Componentes / Funções / Tabelas Afetados:**
  - **Tabela:** `public.customers`
  - **Backend SQL:** Function `public.get_customer_directory_page`
* **Sugestão de Correção:**
  Criar os seguintes índices na tabela `customers`:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_customers_store_active ON public.customers(store_id, is_active);
  CREATE INDEX IF NOT EXISTS idx_customers_store_cpf ON public.customers(store_id, cpf) WHERE is_active = true;
  ```

---

#### 6. [ARCH-01] Fallback Incondicional para Memória em Serviços de Paginação Frontend
* **Explicação do Problema:**
  Nos serviços `CustomersService.ts`, `ReturnsService.ts` e `FinanceService.ts`, quando a chamada à RPC paginada do servidor retorna um erro, o bloco `catch` executa rotinas legadas de fallback (`getLegacyAll`, `getAll`) que buscam **todos os registros sem paginação** diretamente do Supabase e realizam filtros e ordenações na memória do navegador.
  Em cenários onde a RPC falha por estouro de tempo ou indisponibilidade temporária do banco, essa tentativa de carregar o conjunto completo de dados aumenta drasticamente o consumo de memória e tráfego de rede no dispositivo do usuário.
* **Componentes / Funções / Tabelas Afetados:**
  - **Frontend:** `src/services/customers.service.ts`, `src/services/returns.service.ts`, `src/services/finance.service.ts`
* **Sugestão de Correção:**
  Garantir que o fallback para memória só ocorra caso a função RPC explicitamente não exista no servidor (`PGRST202`). Caso a RPC exista e retorne outro erro (como timeout ou permissão negada), relançar a exceção para que a UI informe a falha adequadamente ao usuário.

---

### 🟢 SEVERIDADE: BAIXO

#### 7. [CODE-01] Avisos do Linter ESLint (Variáveis Mortas e Dependências em Hooks)
* **Explicação do Problema:**
  A execução do comando `npm run lint` apresentou 27 avisos no frontend, consistindo em:
  - Ícones e utilitários importados sem uso em componentes (`CreditCard`, `Filter`, `Trash2`, `PlusCircle`, `ArrowUp`, `AlertCircle`, `User`, etc.).
  - Dependências ausentes em `useEffect` nos componentes `RevenueChart.tsx`, `TopProductsChart.tsx`, `FinanceView.tsx`, `MovementsView.tsx` e `PdvView.tsx`.
  - Exportações mistas de constantes/funções junto de componentes em arquivos de contexto (`AuthContext.tsx`, `CartContext.tsx`, `StoreContext.tsx`, `ThemeContext.tsx`), acionando avisos do Fast Refresh.
* **Componentes / Funções / Tabelas Afetados:**
  - **Frontend:** Diversos componentes em `src/components/` e contextos em `src/contexts/`.
* **Sugestão de Correção:**
  - Remover importações e variáveis não utilizadas.
  - Ajustar os arrays de dependência dos hooks com `useCallback`.
  - Mover utilitários dos contextos para arquivos utilitários dedicados.

---

## 📊 Status da Suite de Testes e Qualidade

- **TypeScript Typecheck (`npm run typecheck`):** PASSADO (0 erros).
- **ESLint (`npm run lint`):** PASSADO (0 erros, 27 avisos de severidade baixa).
- **Testes Unitários Vitest (`npm test`):** PASSADO (11 suítes de testes, 39 testes executados e aprovados).

---

## 📝 Conclusão e Próximos Passos Recomendados

A arquitetura do CoreSys apresenta forte isolamento na maioria das entidades principais (Vendas, Estoque por Loja, Transações Financeiras) e excelente cobertura por RPCs atômicas com locks pessimistas (`FOR UPDATE`).

Entretanto, para atingir o nível máximo de segurança e conformidade multi-tenant, **recomenda-se priorizar as seguintes correções na ordem**:
1. **[BUG-01 & SEC-01]**: Atualizar a RPC `complete_sale` e a camada de domínio `useSalesDomain` para debitar atomicamente o crédito do cliente em `customer_credit_movements` e impor `store_id = p_store_id` nas buscas por cliente.
2. **[SEC-02 & BUG-02]**: Adicionar `store_id` à tabela `suppliers`, ajustar RLS e resetar o estado de fornecedores ao alternar de loja no `StoreContext`.
3. **[PERF-01 & ARCH-01]**: Adicionar os índices compostos de performance na tabela `customers` e refinar as exceções dos fallbacks paginados nos serviços do frontend.
