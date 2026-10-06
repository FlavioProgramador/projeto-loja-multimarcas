# Relatório de Auditoria Técnica Diária — CoreSys (2026-10-03)

**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Responsável:** Engenharia de Software Sênior / Auditoria Técnica CoreSys
**Data da Análise:** 03 de Outubro de 2026
**Status do Projeto:** Ativo (React 18 + TypeScript + Vite + Supabase PostgreSQL Multi-Tenant)

---

## 1. Resumo Executivo

Esta auditoria técnica analisou o estado atual do código-fonte frontend e do banco de dados Supabase conectado ao CoreSys. A análise cobriu aspectos de **segurança**, **isolamento multi-tenant**, **integridade de dados**, **funções `SECURITY DEFINER` e RLS**, **desempenho do banco de dados**, **qualidade do código frontend/hooks** e **tratamento de erros/loading**.

---

## 2. Visão Geral dos Achados

| ID | Categoria | Severidade | Título Sintético |
| :--- | :--- | :--- | :--- |
| **SEC-01** | Segurança / Multi-tenant | **CRÍTICO** | Mutação sem filtro de `store_id` nas atualizações/exclusões de Clientes, Despesas e Fornecedores no Frontend |
| **BUG-01** | Regra de Negócio / Permissões | **ALTO** | Bloqueio indevido do papel `CASHIER` na consulta paginada de devoluções (`get_returns_page`) |
| **PERF-01** | Banco de Dados / Desempenho | **ALTO** | Recalculo triplo e redundante de agregações completas de vendas/créditos na RPC `get_customer_directory_page` |
| **UX-01** | Frontend / Resiliência | **ALTO** | Falta de tratamento de erro e feedback em mutações de despesas e cadastro otimista |
| **CODE-01** | Qualidade / Lint | **MÉDIO** | 27 avisos no ESLint por dependências ausentes em React Hooks (`useEffect`/`useCallback`) e variáveis não utilizadas |
| **DATA-01** | Integridade / Banco | **MÉDIO** | Inconsistência na resolução do cliente sem CPF em vendas presenciais/PDV (`resolve_sale_customer_link`) |
| **PERF-02** | Desempenho / Frontend | **MÉDIO** | Buscas de fallback ("legacy") sem limite/paginação podendo carregar massa excessiva de dados para a memória |
| **ARCH-01** | Arquitetura / DX | **BAIXO** | Warnings de Fast Refresh do HMR devido a exportações mistas em arquivos de contexto (`Context.tsx`) |

---

## 3. Detalhamento dos Problemas e Sugestões de Correção

---

### [SEC-01] Mutação sem filtro de `store_id` nas atualizações/exclusões no Frontend
- **Classificação:** **CRÍTICO**
- **Explicação:**
  Em `CustomersService.update` e `CustomersService.remove`, o comando `.update(...)` no Supabase filtra exclusivamente por `.eq('id', uuid)` sem incluir o escopo `.eq('store_id', storeId)`. Do mesmo modo, em `FinanceService.toggleExpensePaid`, a atualização de `fixed_expenses` utiliza apenas `.eq('id', uuid)`. Em `SuppliersService.update` e `SuppliersService.remove`, a atualização ocorre apenas por `id`. Caso a política RLS do banco possua brechas ou caso um `uuid` de outro tenant seja injetado, existe risco real de mutação ou exclusão de registros de outra loja (IDOR/BOLA).
- **Arquivos/Tabelas/Funções Afetados:**
  - `src/services/customers.service.ts` (`update`, `remove`)
  - `src/services/finance.service.ts` (`toggleExpensePaid`)
  - `src/services/suppliers.service.ts` (`update`, `remove`)
  - Tabelas: `customers`, `fixed_expenses`, `suppliers`
- **Sugestão de Correção:**
  Passar obrigatoriamente o `storeId` ativo para esses métodos e incluir `.eq('store_id', storeId)` em todas as queries de `UPDATE` e `DELETE` no cliente Supabase:
  ```typescript
  await supabase
    .from('customers')
    .update(payload)
    .eq('id', uuid)
    .eq('store_id', storeId);
  ```

---

### [BUG-01] Bloqueio indevido do papel `CASHIER` na consulta paginada de devoluções
- **Classificação:** **ALTO**
- **Explicação:**
  A RPC `get_returns_page` criada na migração `20261002234838_server_pagination_phase25c.sql` possui a validação:
  ```sql
  v_role := public.get_user_store_role(p_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN', 'MANAGER') THEN
    RAISE EXCEPTION 'Permissão negada para devoluções desta loja.';
  END IF;
  ```
  Entretanto, a função que executa e processa a devolução (`process_return`) permite expressamente os papéis `'ADMIN'`, `'MANAGER'` e `'CASHIER'`. Isso gera uma incoerência funcional grave: o operador de caixa (`CASHIER`) consegue realizar uma devolução no balcão do PDV, mas não consegue consultar, filtrar ou visualizar o histórico de devoluções no sistema.
- **Arquivos/Tabelas/Funções Afetados:**
  - `supabase/migrations/20261002234838_server_pagination_phase25c.sql` (função `public.get_returns_page`)
  - `src/services/returns.service.ts`
- **Sugestão de Correção:**
  Atualizar a verificação de papel em `get_returns_page` para incluir `'CASHIER'`:
  ```sql
  IF v_role IS NULL OR v_role NOT IN ('ADMIN', 'MANAGER', 'CASHIER') THEN
    RAISE EXCEPTION 'Permissão negada para devoluções desta loja.';
  END IF;
  ```

---

### [PERF-01] Recalculo triplo e redundante de agregações na RPC `get_customer_directory_page`
- **Classificação:** **ALTO**
- **Explicação:**
  Dentro da RPC `get_customer_directory_page`, os blocos CTE de agregação (`sales_agg`, `credit_agg`, `base`, `filtered`) são repetidos 3 vezes idênticos na mesma execução PL/pgSQL:
  1. Primeiro bloco: executa a contagem total de registros (`SELECT count(*) INTO v_total FROM filtered;`).
  2. Segundo bloco: seleciona a página paginada com ordenação (`SELECT jsonb_agg(...) INTO v_rows FROM page_rows;`).
  3. Terceiro bloco: calcula os totais do cabeçalho estatístico (`SELECT jsonb_build_object(...) INTO v_stats FROM base;`).

  Em lojas com grande volume de vendas e movimentações, isso obriga o PostgreSQL a varrer e agregar a tabela inteira de vendas 3 vezes consecutivas por requisição de página.
- **Arquivos/Tabelas/Funções Afetados:**
  - `supabase/migrations/20261002234838_server_pagination_phase25c.sql` (função `public.get_customer_directory_page`)
  - Tabelas: `sales`, `customer_credit_movements`, `customers`
- **Sugestão de Correção:**
  Refatorar a função para estruturar as CTEs uma única vez no início do bloco e selecionar o resultado em uma única passagem:
  ```sql
  WITH base AS (...),
  filtered AS (...),
  stats_agg AS (SELECT count(*) as total, ... FROM base),
  page_rows AS (SELECT * FROM filtered ORDER BY ... LIMIT p_limit OFFSET p_offset)
  SELECT stats_agg.total, stats_agg.stats, COALESCE(jsonb_agg(page_rows), '[]'::jsonb) ...
  ```

---

### [UX-01] Falta de tratamento de erro e feedback em mutações de despesas
- **Classificação:** **ALTO**
- **Explicação:**
  No hook `useFinanceDomain.ts`, a chamada `FinanceService.toggleExpensePaid(target.uuid, target.pago)` realiza a atualização no estado local e tenta persistir via Supabase. Em caso de erro de rede ou desconexão, a exceção é lançada sem capturar uma mensagem de erro tratada para exibir toast ou feedback ao usuário na tela `FinanceView.tsx`.
- **Arquivos/Tabelas/Funções Afetados:**
  - `src/hooks/domains/useFinanceDomain.ts`
  - `src/components/finance/FinanceView.tsx`
- **Sugestão de Correção:**
  Adicionar manipulador de erro com notificação visual (toast/banner) e restauração garantida do estado em caso de falha remota.

---

### [CODE-01] Warnings no ESLint por dependências ausentes de React Hooks
- **Classificação:** **MÉDIO**
- **Explicação:**
  A execução do `npm run lint` gera 27 avisos. Entre eles:
  - `PdvView.tsx`: `handleConfirmSale` é passado em dependência de `useEffect` sem `useCallback`, provocando refetch em múltiplos re-renders.
  - `RevenueChart.tsx` e `TopProductsChart.tsx`: `useEffect` sem dependências `data` e `labels`.
  - Importações de ícones Lucide não utilizados em componentes visuais (`CreditCard`, `Filter`, `ChevronDown`, `Trash2`, `PlusCircle`, etc.).
- **Arquivos/Tabelas/Funções Afetados:**
  - `src/components/pdv/PdvView.tsx`
  - `src/components/dashboard/RevenueChart.tsx`
  - `src/components/dashboard/TopProductsChart.tsx`
  - `src/components/finance/FinanceView.tsx`
  - `src/components/movements/MovementsView.tsx`
  - `src/components/inventory/InventoryView.tsx`
- **Sugestão de Correção:**
  Envolver manipuladores em `useCallback`, corrigir arrays de dependências em `useEffect` e remover importações não utilizadas.

---

### [DATA-01] Inconsistência na resolução de clientes sem CPF em vendas presenciais
- **Classificação:** **MÉDIO**
- **Explicação:**
  O trigger `resolve_sale_customer_link` tenta associar vendas ao cliente cadastrado comparando a representação numérica do CPF. Quando a venda é registrada no PDV como 'Consumidor Final', o valor salvo no campo `customer_cpf` é a string `'Não informado'`. A expressão `regexp_replace('Não informado', '[^0-9]', '', 'g')` resulta em string vazia, mas se houver dados inconsistentes no campo `customer_cpf`, o vínculo pode falhar.
- **Arquivos/Tabelas/Funções Afetados:**
  - `supabase/migrations/20261002234838_server_pagination_phase25c.sql` (função `public.resolve_sale_customer_link`)
  - Tabela `sales`
- **Sugestão de Correção:**
  Tratar explicitamente strings como `'Não informado'` e valores com menos de 11 dígitos no trigger, retornando imediatamente sem efetuar busca de cliente.

---

### [PERF-02] Buscas de fallback ("legacy") no frontend sem paginação/limite
- **Classificação:** **MÉDIO**
- **Explicação:**
  Os métodos de fallback legados (`getLegacyAll`, `getLegacyCommercialSummary`) em `customers.service.ts`, `finance.service.ts`, `returns.service.ts` e `reports.service.ts` consultam tabelas inteiras de vendas, retornos e movimentações sem impor um limite `.limit()`. Em bases com histórico acumulado, isso transfere megabytes de dados desnecessários pela rede e sobrecarrega a memória do navegador.
- **Arquivos/Tabelas/Funções Afetados:**
  - `src/services/customers.service.ts` (`getLegacyAll`)
  - `src/services/reports.service.ts` (`getLegacyCommercialSummary`)
  - `src/services/returns.service.ts`
  - `src/services/finance.service.ts`
- **Sugestão de Correção:**
  Adicionar um limite de segurança (ex: `.limit(1000)`) e filtro de intervalo temporal nas buscas de fallback legadas.

---

### [ARCH-01] Warnings de Fast Refresh do HMR devido a exportações mistas
- **Classificação:** **BAIXO**
- **Explicação:**
  Os arquivos `AuthContext.tsx`, `CartContext.tsx`, `StoreContext.tsx` e `ThemeContext.tsx` exportam componentes React e constantes/funções utilitárias no mesmo arquivo, violando a regra de HMR do Vite (`react-refresh/only-export-components`).
- **Arquivos/Tabelas/Funções Afetados:**
  - `src/contexts/AuthContext.tsx`
  - `src/contexts/CartContext.tsx`
  - `src/contexts/StoreContext.tsx`
  - `src/contexts/ThemeContext.tsx`
- **Sugestão de Correção:**
  Extrair constantes e funções utilitárias para arquivos na pasta `src/lib/` ou `src/types/`.

---

## 4. Status das Verificações do Projeto

- **Testes Unitários (Vitest):** `39 passed` em 11 suítes de teste (100% de aprovação).
- **Verificação de Tipos (TypeScript `tsc --noEmit`):** `0 erros` encontrados.
- **Linter (ESLint):** `0 erros`, `27 avisos` de boas práticas (hooks/variáveis).

---

## 5. Próximos Passos Recomendados

1. **Prioridade 1 (Crítico/Alto):** Criar migration para ajustar a permissão do papel `CASHIER` em `get_returns_page` e otimizar as CTEs da RPC `get_customer_directory_page`.
2. **Prioridade 2 (Segurança):** Incluir o parâmetro `store_id` em todos os métodos de `UPDATE`/`DELETE` no frontend (`customers`, `fixed_expenses`, `suppliers`).
3. **Prioridade 3 (Qualidade/UX):** Resolver os 27 warnings do ESLint e adicionar tratamento visual de erro em mutações no `FinanceView`.
