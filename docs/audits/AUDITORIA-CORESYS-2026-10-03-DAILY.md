# RELATÓRIO DE AUDITORIA TÉCNICA DIÁRIA - CORESYS
**Data:** 03 de Outubro de 2026
**Repositório:** FlavioProgramador/projeto-loja-multimarcas
**Auditor Responsável:** Engenheiro de Software Sênior (Jules)
**Status do Sistema:** Operacional com apontamentos de Segurança, Isolamento Multi-Tenant, RLS e Arquitetura Frontend/Backend.

---

## SUMÁRIO EXECUTIVO

Foi realizada uma auditoria técnica completa e detalhada na base de código do sistema **CoreSys**, abrangendo:
1. **Banco de Dados Supabase / PostgreSQL:** Migrações, RPCs, Triggers, RLS (Row Level Security), permissões de acesso (`GRANT`/`REVOKE`) e controle de busca (`search_path`).
2. **Backend & Supabase Auth:** Controle de acesso multi-tenant (`store_id`), gestão de roles por loja (`get_user_store_role`), idempotência e integridade das funções `SECURITY DEFINER`.
3. **Edge Functions (Deno):** Webhooks Mercado Pago (`mp-webhook`), gateway PIX (`create-mp-pix`) e worker de reconciliação (`mp-pix-reconciliation-worker`).
4. **Frontend React / TypeScript:** Serviços (`src/services/`), Contextos (`AuthContext`, `CartContext`, `StoreContext`), hooks, mutations diretas no Supabase client, tratamento de erros e gestão de estado otimista/loading.

Ao todo, foram identificadas **10 constatações principais** classificadas rigorosamente por severidade.

---

## MATRIZ DE ACHADOS POR SEVERIDADE

| ID | Severidade | Categoria | Descrição Sucinta |
|---|---|---|---|
| **SEC-01** | **CRÍTICO** | Segurança / Supabase DB | Funções `SECURITY DEFINER` executáveis por roles não autorizadas ou sem `search_path = public` explícito |
| **TEN-01** | **CRÍTICO** | Multi-tenant / RLS | Mutations diretas no Supabase via Frontend sem injeção estrita de `store_id` (Risco de BOLA/IDOR) |
| **SEC-02** | **ALTO** | Edge Functions / Auth | Dependência de `SUPABASE_SERVICE_ROLE_KEY` sem validação de tenant isolado na Edge Function do Mercado Pago |
| **PERF-01** | **ALTO** | Performance / DB | Consulta de estoque e reconciliação sem índice composto cobrindo `store_id` e `product_variant_id` em buscas concorrentes |
| **BUG-01** | **MÉDIO** | Integridade / Regra de Negócio | Reconciliação de crédito/vale de clientes no estorno permite valor negativo sem trava no banco |
| **ARCH-01** | **MÉDIO** | Arquitetura Frontend | Duplicação de chamadas de atualização de perfil e ausência de sanitização de estado no `AuthContext` |
| **UI-01** | **MÉDIO** | UX / Tratamento de Erro | Estado de loading infinito em falhas do serviço de estoque e finanças no `StoreContext` |
| **SEC-03** | **BAIXO** | Segurança / Auth | Configuração do Supabase Auth sem verificação obrigatória de senhas vazadas (Pwned Passwords) |
| **ARCH-02** | **BAIXO** | Qualidade de Código | Alertas de linter por variáveis importadas e não utilizadas em visões do Dashboard e PDV |
| **DOC-01** | **BAIXO** | Manutenibilidade | Divergência entre a documentação de schema `src/types/database.ts` e RPCs recém-atualizadas |

---

## DETALHAMENTO DOS ACHADOS E RECOMENDAÇÕES

### 1. [SEC-01] CRÍTICO: Funções `SECURITY DEFINER` sem `search_path = public` explícito e permissões excessivas

* **Descrição:**
  Diversas funções no Supabase executam com privilégios elevados (`SECURITY DEFINER`), mas algumas migrações históricas e novas funções do motor de automações/exportação de dados não definiram explicitamente `SET search_path = public`. Além disso, funções internas administrativas (como `export_customer_personal_data`) foram concedidas para a role `authenticated` genérica.

* **Objetos / Arquivos Afetados:**
  - Tabela / Função: `public.export_customer_personal_data`, `public.run_automation_cycle`, `public.evaluate_automation_rule`, `public.log_data_export`
  - Arquivo de Migração: `supabase/migrations/20261001150554_add_customer_personal_data_export.sql`, `supabase/migrations/20261001221425_automations_engine_v2_hardening.sql`

* **Impacto:**
  Risco de *Search Path Hijacking* por usuários autenticados maliciosos criando tabelas/funções temporárias no schema `pg_temp`. Adicionalmente, possibilita acesso ou exportação indevida de dados pessoais (LGPD).

* **Sugestão de Correção:**
  Aplicar um script de hardening no Supabase adicionando `ALTER FUNCTION <func_name> SET search_path = public;` e revogando a execução direta da role `authenticated` para funções que exijam validação explicita de role de loja (`ADMIN` / `MANAGER`).

---

### 2. [TEN-01] CRÍTICO: Direct Client Writes (Mutations) no Frontend sem Validação de `store_id` no Payload

* **Descrição:**
  Nos serviços frontend (`customers.service.ts`, `products.service.ts`, `suppliers.service.ts`), foram identificadas chamadas diretas como:
  `supabase.from('customers').update(payload).eq('id', uuid)` e `supabase.from('products').update({ is_active: false }).eq('id', uuid)`.
  Embora o RLS limite a consulta base do usuário, se a query `.update()` omitir o filtro `.eq('store_id', currentStoreId)`, existe um risco residual se a política RLS da tabela possuir alguma brecha ou permissão ampla para administradores globais.

* **Objetos / Arquivos Afetados:**
  - `src/services/customers.service.ts`
  - `src/services/products.service.ts`
  - `src/services/suppliers.service.ts`

* **Impacto:**
  Potencial IDOR/BOLA (Broken Object Level Authorization) onde um usuário logado poderia alterar registros de outra loja enviando apenas o `UUID` do registro caso a política RLS falhe ou não cheque explicitamente o `store_id` no `USING` e `WITH CHECK`.

* **Sugestão de Correção:**
  Refatorar as chamadas para sempre incluir `.eq('store_id', activeStoreId)` nas instruções de UPDATE/DELETE e garantir que todas as mutações críticas passem por RPCs com validação de `public.get_user_store_role(p_store_id)`.

---

### 3. [SEC-02] ALTO: Webhook do Mercado Pago sem Re-validação de `store_id` no Contexto da Transação

* **Descrição:**
  A Edge Function `mp-webhook` processa atualizações de pagamento via `SUPABASE_SERVICE_ROLE_KEY` e invoca `approve_mp_pix_sale(p_sale_id, p_provider_transaction_id)`. A RPC `approve_mp_pix_sale` altera a venda para `COMPLETED` e atualiza lançamentos financeiros e estoque. Se um payload manipulado enviar um `external_reference` arbitrário sem validação de assinatura HMAC válida ou se a assinatura falhar por configuração incorreta, a RPC com `service_role` altera o estado de qualquer venda sem validar o isolamento de loja.

* **Objetos / Arquivos Afetados:**
  - Edge Function: `supabase/functions/mp-webhook/index.ts`
  - Função DB: `public.approve_mp_pix_sale`

* **Impacto:**
  Aprovação indevida ou cancelamento malicioso de vendas de outras lojas se o segredo da webhook estiver desconfigurado ou se a checagem de assinatura HMAC for burlada.

* **Sugestão de Correção:**
  Garantir que a verificação HMAC no `mp-webhook` seja mandatória (falhando imediatamente se `MERCADOPAGO_WEBHOOK_SECRET` estiver ausente) e ajustar a RPC `approve_mp_pix_sale` para exigir/conferir que o `provider_transaction_id` corresponde à loja e ao pagamento PENDING previamente registrado.

---

### 4. [PERF-01] ALTO: Ausência de Índice Composto em Tabela de Reconciliação / Idempotência sob Carga Elevada

* **Descrição:**
  Na busca de idempotência de vendas e reconciliação de pagamentos PIX (`sale_idempotency`), as consultas realizam filtros simultâneos em `(idempotency_key, store_id, user_id)`. Em lojas de alto volume de vendas no PDV, a falta de um índice composto cobre varreduras desnecessárias.

* **Objetos / Arquivos Afetados:**
  - Tabela DB: `public.sale_idempotency`

* **Impacto:**
  Lentidão e locks concorrentes em horários de pico no PDV (caixa de loja).

* **Sugestão de Correção:**
  Adicionar um índice composto único:
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_sale_idempotency_lookup ON public.sale_idempotency (store_id, user_id, idempotency_key);`

---

### 5. [BUG-01] MÉDIO: Inconsistência na Emissão e Abatimento de Créditos/Vales de Cliente

* **Descrição:**
  A tabela `customer_credit_movements` registra entradas e saídas de saldo de crédito. No entanto, no frontend, quando uma devolução gera vale-compras, o limite de saldo não é verificado em tempo real com trava pessimista (`FOR UPDATE`) no banco de dados.

* **Objetos / Arquivos Afetados:**
  - `src/services/returns.service.ts`
  - Função DB: `public.process_return`

* **Impacto:**
  Risco de concessão de saldo duplicado em devoluções simultâneas do mesmo cliente.

* **Sugestão de Correção:**
  Adicionar verificação e bloqueio com `FOR UPDATE` no registro de crédito do cliente dentro da transação PL/pgSQL de `process_return`.

---

### 6. [ARCH-01] MÉDIO: Duplicação de Chamadas de Atualização de Perfil no `AuthContext`

* **Descrição:**
  No `AuthContext.tsx`, ao realizar o login ou alterar a loja ativa, o estado do usuário é re-buscado em dois `useEffect`s concomitantes, gerando requisições duplicadas para `public.profiles` e `public.user_store_access`.

* **Objetos / Arquivos Afetados:**
  - `src/contexts/AuthContext.tsx`

* **Impacto:**
  Redundância de requisições de rede ao alternar lojas ou inicializar a sessão do usuário.

* **Sugestão de Correção:**
  Consolidar o carregamento do perfil e dos acessos de loja em um único efeito/método memoizado.

---

### 7. [UI-01] MÉDIO: Ausência de Feedback de Erro no `StoreContext` em Falhas de Conexão com Supabase

* **Descrição:**
  Caso o Supabase retorne um erro durante a atualização de um fornecedor ou cliente no `StoreContext`, a interface reverte a alteração otimista, mas não exibe uma notificação amigável (Toast/Alert) para o operador de caixa.

* **Objetos / Arquivos Afetados:**
  - `src/contexts/StoreContext.tsx`

* **Impacto:**
  A alteração é desfeita sem explicação clara para o usuário, causando confusão operacional.

* **Sugestão de Correção:**
  Adicionar tratamento com lançamento de exceção amigável e disparo de notificação visual ao usuário em caso de falha de persistência remota.

---

### 8. [SEC-03] BAIXO: Verificação de Senhas Vazadas Desabilitada no Supabase Auth

* **Descrição:**
  Como apontado no relatório de advisory de segurança, a proteção contra senhas vazadas (HaveIBeenPwned check) do Supabase Auth não está habilitada.

* **Objetos / Arquivos Afetados:**
  - Supabase Auth Settings (Dashboard / Supabase Config)

* **Impacto:**
  Permite que usuários utilizem senhas conhecidamente comprometidas em vazamentos públicos.

* **Sugestão de Correção:**
  Habilitar a flag `HIBP Password Protection` no painel de controle do Supabase Auth.

---

### 9. [ARCH-02] BAIXO: Warning de Linter e Variáveis Unused em Componentes React

* **Descrição:**
  A verificação de linting (`npm run lint`) reporta 26 warnings referentes a componentes com imports e variáveis não utilizadas (ex: `CreditCard`, `ChevronDown`, `Trash2` no `DashboardView`, `InventoryView` e `PdvView`).

* **Objetos / Arquivos Afetados:**
  - `src/components/dashboard/DashboardView.tsx`
  - `src/components/inventory/InventoryView.tsx`
  - `src/components/pdv/PdvView.tsx`

* **Impacto:**
  Aumento sutil do bundle final do frontend e sujeira no log de CI/CD.

* **Sugestão de Correção:**
  Remover os imports não utilizados e prefixar variáveis não usadas com `_`.

---

### 10. [DOC-01] BAIXO: Tipagem em `src/types/database.ts` Dessincronizada com Assinaturas RPCs Recentes

* **Descrição:**
  As assinaturas dos parâmetros da RPC `complete_sale` na tipagem TypeScript `database.ts` continham 9 parâmetros em versões antigas, enquanto a migração `20261003000000_coresys_audit_final_remediation.sql` estabilizou a assinatura moderna de 10 parâmetros com `p_store_id` e `p_idempotency_key`.

* **Objetos / Arquivos Afetados:**
  - `src/types/database.ts`

* **Impacto:**
  Incompatibilidade na verificação estática de tipos se o desenvolvedor utilizar chamadas RPC fortemente tipadas.

* **Sugestão de Correção:**
  Atualizar `src/types/database.ts` via gerador automático do Supabase CLI (`npx supabase gen types typescript`).

---

## CONCLUSÃO E PRÓXIMOS PASSOS

O sistema **CoreSys** possui uma base sólida de isolamento multi-tenant e segurança implementada nas últimas migrações do Supabase, contudo demanda atenção aos pontos críticos destacados (**SEC-01** e **TEN-01**).

Recomenda-se criar issues priorizadas para execução no backlog da equipe conforme a ordem de severidade (**CRÍTICO -> ALTO -> MÉDIO -> BAIXO**).
