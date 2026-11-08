# Auditoria Técnica Diária — CoreSys (2026-11-08)

**Repositório:** FlavioProgramador/projeto-loja-multimarcas
**Auditor:** Engenharia de Software Sênior (Auditoria Automatizada & Especializada CoreSys)
**Data:** 08 de Novembro de 2026
**Diretriz:** Levantamento e classificação estrita de vulnerabilidades, riscos operacionais, isolamento multi-tenant e qualidade de código sem alterações automáticas destrutivas no código-fonte nesta etapa.

---

## 1. Sumário Executivo

A auditoria técnica avaliou a camada frontend React (TypeScript/Vite), a infraestrutura do Supabase (PostgreSQL, Row Level Security, RPCs PL/pgSQL, Triggers) e Edge Functions Deno.

O CoreSys apresentou grande evolução em isolamento multi-tenant e robustez transacional após as migrações recentes (fase 3, hardening de concorrência, idempotência com advisory locks e paginação segura no servidor). No entanto, foram identificados pontos sensíveis que necessitam de atenção prioritária:
1. **Brecha de Injeção de search_path / Escalonamento em Trigger `SECURITY DEFINER`:** A função trigger `public.protect_profile_role` não define `SET search_path = public`, abrindo brecha para ataque via search_path hijacking durante updates em perfis.
2. **Fragilidade Fail-Closed em Verificações de Papéis em Múltiplas RPCs:** Funções críticas criadas nas migrações de auditoria de dados e LGPD/privacidade utilizam a cláusula `v_role NOT IN ('ADMIN', 'MANAGER')` sem checar se `v_role IS NULL`. Em SQL/PLpgSQL, `NULL NOT IN (...)` avalia como `NULL` (falsy), permitindo bypass de checagens se a lógica depender de negação invertida ou ausência de validação inicial.
3. **Mutações Diretas no Banco sem Isolamento de Loja (Tabelas Globais vs Multi-Loja):** Tabelas como `suppliers` (fornecedores) e `brands` continuam com escopo global compartilhado entre tenants, enquanto `SuppliersService.update` e `SuppliersService.remove` permitem que qualquer usuário autenticado com permissão modifique fornecedores sem validação de tenant context.
4. **Falta de Índices de Chaves Estrangeiras em Tabelas Operacionais:** A tabela `user_store_access` (coluna `store_id`) e `automation_runs` (coluna `rule_id`) não possuem índices secundários dedicados para joins frequentes e RLS checks, impactando performance sob alta concorrência.
5. **Código Morto / Componentes Órfãos:** `DashboardService` realiza queries pesadas no banco contornando a paginação e o escopo de `store_id`, mas não está conectado a nenhuma view ativa da UI (código morto que gera falso senso de métricas).
6. **Tratamento Incompleto de Erros Assíncronos em Operações Críticas de UI:** Funções assíncronas em componentes de UI (`NewReturnModal`, `AutomationsView`, `MovementsView`) carecem de captura estruturada de exceções, podendo deixar a interface travada em estados inconsistentes ou gerando alertas genéricos sem feedback claro.

---

## 2. Tabela Resumo de Achados

| ID | Severidade | Categoria | Descrição Resumida | Arquivo / Objeto Afetado |
| :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | **ALTO** | Segurança / SQL | `SECURITY DEFINER` sem `search_path` fixo em trigger | `public.protect_profile_role()` (`20260828000001_hardening_rls.sql`) |
| **SEC-02** | **ALTO** | Segurança / Auth / RLS | Role checks sem fail-closed em RPCs de privacidade / LGPD | `export_customer_personal_data`, `create_privacy_request`, `resolve_privacy_request` |
| **MT-01** | **MÉDIO** | Multi-Tenancy / IDOR | Falta de tenant scoping nas entidades `suppliers` e `brands` | `public.suppliers`, `public.brands`, `src/services/suppliers.service.ts` |
| **PERF-01**| **MÉDIO** | Performance / Banco | Ausência de índices em Foreign Keys críticas (`store_id`, `rule_id`) | `user_store_access`, `automation_runs` |
| **MNT-01** | **BAIXO** | Código Morto / Arquitetura | `DashboardService` legado e desvinculado com query un-scoped | `src/services/dashboard.service.ts` |
| **UI-01**  | **BAIXO** | Resiliência / UI | Falta de try/catch e tratamento de loading em chamadas de UI | `src/components/returns/NewReturnModal.tsx`, `src/components/movements/MovementsView.tsx` |

---

## 3. Detalhamento Técnico dos Achados

### 3.1 [SEC-01] Trigger `SECURITY DEFINER` sem `SET search_path`
* **Severidade:** **ALTO**
* **Classificação:** Segurança de Banco de Dados / Privilégios Elevados.
* **Objeto Afetado:**
  - Função: `public.protect_profile_role()`
  - Tabela: `public.profiles`
  - Migração de Origem: `supabase/migrations/20260828000001_hardening_rls.sql` (linhas 19-32)
* **Explicação do Problema:**
  A função `protect_profile_role()` executa como `SECURITY DEFINER` acionada por trigger `BEFORE UPDATE ON public.profiles`. Ela não define explicitamente `SET search_path = public`. Em bancos PostgreSQL compartilhados e funções `SECURITY DEFINER`, não fixar o `search_path` pode permitir que schemas temporários maliciosos ou objetos sobrepostos capturem a execução (search path hijacking). Todas as outras funções do projeto possuem `SET search_path = public`, tornando esta uma exceção de conformidade.
* **Sugestão de Correção:**
  Aplicar alteração na função definindo `SET search_path = public`:
  ```sql
  CREATE OR REPLACE FUNCTION public.protect_profile_role()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
  BEGIN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      IF public.current_user_role() != 'ADMIN' THEN
        RAISE EXCEPTION 'Acesso negado: Apenas administradores podem alterar papéis (roles).';
      END IF;
    END IF;
    RETURN NEW;
  END;
  $$;
  ```

---

### 3.2 [SEC-02] Verificação de Papel Insegura (Fail-Open a NULL) em Funções de Exportação e Privacidade
* **Severidade:** **ALTO**
* **Classificação:** Segurança / Supabase Auth & RLS / LGPD.
* **Objetos Afetados:**
  - `public.export_customer_personal_data(uuid, uuid)` (`20261001150554_add_customer_personal_data_export.sql`)
  - `public.create_privacy_request(uuid, uuid, text, text)` (`20261001150645_add_privacy_request_workflow.sql`)
  - `public.resolve_privacy_request(uuid, uuid, text, text)` (`20261001150659_add_privacy_request_resolution.sql`)
  - `public.log_data_export(uuid, text, text, integer, boolean, jsonb)` (`20261001150508_add_data_export_audit.sql`)
  - `public.check_customer_anonymization_eligibility(uuid, uuid)` (`20261001150645_add_privacy_request_workflow.sql`)
* **Explicação do Problema:**
  Nas funções citadas, a validação de acesso da loja é implementada como:
  ```sql
  v_role := public.get_user_store_role(p_store_id);
  if v_role not in ('ADMIN', 'MANAGER') then
    raise exception '... requires ADMIN or MANAGER role';
  end if;
  ```
  Em PostgreSQL, quando um usuário não possui registro em `user_store_access` para aquela loja ou a role retorna `NULL`:
  A expressão `NULL NOT IN ('ADMIN', 'MANAGER')` avalia para `NULL`, e não para `TRUE`. No bloco `IF condition THEN`, um resultado `NULL` não entra no bloco de exceção. Embora `has_store_access(p_store_id)` seja avaliado antes, caso a tabela `user_store_access` contenha uma role não mapeada ou nula, a verificação subsequente é contornada.
  A convenção de segurança obrigatória do CoreSys estabelece: `v_role IS NULL OR v_role NOT IN ('ADMIN', 'MANAGER')` (fail-closed explícito).
* **Sugestão de Correção:**
  Atualizar as funções para garantir padrão fail-closed:
  ```sql
  v_role := public.get_user_store_role(p_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN', 'MANAGER') THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores e gerentes da loja.';
  END IF;
  ```

---

### 3.3 [MT-01] Entidades `suppliers` e `brands` sem Escopo de Tenant (`store_id`)
* **Severidade:** **MÉDIO**
* **Classificação:** Arquitetura Multi-Tenant / Isolamento de Dados.
* **Objetos Afetados:**
  - Tabelas: `public.suppliers`, `public.brands`
  - Serviços: `src/services/suppliers.service.ts`, `src/services/brands.service.ts`
  - Políticas RLS: `"Suppliers insertable by roles"`, `"Suppliers updatable by roles"`
* **Explicação do Problema:**
  Enquanto clientes (`customers`), vendas (`sales`), inventário (`store_inventory`), despesas (`financial_transactions`) e automações (`automation_rules`) foram completamente migrados para o modelo multi-loja com `store_id`, fornecedores e marcas permanecem como tabelas globais da conta Supabase.
  Qualquer gerente de uma loja filial possui autorização via `current_user_role() IN ('ADMIN', 'MANAGER')` para alterar, desativar (`is_active = false`) ou sobrescrever dados de fornecedores (`suppliers`) e marcas (`brands`) utilizados por outras lojas da mesma organização, sem segregação de tenant ou rastreio de loja proprietária.
* **Sugestão de Correção:**
  1. Avaliar se o modelo de negócio exige catálogo global unificado ou catálogo segregado por loja.
  2. Caso o catálogo de fornecedores deva ser por loja, adicionar coluna `store_id uuid references public.stores(id)` e atualizar políticas RLS para checar `public.has_store_access(store_id)` e `public.get_user_store_role(store_id)`.
  3. Caso o catálogo permaneça compartilhado, restringir a mutação dessas tabelas estritamente a usuários globais com papel `ADMIN` do sistema, impedindo que gerentes locais (`MANAGER`) façam edições que impactem todas as lojas.

---

### 3.4 [PERF-01] Ausência de Índices Secundários em Chaves Estrangeiras Críticas
* **Severidade:** **MÉDIO**
* **Classificação:** Performance do Banco de Dados / Concorrência.
* **Objetos Afetados:**
  - Tabela: `public.user_store_access` (coluna `store_id`)
  - Tabela: `public.automation_runs` (coluna `rule_id`)
* **Explicação do Problema:**
  1. A tabela `user_store_access` possui chave primária composta `PRIMARY KEY (user_id, store_id)`. O PostgreSQL cria automaticamente um índice B-tree em `(user_id, store_id)`. No entanto, consultas como `SELECT * FROM user_store_access WHERE store_id = $1` (frequentes para listar colaboradores de uma loja ou validações de integridade) não aproveitam eficientemente a chave primária quando o primeiro elemento (`user_id`) não é fornecido, resultando em Sequential Scan em bases grandes.
  2. A tabela `automation_runs` possui índices em `(store_id, started_at)` e `(automation_id, started_at)`, mas a chave estrangeira direta `rule_id` referenciando `automation_rules(id)` não possui índice exclusivo ou de suporte a exclusões em cascata.
* **Sugestão de Correção:**
  Criar índices dedicados via migração:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_user_store_access_store_id
    ON public.user_store_access (store_id);

  CREATE INDEX IF NOT EXISTS idx_automation_runs_rule_id
    ON public.automation_runs (rule_id);
  ```

---

### 3.5 [MNT-01] Código Morto com Consulta Un-scoped no `DashboardService`
* **Severidade:** **BAIXO**
* **Classificação:** Manutenibilidade / Débito Técnico / Código Morto.
* **Objetos Afetados:**
  - Arquivo: `src/services/dashboard.service.ts`
  - Exportação: `src/services/index.ts`
* **Explicação do Problema:**
  O arquivo `src/services/dashboard.service.ts` implementa o método `getMetrics()`, que realiza chamadas `supabase.from('sales').select(...)` e `supabase.from('product_variants').select(...)` **sem passar `store_id`**, agregando vendas em memória no navegador.
  Na interface atual, o componente `src/components/dashboard/DashboardView.tsx` utiliza os dados alimentados localmente pelo `StoreContext` e hooks de domínio, e nenhuma tela importa ou chama `DashboardService.getMetrics()`. Manter este serviço ativo no codebase induz desenvolvedores a erro e representa uma brecha teórica caso venha a ser consumido futuramente sem o devido filtro de multi-tenant.
* **Sugestão de Correção:**
  Refatorar `DashboardService` para receber `storeId: string` como parâmetro obrigatório e filtrar `.eq('store_id', storeId)` utilizando queries otimizadas / RPCs sumarizadas (ex.: `report_commercial_summary`), ou removê-lo caso o dashboard continue utilizando os hooks de contexto.

---

### 3.6 [UI-01] Ausência de Captura de Exceção Estruturada em Fluxos de UI
* **Severidade:** **BAIXO**
* **Classificação:** Tratamento de Erros e Experiência do Usuário (UX).
* **Objetos Afetados:**
  - `src/components/returns/NewReturnModal.tsx` (`handleSubmit`)
  - `src/components/movements/MovementsView.tsx` (`loadMovements`)
  - `src/components/automations/AutomationsView.tsx` (`saveRule`)
* **Explicação do Problema:**
  No modal de devoluções (`NewReturnModal.tsx`), o método `handleSubmit` invoca `await processReturn(...)`. Embora `processReturn` dentro de `useReturnsDomain` capture erros do serviço Supabase, qualquer erro inesperado fora da Promise (como falhas no callback `onSuccess` ou erro de concorrência) não possui bloco `try / catch`, o que pode deixar o formulário em estado travado sem desbloquear botões de loading.
  De forma similar, `MovementsView.tsx` em `loadMovements` chama `MovementsService.getAll(activeStoreId)` sem bloco `try / catch / finally`, o que significa que caso ocorra um erro de rede, `setIsLoading(false)` pode não ser alcançado se uma rejeição for propagada.
* **Sugestão de Correção:**
  Envolver os manipuladores assíncronos em blocos `try / catch / finally` com indicação de erro amigável ao usuário (via toast ou mensagem no modal) e garantia de reset do estado de loading.

---

## 4. Recomendações e Plano de Ação Prioritário

1. **Ação Imediata (Segurança SQL & RLS):**
   - Criar migração Supabase para fixar `SET search_path = public` na trigger `protect_profile_role()`.
   - Adicionar checagem fail-closed explícita (`v_role IS NULL OR v_role NOT IN (...)`) nas RPCs de exportação de dados e LGPD (`export_customer_personal_data`, `create_privacy_request`, `resolve_privacy_request`).

2. **Ação a Curto Prazo (Performance & Índices):**
   - Adicionar os índices `idx_user_store_access_store_id` e `idx_automation_runs_rule_id`.

3. **Ação a Médio Prazo (Arquitetura & Limpeza):**
   - Adequar ou depreciar formalmente o `DashboardService.ts` para não manter lógica de agregação em memória desprovida de `store_id`.
   - Reforçar tratamento de erros e estados de loading nos componentes de devolução e inventário na UI.

---
*Relatório de Auditoria Técnica concluído em conformidade com as diretrizes do CoreSys.*
