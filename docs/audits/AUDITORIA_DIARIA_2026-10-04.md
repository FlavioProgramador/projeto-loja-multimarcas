# 📊 Relatório de Auditoria Técnica Diária — CoreSys (Vestra ERP)
**Data:** 04 de outubro de 2026
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Escopo:** Frontend, Backend Supabase, Auth, RLS, Isolamento Multi-Tenant, Performance, Segurança e Arquitetura.

---

## 🎯 RESUMO EXECUTIVO

| Métrica | Valor |
|---------|-------|
| **Status Geral** | Estável com pontos de atenção |
| **Pronto para Produção** | ⚠️ Com ressalvas (P1/P2 pendentes) |
| **Total de Achados** | 10 |
| **Severidade Crítica (P0)** | 0 |
| **Severidade Alta (P1)** | 1 |
| **Severidade Média (P2)** | 5 |
| **Severidade Baixa (P3)** | 4 |

---

## 📋 CATALOGO DE ACHADOS POR SEVERIDADE

---

### 🔴 SEVERIDADE ALTA (ALTO)

#### 1. Ausência de Isolamento Multi-Tenant na Tabela e Serviço de Fornecedores (`suppliers`)
- **Severidade:** ALTO
- **Explicação:**
  A tabela `public.suppliers` não possui a coluna `store_id` associada às lojas. Além disso, as políticas de Row Level Security (RLS) configuradas na migração inicial permitem que qualquer usuário autenticado com permissão de `ADMIN` ou `MANAGER` visualize e gerencie todos os fornecedores cadastrados na plataforma.
  No frontend, o serviço `SuppliersService.create` não envia nenhum identificador de loja ao inserir um novo fornecedor. Isso viola a premissa de isolamento multi-tenant estrito, permitindo que usuários de uma loja visualizem e alterem fornecedores de outras lojas.
- **Afetados:**
  - **Tabela:** `public.suppliers`
  - **Arquivos:** `src/services/suppliers.service.ts`, `supabase/migrations/20260101000000_setup.sql`, `supabase/migrations/20260828000001_hardening_rls.sql`
- **Sugestão de Correção:**
  1. Criar uma migração SQL adicionando a coluna `store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE` na tabela `suppliers`.
  2. Atualizar as políticas RLS para utilizar `public.has_store_access(store_id)` e `public.get_user_store_role(store_id) IN ('ADMIN', 'MANAGER')`.
  3. Atualizar `SuppliersService.ts` e `useSuppliersDomain.ts` no frontend para obrigatoriamente fornecer e filtrar por `store_id`.

---

### 🟡 SEVERIDADE MÉDIA (MÉDIO)

#### 2. Possível BOLA/IDOR em Mutations Diretas de Clientes (`CustomersService.update` e `remove`)
- **Severidade:** MÉDIO
- **Explicação:**
  Em `CustomersService.update` e `CustomersService.remove`, o trecho de código filtra apenas por `.eq('id', uuid)`. Embora a RLS na tabela `customers` verifique acesso à loja via `has_store_access(store_id)`, a boa prática de segurança em profundidade (*defense in depth*) exige que chamadas de mutation do frontend filtram explicitamente por `.eq('store_id', activeStoreId)` para evitar IDOR (Insecure Direct Object Reference) ou BOLA (Broken Object Level Authorization) em cenários onde tokens possuam acesso a múltiplas lojas.
- **Afetados:**
  - **Tabela:** `public.customers`
  - **Arquivo:** `src/services/customers.service.ts`
- **Sugestão de Correção:**
  Incluir a clausula `.eq('store_id', storeId)` em todas as chamadas diretas de `.update()` e `.delete()` no `CustomersService`.

---

#### 3. Parâmetro `storeId` Opcional no `CustomersService.create`
- **Severidade:** MÉDIO
- **Explicação:**
  A assinatura da função `CustomersService.create` possui o parâmetro `storeId` como opcional (`storeId?: string`). Se a função for chamada sem `storeId` (por exemplo, em componentes reutilizáveis fora do contexto), o payload enviará `store_id: undefined` e o Supabase rejeitará a gravação devido à restrição `NOT NULL` aplicada na migração `20260930010321_phase3_finalize_tenant_customers_and_cost_privileges.sql`.
- **Afetados:**
  - **Tabela:** `public.customers`
  - **Arquivo:** `src/services/customers.service.ts`
- **Sugestão de Correção:**
  Tornar `storeId: string` um argumento obrigatório na assinatura do método `create` do `CustomersService`.

---

#### 4. Exposição Potencial de Preço de Custo no Gerenciamento de Produtos
- **Severidade:** MÉDIO
- **Explicação:**
  A migração `20260930010321_phase3_finalize_tenant_customers_and_cost_privileges.sql` restringiu o acesso direto à tabela `product_costs` para evitar que caixas (`CASHIER`) visualizem a margem de lucro e o custo dos produtos. No entanto, o serviço `ProductsService.getForManagement` chama a RPC `get_product_for_management` que retorna o campo `cost_price`. Se um usuário com perfil `CASHIER` tiver permissão de chamada nessa RPC, os valores de custo continuam sendo expostos na resposta JSON.
- **Afetados:**
  - **Função Supabase:** `public.get_product_for_management(uuid, uuid)`
  - **Arquivo:** `src/services/products.service.ts`
- **Sugestão de Correção:**
  Garantir na RPC `get_product_for_management` uma verificação estrita do papel do usuário (`public.get_user_store_role(p_store_id) IN ('ADMIN', 'MANAGER')`), retornando `NULL` ou lançando exceção caso um perfil `CASHIER` invoque a função.

---

#### 5. Código Legado com Processamento Pesado em Memória no Frontend (`CustomersService.getDirectoryPage` Fallback)
- **Severidade:** MÉDIO
- **Explicação:**
  O método `CustomersService.getDirectoryPage` possui um fallback (`getLegacyAll`) que dispara 4 buscas de tabela inteira (`customers`, `sales`, `customer_credit_movements`, `returns`) e realiza cruzamentos, ordenações e formatações de listas inteiras em memória na CPU da máquina do cliente caso a RPC `get_customer_directory_page` falhe ou não esteja presente. Em bancos com milhares de vendas e clientes, isso provoca consumo excessivo de memória e travamento do navegador.
- **Afetados:**
  - **Arquivo:** `src/services/customers.service.ts`
- **Sugestão de Correção:**
  Refatorar ou desativar o fallback em memória quando o Supabase estiver configurado e tratar erros de RPC exibindo alertas amigáveis na UI em vez de baixar todo o histórico do banco.

---

#### 6. Notificações de Erro em Rollbacks Otimistas nos Hooks de Domínio
- **Severidade:** MÉDIO
- **Explicação:**
  Ao tentar atualizar ou remover um cliente ou fornecedor, os hooks `useSuppliersDomain` e `useCustomersDomain` realizam uma atualização otimista da UI (`setCustomers`, `setSuppliers`) e revertem ao snapshot em caso de falha (`catch`). Porém, se a operação remota falhar por conta de regra RLS ou indisponibilidade, nem sempre uma notificação amigável é exibida para o usuário, deixando a UI em um estado em que a alteração do usuário "desaparece" sem explicação visível.
- **Afetados:**
  - **Arquivos:** `src/hooks/domains/useSuppliersDomain.ts`, `src/hooks/domains/useCustomersDomain.ts`
- **Sugestão de Correção:**
  Integrar um sistema de *toast/alert* no tratamento do bloco `catch` dos hooks para apresentar a mensagem exata do erro retornado pelo Supabase (ex: "Permissão negada pela loja").

---

### 🟢 SEVERIDADE BAIXA (BAIXO)

#### 7. Avisos de Linting (Variables Não Utilizadas e Dependências em `useEffect`)
- **Severidade:** BAIXO
- **Explicação:**
  A execução do ESLint revelou 27 warnings sem erros bloqueantes. Esses avisos envolvem variáveis importadas/declaradas e não utilizadas (como `CreditCard`, `ChevronDown`, `Trash2`, `setSelectedColecao`), bem como dependências ausentes nas listas de dependências de `useEffect` nos componentes `RevenueChart`, `TopProductsChart`, `FinanceView`, `MovementsView` e `PdvView`.
- **Afetados:**
  - **Arquivos:** `src/components/dashboard/RevenueChart.tsx`, `src/components/dashboard/TopProductsChart.tsx`, `src/components/finance/FinanceView.tsx`, `src/components/movements/MovementsView.tsx`, `src/components/pdv/PdvView.tsx`
- **Sugestão de Correção:**
  Remover os imports/variáveis mortas e ajustar os arrays de dependências dos `useEffect` utilizando `useCallback` ou escopo adequado.

---

#### 8. Tamanho dos Chunks de JavaScript no Bundle de Produção
- **Severidade:** BAIXO
- **Explicação:**
  A compilação do Vite exibe avisos informando que determinados chunks gerados para o bundle de produção excedem o limite recomendado de 500 kB (ex: `DashboardView` ~526 kB, `ReportsView` ~412 kB, `index` ~526 kB).
- **Afetados:**
  - **Arquivos:** `vite.config.ts`, `src/pages/`, `src/components/`
- **Sugestão de Correção:**
  Aplicar estratégias de `lazy loading` (`React.lazy`) e divisão manual de chunks (`build.rollupOptions.output.manualChunks`) no `vite.config.ts` para separar bibliotecas pesadas como `chart.js`, `jspdf` e `html2canvas`.

---

#### 9. Otimização de Índices Compostos para Consultas Temporais de Vendas e Financeiro
- **Severidade:** BAIXO
- **Explicação:**
  A RPC `report_commercial_summary` realiza agregações filtrando por `store_id`, `status` e intervalo de datas (`created_at >= v_start AND created_at < v_end_exclusive`). As tabelas `sales` e `financial_transactions` possuem índices individuais em `store_id` e `created_at`, mas índices compostos `(store_id, status, created_at)` reduzirão o custo de Scan em bancos de produção muito populosos.
- **Afetados:**
  - **Tabelas:** `public.sales`, `public.financial_transactions`
- **Sugestão de Correção:**
  Adicionar migração com índices compostos:
  `CREATE INDEX IF NOT EXISTS idx_sales_store_status_created ON public.sales(store_id, status, created_at);`
  `CREATE INDEX IF NOT EXISTS idx_fin_trans_store_status_created ON public.financial_transactions(store_id, status, created_at);`

---

#### 10. `SECURITY DEFINER` e `search_path` em Funções Auxiliares de RLS
- **Severidade:** BAIXO
- **Explicação:**
  Funções de verificação de permissão como `public.has_store_access()` e `public.get_user_store_role()` utilizam `SECURITY DEFINER`. Embora possuam `SET search_path = public`, suas permissões de execução via API pública para a role `anon` devem permanecer revogadas para impedir que clientes anônimos tentem sondar informações sobre UUIDs de lojas.
- **Afetados:**
  - **Funções:** `public.has_store_access(uuid)`, `public.get_user_store_role(uuid)`
  - **Migração:** `supabase/migrations/20260928230000_auth_integrity_hardening.sql`
- **Sugestão de Correção:**
  Executar `REVOKE EXECUTE ON FUNCTION public.has_store_access(uuid) FROM anon;` e `REVOKE EXECUTE ON FUNCTION public.get_user_store_role(uuid) FROM anon;`.

---

## 🚀 RECOMENDAÇÕES E PRÓXIMOS PASSOS

1. **Prioridade Imédiata (Sprint Atual):**
   - Implementar o isolamento multi-tenant na tabela e serviços de fornecedores (`suppliers`).
   - Ajustar as chamadas diretas de clientes em `CustomersService.ts` para incluir obrigatoriamente `store_id`.

2. **Melhorias de Arquitetura e Qualidade:**
   - Corrigir os 27 avisos de linting no frontend.
   - Configurar Code Splitting (`React.lazy`) para otimizar os bundles de produção.

---
**Relatório gerado por:** Engenharia de Software Sênior — Auditoria Técnica CoreSys
**Data:** 04/10/2026
