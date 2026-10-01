# Relatório de Auditoria Técnica Diária - CoreSys

**Data:** 2026-10-01
**Repositório:** FlavioProgramador/projeto-loja-multimarcas
**Auditor:** Engenharia de Software / Auditoria CoreSys

---

## Executive Summary
Realizada a auditoria técnica diária do ecossistema CoreSys (Frontend React + Supabase Backend/RLS/RPCs). O foco principal da análise concentrou-se na integridade do isolamento multi-tenant, validações de autorização, funções `SECURITY DEFINER`, tratamento de erro no frontend e consistência de dados entre a aplicação e o banco de dados.

---

## Achados de Auditoria Detalhados

---

### 1. [CRÍTICO] Ausência de Isolamento Multi-tenant em Marcas e Categorias (Bypass de Tenant / IDOR / Escalação de Acesso Global)

* **Severidade:** CRÍTICO
* **Explicação do Problema:**
  As tabelas `public.brands` e `public.categories` foram originalmente concebidas como tabelas globais no schema inicial (`20260101000000_setup.sql`), não possuindo a coluna `store_id`. Nos serviços do frontend (`src/services/brands.service.ts` e `src/services/categories.service.ts`), chamadas `insert`, `update` e `delete` operam diretamente via SDK cliente do Supabase sobre `id` específico sem validar a qual loja o usuário pertence ou se o usuário possui papel `ADMIN`. Qualquer usuário autenticado de qualquer loja pode criar, alterar ou deletar marcas e categorias globais utilizadas por outras lojas do ecossistema, gerando impacto grave na integridade dos dados compartilhados e potencial negação de serviço/alteração inadvertida do catálogo global.
* **Arquivos / Tabelas / Funções Afetados:**
  * Frontend: `src/services/brands.service.ts`, `src/services/categories.service.ts`, `src/services/inventory.service.ts`
  * Banco de Dados: `public.brands`, `public.categories`
* **Sugestão de Correção:**
  1. Adicionar restrições de RLS nas tabelas `brands` e `categories` exigindo que apenas usuários com perfil `ADMIN` ou com privilégios específicos de catálogo possam executar `INSERT`, `UPDATE` ou `DELETE`.
  2. Caso marcas e categorias devam ser isoladas por loja, adicionar a coluna `store_id NOT NULL REFERENCES stores(id)` com política RLS baseada em `store_id` e atualizar o filtro nos serviços do frontend.

---

### 2. [ALTO] Exposição de RPCs de Automação `SECURITY DEFINER` para Permissões Amplas de Usuário (`authenticated`)

* **Severidade:** ALTO
* **Explicação do Problema:**
  Na migração `20260930030001_automations_rpc.sql`, as funções de gerenciamento de automação (`create_automation_rule`, `update_automation_rule`, `toggle_automation_rule`, `delete_automation_rule`) são definidas como `SECURITY DEFINER` e concedidas diretamente ao perfil `authenticated`. Embora utilizem `current_user_store_role(p_store_id)` para checar se o usuário é `ADMIN` ou `MANAGER`, a RPC `run_automation_cycle` não valida se a chamada veio do runner de background (`service_role`), permitindo que qualquer usuário autenticado force ciclos arbitrários de automação.
* **Arquivos / Tabelas / Funções Afetados:**
  * Banco de Dados: `supabase/migrations/20260930030001_automations_rpc.sql`
  * Funções: `public.run_automation_cycle`, `public.create_automation_rule`, `public.update_automation_rule`
* **Sugestão de Correção:**
  1. Revogar `EXECUTE` da função `run_automation_cycle` para a role `authenticated` e manter permissão de execução restrita a `service_role`.
  2. Adicionar asserção explícita no corpo de `run_automation_cycle` validando que a função só é executada se a role do JWT for `service_role`.

---

### 3. [ALTO] Silenciamento de Erros e Supressão de Exceptions na Criação Automática de Marcas/Categorias na Importação de Estoque

* **Severidade:** ALTO
* **Explicação do Problema:**
  No serviço de inventário (`src/services/inventory.service.ts`), durante o parsing e importação de produtos (`parseAndPrepareItems`), o código realiza inserções dinâmicas de marcas e categorias com tratamento de erro silencioso (`catch (err) { console.error(...); }`). Se uma inserção de marca falhar (por exemplo, por violação de constraint ou falha na rede), o código continua a execução e insere a variante/produto sem a chave estrangeira correta ou associa a marca como nula/inválida, corrompendo a integridade cadastral do inventário.
* **Arquivos / Tabelas / Funções Afetados:**
  * Frontend: `src/services/inventory.service.ts` (linhas 110-135)
* **Sugestão de Correção:**
  Lançar exceções explicitamente ou abortar a transação do lote de importação quando a criação da marca/categoria falhar, informando o usuário na interface ao invés de ignorar a falha em log de console.

---

### 4. [MÉDIO] Inconsistência na Validação de Tipos e Tratamento de Erro de BOLA/IDOR nas Consultas de Histórico de Vendas

* **Severidade:** MÉDIO
* **Explicação do Problema:**
  Em `src/services/movements/movements.service.ts`, na função `getSalesList`, o parâmetro `storeId` é passado e filtrado via `.eq('store_id', storeId)`. Contudo, se `storeId` for omitido ou fornecido como string vazia ou undefined por inconsistência do estado do React Context, a query consulta a tabela `sales` sem restrição de `store_id`. Embora o RLS do Supabase bloqueie linhas de outras lojas para usuários normais, a falta de validação antecipada (`guard clause`) no frontend gera requisições desnecessárias, retornos inconsistentes e potenciais exceções 400 do PostgreSQL.
* **Arquivos / Tabelas / Funções Afetados:**
  * Frontend: `src/services/movements/movements.service.ts` (linhas 75-90)
* **Sugestão de Correção:**
  Adicionar validação estrita no início da função: `if (!storeId) throw new Error("storeId é obrigatório para consultar vendas.");`.

---

### 5. [MÉDIO] Inexistência de Índice Composto de Performance nas Consultas de Auditoria e Eventos de Automação

* **Severidade:** MÉDIO
* **Explicação do Problema:**
  Nas tabelas recentemente adicionadas `automation_events` e `automation_runs` (`20260930030000_automations_core.sql`), as consultas de histórico de execução e agrupamentos por loja filtram por `store_id` e ordenam por `created_at DESC`. Não foi criado índice composto `(store_id, created_at DESC)`. Conforme a tabela acumula eventos de automação do PDV, as queries de listagem na dashboard de automação sofrerão degradação de performance por Sequential Scans.
* **Arquivos / Tabelas / Funções Afetados:**
  * Banco de Dados: `public.automation_events`, `public.automation_runs`
  * Migração: `supabase/migrations/20260930030000_automations_core.sql`
* **Sugestão de Correção:**
  Criar índices compostos:
  `CREATE INDEX idx_automation_events_store_created ON public.automation_events (store_id, created_at DESC);`
  `CREATE INDEX idx_automation_runs_store_created ON public.automation_runs (store_id, created_at DESC);`

---

### 6. [BAIXO] Ausência de Feedback Visual / Loading State no Módulo de Marcas e Categorias

* **Severidade:** BAIXO
* **Explicação do Problema:**
  Operações de criação e remoção em `src/services/brands.service.ts` e `src/services/categories.service.ts` não fornecem feedbacks estruturados de erro para os componentes visuais, retornando arrays vazios `[]` ou `null` quando ocorrem falhas de permissão no Supabase. Isso faz com que a interface falhe silenciosamente do ponto de vista da experiência do usuário (UX).
* **Arquivos / Tabelas / Funções Afetados:**
  * Frontend: `src/services/brands.service.ts`, `src/services/categories.service.ts`
* **Sugestão de Correção:**
  Propagar os erros lançados pelo SDK Supabase para que a camada de UI exiba mensagens explicativas (Toasts/Alerts) ao usuário.

---

## Status dos Testes e Verificações Estáticas
* `npm run typecheck`: **Passou** (0 erros de tipagem TypeScript).
* `npm test` (Vitest): **Passou** (13/13 testes unitários aprovados em 4 suites).

---

## Recomendações Prioritárias para Próximas Sprints
1. Aplicar migração de hardening RLS sobre as tabelas globais `brands` e `categories`.
2. Restringir explicitamente a execução de `run_automation_cycle` à role `service_role`.
3. Refatorar o importador de inventário para abortar em caso de erro na resolução de marca/categoria.
