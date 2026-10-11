# 📊 Relatório de Auditoria Técnica Diária — CoreSys (ERP/PDV)

**Data:** 3 de outubro de 2026
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Escopo:** Auditoria de Segurança, Isolamento Multi-Tenant, RLS, Edge Functions, Banco de Dados Supabase (PostgreSQL), RPCs, Integridade de Dados, Performance e Frontend React/TypeScript.
**Auditor Responsável:** Engenheiro de Software Sênior (Jules)

---

## 🎯 Resumo Executivo

Esta auditoria técnica diária avaliou a postura de segurança, o isolamento multi-tenant, a integridade transacional, a performance do banco de dados e a qualidade do código frontend do ecossistema **CoreSys**.

### Status Geral da Arquitetura

- **Isolamento Multi-Tenant & RLS:** ✅ **FORTE.** As tabelas críticas (`sales`, `inventory_movements`, `store_inventory`, `customers`, `financial_transactions`, `products`, `automation_rules`, etc.) possuem Row Level Security (RLS) ativado e respaldado por funções de autorização fail-closed como `public.get_user_store_role(store_id)` e `public.has_store_access(store_id)`.
- **Transacionalidade e Idempotência:** ✅ **FORTE.** As RPCs críticas de PDV/Vendas (`complete_sale`, `create_mp_pix_sale`, `cancel_sale`, `process_return`) utilizam locks de transação via `pg_advisory_xact_lock`, tabela de idempotência `sale_idempotency` e isolamento por `store_id` e `user_id`.
- **Segurança SECURITY DEFINER & RPCs:** ✅ **CONTROLADO.** As RPCs mais recentes aplicam `SET search_path = public` e checagens explícitas de privilégio do usuário. Algumas funções legadas de trigger requerem ajuste de `search_path`.
- **Frontend & Qualidade de Código:** ⚠️ **ATENÇÃO.** O frontend está operacional e compila perfeitamente sem erros de TypeScript, porém foram identificados avisos de Linter sobre dependências de React Hooks (`useEffect`), chamadas diretas de serviço que requerem escopo `store_id` explícito no frontend (defesa em profundidade), e faltas de timeout em chamadas externas nas Edge Functions.

---

## 📋 Tabela Resumo dos Achados

| ID | Título do Achado | Severidade | Categoria | Componente / Arquivos Afetados |
| :--- | :--- | :---: | :--- | :--- |
| **AUD-01** | *Search Path* ausente em funções `SECURITY DEFINER` legadas de triggers de integridade | **ALTO** | Segurança / Banco | `20260101000000_setup.sql`<br>`20260825214956_fase3_estoque.sql`<br>`20260828000001_hardening_rls.sql` |
| **AUD-02** | Omissão de filtro explícito `store_id` em mutações diretas do Frontend (Defense-in-Depth) | **ALTO** | Segurança / Frontend | `src/services/customers.service.ts`<br>`src/services/products.service.ts` |
| **AUD-03** | Falta de limite/paginação client-side em consultas do Dashboard para grandes volumes | **ALTO** | Performance | `src/services/dashboard.service.ts`<br>`src/components/dashboard/DashboardView.tsx` |
| **AUD-04** | Avisos de Linter e dependências ausentes nos Hooks `useEffect` do React | **MÉDIO** | Frontend / Estabilidade | `src/components/dashboard/RevenueChart.tsx`<br>`src/components/dashboard/TopProductsChart.tsx`<br>`src/components/finance/FinanceView.tsx`<br>`src/components/pdv/PdvView.tsx` |
| **AUD-05** | Ausência de validação de role de acesso no serviço de Automações no Frontend | **MÉDIO** | Controle de Acesso | `src/services/automations/automations.service.ts`<br>`src/components/automations/AutomationsView.tsx` |
| **AUD-06** | Ausência de Timeout explícito em chamadas HTTP externas no Edge Function `create-mp-pix` | **MÉDIO** | Edge Functions | `supabase/functions/create-mp-pix/index.ts` |
| **AUD-07** | Módulos e variáveis não utilizados em componentes de interface | **BAIXO** | Qualidade de Código | Componentes diversos em `src/components/` |
| **AUD-08** | Alertas de Fast Refresh devido a exportação mista de componentes e utilitários em Contextos | **BAIXO** | Arquitetura Frontend | `src/contexts/AuthContext.tsx`<br>`src/contexts/CartContext.tsx`<br>`src/contexts/StoreContext.tsx` |

---

## 🔍 Detalhamento dos Achados e Recomendações

### 🔴 Achados de Severidade ALTA (ALTO)

#### AUD-01: *Search Path* ausente em funções `SECURITY DEFINER` legadas de triggers de integridade
- **Severidade:** **ALTO**
- **Explicação:** Três funções do banco criadas em migrações legadas (`handle_updated_at`, `prevent_inventory_movement_update`, `protect_profile_role`) utilizam a cláusula `SECURITY DEFINER` mas não declaram explicitamente `SET search_path = public`. Embora executem lógicas simples de trigger, a ausência de `search_path` fixo em funções `SECURITY DEFINER` pode permitir ataque de sequestro de schema (*search_path hijacking*) se executadas sob usuários com privilégios elevados em tabelas modificadas.
- **Tabelas / Funções Afetadas:**
  - Funções: `public.handle_updated_at()`, `public.prevent_inventory_movement_update()`, `public.protect_profile_role()`
  - Migrações: `supabase/migrations/20260101000000_setup.sql`, `20260825214956_fase3_estoque.sql`, `20260828000001_hardening_rls.sql`
- **Sugestão de Correção:**
  Criar uma migration de alinhamento executando:
  ```sql
  ALTER FUNCTION public.handle_updated_at() SET search_path = public;
  ALTER FUNCTION public.prevent_inventory_movement_update() SET search_path = public;
  ALTER FUNCTION public.protect_profile_role() SET search_path = public;
  ```

---

#### AUD-02: Omissão de filtro explícito `store_id` em mutações diretas do Frontend (Defense-in-Depth)
- **Severidade:** **ALTO**
- **Explicação:** Nos serviços `CustomersService.update(uuid, data)` e `ProductsService.remove(uuid)`, as chamadas do cliente Supabase utilizam filtros diretos por chave primária sem incluir a coluna `store_id` no `.eq()`:
  - `supabase.from('customers').update(payload).eq('id', uuid)`
  - `supabase.from('products').update({ is_active: false }).eq('id', uuid)`
  Embora o Row Level Security (RLS) do Supabase PostgreSQL intercepte a query e garanta que o registro pertencente a outra loja não seja atualizado, a boa prática de *Defense-in-Depth* exige que o serviço do frontend passe explicitamente o parâmetro `.eq('store_id', currentStoreId)` para evitar riscos de BOLA/IDOR na eventualidade de uma alteração de RLS.
- **Arquivos Afetados:**
  - `src/services/customers.service.ts`
  - `src/services/products.service.ts`
- **Sugestão de Correção:**
  Atualizar os métodos de serviço para aceitar `storeId` e incluir o filtro:
  ```typescript
  // Exemplo em CustomersService
  static async update(uuid: string, customer: Partial<Customer>, storeId: string) {
    const { data, error } = await supabase
      .from('customers')
      .update(payload)
      .eq('id', uuid)
      .eq('store_id', storeId)
      .select()
      .single();
    ...
  }
  ```

---

#### AUD-03: Falta de limite/paginação client-side em consultas do Dashboard para grandes volumes
- **Severidade:** **ALTO**
- **Explicação:** No serviço `DashboardService` (`src/services/dashboard.service.ts`), a busca por vendas e métricas do período executa `.from('sales').select('*').eq('store_id', storeId)` buscando todos os registros de vendas sem aplicar limitação de paginação (`.range()`) ou delegar o cálculo de agregações diretamente ao banco. Em lojas com dezenas de milhares de vendas, esta consulta causará latência excessiva no navegador, alto consumo de memória e estouro de limite de payload do cliente Supabase.
- **Arquivos / Componentes Afetados:**
  - `src/services/dashboard.service.ts`
  - `src/components/dashboard/DashboardView.tsx`
- **Sugestão de Correção:**
  Migrar as agregações do Dashboard para a RPC consolidada `report_commercial_summary(p_store_id, p_start_date, p_end_date)` já existente na base de dados, garantindo que o cálculo seja feito no PostgreSQL e retorne apenas os totais sumarizados.

---

### 🟡 Achados de Severidade MÉDIA (MÉDIO)

#### AUD-04: Avisos de Linter e dependências ausentes nos Hooks `useEffect` do React
- **Severidade:** **MÉDIO**
- **Explicação:** O comando `npm run lint` revelou 26 avisos (`warnings`), sendo a maioria relacionada à regra `react-hooks/exhaustive-deps`. Componentes como `RevenueChart`, `TopProductsChart`, `FinanceView` e `PdvView` instanciam ou invocam funções sem declará-las no array de dependências do `useEffect` ou sem envolvê-las com `useCallback`. Isso pode gerar re-renders desnecessários e requisições repetidas ao backend.
- **Arquivos Afetados:**
  - `src/components/dashboard/RevenueChart.tsx`
  - `src/components/dashboard/TopProductsChart.tsx`
  - `src/components/finance/FinanceView.tsx`
  - `src/components/pdv/PdvView.tsx`
  - `src/components/movements/MovementsView.tsx`
- **Sugestão de Correção:**
  Envolver os manipuladores e carregadores de dados em `useCallback` e adicionar as dependências corretas nos arrays de `useEffect`.

---

#### AUD-05: Ausência de validação de role de acesso no serviço de Automações no Frontend
- **Severidade:** **MÉDIO**
- **Explicação:** Em `src/services/automations/automations.service.ts`, as funções de gerenciamento de regras de automação (`createRule`, `updateRule`, `deleteRule`) não verificam a permissão do usuário no frontend antes de disparar a requisição. Embora o banco possua RLS bloqueando edições para operadores não autorizados (`CASHIER`), o frontend deve validar as roles (`ADMIN`/`MANAGER`) no `StoreContext` e desabilitar os controles de interface para evitar mensagens de erro brutas do banco de dados.
- **Arquivos Afetados:**
  - `src/services/automations/automations.service.ts`
  - `src/components/automations/AutomationsView.tsx`
- **Sugestão de Correção:**
  Adicionar checagem de permissão utilizando a função auxiliar `hasPermission(role, 'manage_automations')` antes de renderizar os formulários de automação e antes de executar ações de mutação no serviço.

---

#### AUD-06: Ausência de Timeout explícito em chamadas HTTP externas no Edge Function `create-mp-pix`
- **Severidade:** **MÉDIO**
- **Explicação:** Na Edge Function `create-mp-pix` (`supabase/functions/create-mp-pix/index.ts`), a chamada HTTP para a API do Mercado Pago (`fetch('https://api.mercadopago.com/v1/payments', ...)`) é realizada sem um sinal de aborto por timeout (`AbortSignal.timeout(...)`). Caso a API do Mercado Pago enfrente instabilidade ou alta latência, a execução da Edge Function ficará pendente até o limite do runtime do Deno, mantendo a conexão do cliente aberta desnecessariamente.
- **Arquivos Afetados:**
  - `supabase/functions/create-mp-pix/index.ts`
- **Sugestão de Correção:**
  Adicionar o parâmetro `signal` com timeout de 10 segundos no `fetch`:
  ```typescript
  const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
    method: 'POST',
    headers: { ... },
    body: JSON.stringify(mpPayload),
    signal: AbortSignal.timeout(10000)
  });
  ```

---

### 🟢 Achados de Severidade BAIXA (BAIXO)

#### AUD-07: Módulos e variáveis não utilizados em componentes de interface
- **Severidade:** **BAIXO**
- **Explicação:** Diversos componentes possuem importações de ícones e declarações de variáveis que não são utilizadas no código (ex: `CreditCard`, `ChevronDown`, `Trash2`, `PlusCircle`, `ArrowUp`, `AlertCircle`, `User`, `formatPaymentMethod`, `formatPhone`).
- **Arquivos Afetados:**
  - `src/components/dashboard/DashboardView.tsx`
  - `src/components/inventory/InventoryView.tsx`
  - `src/components/inventory/NewProductModal.tsx`
  - `src/components/inventory/StockEntryModal.tsx`
  - `src/components/returns/NewReturnModal.tsx`
  - `src/components/suppliers/SupplierForm.tsx`
- **Sugestão de Correção:**
  Remover os imports não utilizados para manter a árvore de código limpa e reduzir o bundle final.

---

#### AUD-08: Alertas de Fast Refresh devido a exportação mista em Contextos React
- **Severidade:** **BAIXO**
- **Explicação:** Nos arquivos de contexto (`AuthContext.tsx`, `CartContext.tsx`, `StoreContext.tsx`, `ThemeContext.tsx`), há exportação de funções auxiliares e constantes juntamente com os componentes Provider. O plugin `react-refresh` exibe alertas de desenvolvimento informando que o Fast Refresh só funciona adequadamente quando o arquivo exporta exclusivamente componentes.
- **Arquivos Afetados:**
  - `src/contexts/AuthContext.tsx`
  - `src/contexts/CartContext.tsx`
  - `src/contexts/StoreContext.tsx`
  - `src/contexts/ThemeContext.tsx`
- **Sugestão de Correção:**
  Separar a definição de utilitários e tipos em arquivos `.types.ts` ou `.utils.ts` dedicados.

---

## 🛡️ Verificação do Isolamento Multi-Tenant e Supabase Auth

1. **Contexto da Loja (`store_id`):** Todas as tabelas operacionais da aplicação contêm a coluna `store_id` associada à tabela `stores`.
2. **Políticas de RLS (Row Level Security):** O acesso a qualquer tabela por usuários da role `authenticated` exige associação ativa na tabela `user_store_access`.
3. **Prevenção de Evasão de Privilégios (BOLA/IDOR):** As RPCs operacionais de PDV validam a role do usuário corrente chamando a função `public.get_user_store_role(p_store_id)`. Se a role do usuário não for `ADMIN`, `MANAGER` ou `CASHIER` para a loja informada, a transação é abortada com exceção `42501` (Acesso negado).
4. **Proteção da Coluna Role:** A role global do usuário no perfil (`profiles.role`) possui trigger de proteção (`protect_profile_role`) que impede que um usuário comum altere seu próprio papel para `ADMIN`.

---

## 📈 Conclusão e Próximos Passos Recomendados

O ecossistema **CoreSys** demonstra alto nível de maturidade técnica, segurança reforçada no banco de dados e isolamento multi-tenant consistente.

**Plano de Ação Sugerido para as Próximas Sprints:**
1. **Sprint Atual (Segurança & Performance):**
   - Criar migration para adicionar `SET search_path = public` nas 3 funções de trigger legadas.
   - Adicionar o filtro `.eq('store_id', storeId)` em todas as mutações diretas dos serviços do frontend.
   - Atualizar a Edge Function `create-mp-pix` com `AbortSignal.timeout(10000)`.
2. **Próxima Sprint (Frontend & Qualidade):**
   - Refatorar dependências nos hooks `useEffect` dos gráficos e views do Dashboard.
   - Otimizar busca do Dashboard para utilizar RPC de sumário em vez de download completo de vendas.
   - Limpar variáveis e imports não utilizados.

---
*Relatório gerado e registrado automaticamente em `docs/audits/AUDITORIA_TECNICA_DIARIA_CORESYS.md`.*
