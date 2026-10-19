# Relatório de Auditoria Técnica Diária - CoreSys

**Data:** 03 de Outubro de 2026
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Responsável:** Engenheiro de Software Sênior (Auditoria CoreSys)
**Status da Avaliação:** Concluída (Sem alterações automáticas de código nesta etapa)

---

## Executive Summary (Resumo Executivo)

Esta auditoria técnica diária analisou a integridade da aplicação **CoreSys**, abrangendo o código do frontend React/TypeScript, configurações e políticas de segurança do Supabase (RLS, Auth e RPCs), o modelo multi-tenant, validações de entrada e o estado de Edge Functions.

A arquitetura geral do CoreSys evoluiu com a aplicação de migrações de hardening e RPCs `SECURITY DEFINER` protegidas com `SET search_path = public` e verificação de privilégios via `user_store_access`. Contudo, identificamos **gargalos críticos e altos de isolamento multi-tenant** no frontend e no modelo de fornecedores, além de pontos de atenção em rotinas de cálculo do dashboard e tratamento de erros.

---

## Matriz de Severidade dos Achados

| ID | Classificação | Problema Encontrado | Componentes Afetados |
| :--- | :---: | :--- | :--- |
| **M-01** | **CRÍTICO** | Agregação multi-tenant indevida e consulta sem `store_id` no serviço do Dashboard | `src/services/dashboard.service.ts`, `DashboardView.tsx` |
| **M-02** | **ALTO** | Ausência de campo e isolamento multi-tenant na gestão de Fornecedores (`suppliers`) | `src/services/suppliers.service.ts`, tabela `public.suppliers` |
| **M-03** | **ALTO** | Parâmetro `storeId` opcional na criação de clientes (`CustomersService.create`) | `src/services/customers.service.ts` |
| **M-04** | **MÉDIO** | Estratégia de fallback legado em memória para páginas e relatórios paginados | `src/services/returns.service.ts`, `customers.service.ts`, `finance.service.ts` |
| **M-05** | **MÉDIO** | Padronização de validação de perfil ativo em RPCs `SECURITY DEFINER` secundárias | Migrações Supabase (`supabase/migrations/`) |
| **M-06** | **BAIXO** | Warnings de linter (variáveis/imports não utilizados e dependências de React Hooks) | Diversos componentes em `src/components/` e `src/contexts/` |

---

## Análise Detalhada dos Achados

### M-01 [CRÍTICO] - Agregação multi-tenant indevida e consulta sem `store_id` no Dashboard

- **Explicação**:
  O serviço `DashboardService.getMetrics()` executa a consulta `supabase.from('sales').select(...)` sem filtrar por `store_id` e sem aceitar a loja ativa como parâmetro. Para usuários que possuem permissão de acesso a múltiplas lojas no sistema, o dashboard acumula vendas, faturamento mensal, faturamento do dia e ticket médio de **todas** as lojas simultaneamente. Além disso, a verificação de itens em estoque baixo realiza a contagem `product_variants.stock_quantity <= 2` de forma global, ignorando a tabela `store_inventory` correspondente à loja selecionada.
- **Arquivos/Tabelas/Funções Afetados**:
  - `src/services/dashboard.service.ts` (`DashboardService.getMetrics`)
  - `src/components/dashboard/DashboardView.tsx`
  - Tabelas: `public.sales`, `public.product_variants`, `public.store_inventory`
- **Sugestão de Correção**:
  1. Alterar a assinatura para `DashboardService.getMetrics(storeId: string)`.
  2. Adicionar `.eq('store_id', storeId)` na consulta à tabela `sales`.
  3. Contar o estoque baixo filtrando a tabela `store_inventory` pelo `store_id` da loja ativa.
  4. Atualizar o invocador no frontend (`useStoreData`) para passar o `activeStoreId`.

---

### M-02 [ALTO] - Ausência de isolamento multi-tenant na tabela e serviço de Fornecedores

- **Explicação**:
  A tabela `public.suppliers` e o serviço `SuppliersService` (`src/services/suppliers.service.ts`) não possuem o campo `store_id`. Atualmente, os fornecedores são globais. Quando um usuário com perfil de gerenciamento altera (`update`) ou desativa (`remove`) um fornecedor em uma loja, a alteração reflete imediatamente para todas as outras lojas da plataforma.
- **Arquivos/Tabelas/Funções Afetados**:
  - `src/services/suppliers.service.ts`
  - Tabela: `public.suppliers`
  - Migrações: `supabase/migrations/20260101000000_setup.sql`, `supabase/migrations/20260828000001_hardening_rls.sql`
- **Sugestão de Correção**:
  1. Criar migração SQL adicionando `store_id uuid REFERENCES public.stores(id)` à tabela `suppliers`.
  2. Configurar política RLS baseada na função `has_store_access(store_id)`.
  3. Atualizar `SuppliersService` para exigir e repassar `store_id` em todas as operações CRUD.

---

### M-03 [ALTO] - Parâmetro `storeId` opcional na criação de clientes em `CustomersService.create`

- **Explicação**:
  A função `CustomersService.create(customer, storeId?: string)` aceita `storeId` como um argumento opcional. Contudo, em migrações recentes do banco (`20260930010321_phase3_finalize_tenant_customers_and_cost_privileges.sql`), a coluna `store_id` da tabela `customers` foi configurada como `NOT NULL`. Quando chamada sem `storeId`, a inserção falha diretamente no banco de dados, sem tratamento amigável na interface do usuário.
- **Arquivos/Tabelas/Funções Afetados**:
  - `src/services/customers.service.ts` (`CustomersService.create`)
  - `src/hooks/domains/useCustomersDomain.ts`
  - Tabela: `public.customers`
- **Sugestão de Correção**:
  1. Alterar a assinatura do método para `create(customer, storeId: string)`.
  2. Adicionar verificação defensiva lançando uma exceção amigável caso `storeId` esteja vazio ou indefinido antes de disparar a requisição HTTP.

---

### M-04 [MÉDIO] - Estratégias de Fallback Legado em Memória para Rotinas Paginadas

- **Explicação**:
  Nos serviços `ReturnsService.getPage`, `CustomersService.getDirectoryPage` e `FinanceService.getPage`, existem blocos de *fallback* que, caso a RPC principal do banco retorne erro de função não encontrada (`PGRST202`), baixam **todos** os registros da loja para a memória do navegador e realizam ordenação/paginação via JavaScript. Em um ambiente de produção de grande porte, isso resulta em consumo elevado de memória do cliente e tráfego desnecessário na rede.
- **Arquivos/Tabelas/Funções Afetados**:
  - `src/services/returns.service.ts`
  - `src/services/customers.service.ts`
  - `src/services/finance.service.ts`
  - `src/services/reports.service.ts`
- **Sugestão de Correção**:
  1. Garantir que as migrações SQL contendo as RPCs `get_returns_page`, `get_customer_directory_page`, `get_finance_page` e `report_commercial_summary` estejam aplicadas e ativas no ambiente Supabase.
  2. Desativar ou restringir a lógica de fallback do cliente para que falhas de RPC sejam tratadas via relatórios de erro/logs em vez de carregar toda a base localmente.

---

### M-05 [MÉDIO] - Padronização de Validação de Perfil Ativo em RPCs `SECURITY DEFINER` Secundárias

- **Explicação**:
  Enquanto as RPCs principais (`complete_sale`, `create_mp_pix_sale`, `cancel_sale`) foram fortalecidas na migração `20261003000000_coresys_audit_final_remediation.sql` verificando `auth.uid()` e `profiles.is_active = true`, algumas funções secundárias ainda dependem somente do retorno de `get_user_store_role(p_store_id)`. Se um usuário for desativado na tabela `profiles` mas detiver um token JWT válido, chamadas a RPCs secundárias poderiam ser aceitas caso a regra de papel não consulte diretamente o status do perfil.
- **Arquivos/Tabelas/Funções Afetados**:
  - Migrações do Supabase sob `supabase/migrations/`
  - Funções RPC: `register_stock_entry`, `approve_mp_pix_sale`, `cancel_mp_pix_sale`
- **Sugestão de Correção**:
  1. Padronizar o cabeçalho de todas as RPCs `SECURITY DEFINER` com a checagem explícita:
     ```sql
     SELECT p.is_active INTO v_profile_active FROM public.profiles p WHERE p.id = auth.uid();
     IF v_user_id IS NULL OR COALESCE(v_profile_active, false) = false THEN
       RAISE EXCEPTION 'Perfil autenticado inexistente ou inativo.';
     END IF;
     ```

---

### M-06 [BAIXO] - Warnings do Linter e Dependências de React Hooks

- **Explicação**:
  A execução do ESLint (`npm run lint`) aponta 26 avisos referentes a variáveis e ícones importados mas nunca utilizados, além de hooks `useEffect` com dependências ausentes e notificações do React Fast Refresh em arquivos de contexto (`AuthContext`, `CartContext`, `StoreContext`, `ThemeContext`).
- **Arquivos/Tabelas/Funções Afetados**:
  - `src/components/dashboard/DashboardView.tsx`
  - `src/components/dashboard/RevenueChart.tsx`
  - `src/components/dashboard/TopProductsChart.tsx`
  - `src/components/finance/FinanceView.tsx`
  - `src/components/inventory/InventoryView.tsx`
  - `src/components/pdv/PdvView.tsx`
  - Contextos em `src/contexts/`
- **Sugestão de Correção**:
  1. Remover variáveis e imports não utilizados.
  2. Ajustar os hooks `useEffect` e `useCallback` para incluir todas as dependências declaradas.
  3. Mover utilitários e constantes exportadas dos arquivos de contexto para arquivos dedicados de tipos/helpers para silenciar os avisos de Fast Refresh.

---

## Conclusão e Próximos Passos Recomendados

1. **Prioridade Imediata (P0)**:
   - Corrigir o vazamento multi-tenant visual em `DashboardService.getMetrics` (M-01).
   - Adicionar o suporte a `store_id` na tabela e no serviço de fornecedores `SuppliersService` (M-02).
2. **Prioridade Secundária (P1)**:
   - Enforçar `storeId` como obrigatório em `CustomersService.create` (M-03).
   - Garantir a presença permanente das RPCs paginadas do Supabase e descontinuar os fallbacks pesados no cliente (M-04).
3. **Melhorias de Qualidade e Manutenibilidade (P2)**:
   - Resolver os 26 avisos do ESLint no frontend (M-06).

---
*Relatório emitido pela Auditoria Técnica CoreSys em 03/10/2026.*
