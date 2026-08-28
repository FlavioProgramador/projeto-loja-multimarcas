# SECURITY_AUDIT.md — VESTRA ERP
## Auditoria de Segurança — Fase 0

**Data:** 2026-08-25  
**Branch:** `fix/fase-0-seguranca-critica`  
**Escopo:** Vulnerabilidades críticas e de alto risco em RBAC, RLS, RPCs e autenticação.

---

## Resumo Executivo

Foram identificadas e corrigidas **15 vulnerabilidades**, distribuídas em 3 níveis de severidade. As mais críticas permitiam que qualquer pessoa na internet aprovasse vendas sem pagar e que qualquer usuário se auto-promovesse a ADMIN.

---

## Vulnerabilidades Corrigidas

### 🔴 CRÍTICO

| ID | Vulnerabilidade | Causa Raiz | Correção | Arquivo(s) | Status |
|---|---|---|---|---|---|
| V-01 | Fallback de role para `ADMIN` | `profile?.role \|\| 'ADMIN'` — se perfil falhasse ao carregar, usuário ganhava acesso total | Alterado para `?? 'EMPLOYEE'` | `AuthContext.tsx:83` | ✅ Corrigido |
| V-02 | Frontend enviava `role` no cadastro | `signUp()` aceitava `role` e enviava em `raw_user_meta_data` | Removido parâmetro `role` do `signUp`; comentário explicativo no código | `auth.service.ts:50` | ✅ Corrigido |
| V-03 | Trigger `handle_new_user` aceitava role do metadata | `COALESCE(raw_user_meta_data->>'role', 'EMPLOYEE')` — qualquer role enviada era aceita | Trigger reescrito para sempre criar `EMPLOYEE`, ignorando metadata | `supabase/migrations/` | ✅ Corrigido |
| V-04 | Policy UPDATE de `profiles` sem `WITH CHECK` | `WITH CHECK: null` permitia `UPDATE SET role='ADMIN'` por qualquer usuário autenticado | Duas policies separadas com `WITH CHECK` explícito; RPC `admin_set_user_role` para promoção controlada | `migration: security_v02` | ✅ Corrigido |
| V-05 | `approve_mp_pix_sale` sem idempotência | Webhook duplicado do MP processava a mesma venda duas vezes | RPC reescrita com verificação de status atual (`FOR UPDATE`); retorna `idempotent: true` se já processada | `migration: security_v04b` | ✅ Corrigido |
| V-06 | `approve_mp_pix_sale` acessível por `anon` | `GRANT EXECUTE TO anon` permitia aprovação fraudulenta sem autenticação | `REVOKE` aplicado; apenas `service_role` mantém EXECUTE | `migration: hotfix_revoke_approve_mp_pix_sale_from_anon` | ✅ Corrigido |

### 🟡 ALTO

| ID | Vulnerabilidade | Causa Raiz | Correção | Arquivo(s) | Status |
|---|---|---|---|---|---|
| V-07 | Dados sensíveis persistem no `localStorage` após logout | `signOut()` não limpava `erp_customers`, `erp_transactions`, `erp_movements`, etc. | `signOut` agora remove todas as chaves sensíveis do `localStorage` | `AuthContext.tsx:77` | ✅ Corrigido |
| V-08 | `complete_sale` executável sem autenticação | `auth.uid()` era usado mas nunca validado — chamada anon passava com `user_id = NULL` | RPC reescrita com verificação explícita: `IF v_user_id IS NULL THEN RAISE EXCEPTION` | `migration: security_v03` | ✅ Corrigido |
| V-09 | `customers` com `WITH CHECK (true)` aberto | Qualquer autenticado podia criar, editar ou deletar qualquer cliente | Policy restrita a `ADMIN`, `MANAGER`, `CASHIER` | `migration: security_v05b` | ✅ Corrigido |
| V-10 | INSERT direto em tabelas de venda sem RPC | Policies `WITH CHECK (true)` em `sales`, `sale_items`, `payments` permitiam bypass das RPCs transacionais | Policies de INSERT direto removidas; apenas `INVENTORY_MOVEMENTS` mantém INSERT para ADMIN/MANAGER | `migration: security_v05b` | ✅ Corrigido |
| V-11 | `complete_sale` e `create_mp_pix_sale` acessíveis por `anon` | `GRANT EXECUTE TO anon, PUBLIC` | `REVOKE` aplicado; apenas `authenticated` mantém EXECUTE | `migration: hotfix_revoke_rpc_functions_from_anon` | ✅ Corrigido |
| V-12 | Webhook sem validação de replay | `mp-webhook` não verificava idempotência; agora a RPC resolve isso internamente | Código do webhook atualizado com logging de `idempotent`; CORS via env var | `supabase/functions/mp-webhook/index.ts` (deploy v10) | ✅ Corrigido |

### 🟢 BAIXO / MÉDIO

| ID | Vulnerabilidade | Causa Raiz | Correção | Arquivo(s) | Status |
|---|---|---|---|---|---|
| V-13 | Placeholder `admin@vestra.com` no input | Sugeria existência de conta admin padrão | Removido da análise — placeholder apenas no atributo HTML, sem impacto funcional | `AuthModal.tsx:141` | ⚠️ Aceito |
| V-14 | `financial_transactions` visível para `EMPLOYEE` | Policy `SELECT` aberta para todos os `authenticated` | Restrito a `ADMIN`, `MANAGER`, `CASHIER` | `migration: security_v05b` | ✅ Corrigido |
| V-15 | Interface `signUp` expunha parâmetro `role` | Definição de tipo incluía `role?: UserRole` — criava expectativa incorreta | Parâmetro removido da interface e implementação | `AuthContext.tsx`, `auth.service.ts` | ✅ Corrigido |

---

## Novas Estruturas de Segurança

### RPC: `admin_set_user_role`
- **Propósito:** Única forma autorizada de promover/rebaixar papel de usuário
- **Proteção:** Verifica `current_user_role() = 'ADMIN'`, valida role destino, impede auto-alteração
- **Acesso:** Apenas `authenticated` pode chamar; a verificação interna garante que só ADMIN tem efeito

### Arquivo: `src/lib/permissions.ts`
- **Propósito:** Sistema centralizado de RBAC para o frontend
- **API:** `can(role, 'sales.create')` → `boolean`
- **Papéis:** `ADMIN > MANAGER > CASHIER > EMPLOYEE`
- **IMPORTANTE:** É apenas para UX (ocultar/desabilitar UI). A segurança real está no banco.

---

## Policies RLS — Estado Final

| Tabela | Operação | Quem pode | WITH CHECK |
|---|---|---|---|
| `profiles` | SELECT | `authenticated` | — |
| `profiles` | UPDATE (próprio) | `authenticated` | Não pode alterar `role` ou `is_active` |
| `profiles` | UPDATE (qualquer) | `ADMIN` | ADMIN pode alterar qualquer |
| `sales` | SELECT | `authenticated` | — |
| `sales` | UPDATE | `ADMIN`, `MANAGER` | Verifica role |
| `sale_items` | SELECT | `authenticated` | — |
| `payments` | SELECT | `authenticated` | — |
| `inventory_movements` | SELECT | `authenticated` | — |
| `inventory_movements` | INSERT | `ADMIN`, `MANAGER` | Verifica role |
| `financial_transactions` | SELECT | `ADMIN`, `MANAGER`, `CASHIER` | — |
| `financial_transactions` | ALL | `ADMIN`, `MANAGER`, `CASHIER` | Verifica role |
| `customers` | ALL | `ADMIN`, `MANAGER`, `CASHIER` | Verifica role |
| `products` | SELECT | `authenticated` | — |
| `products` | ALL | `ADMIN`, `MANAGER` | Verifica role |
| `product_variants` | SELECT | `authenticated` | — |
| `product_variants` | ALL | `ADMIN`, `MANAGER` | Verifica role |
| `brands`, `categories`, `coupons` | SELECT | `authenticated` | — |
| `brands`, `categories`, `coupons` | ALL | `ADMIN`, `MANAGER` | Verifica role |
| `suppliers` | SELECT | `authenticated` | — |
| `suppliers` | ALL | `ADMIN`, `MANAGER` | Verifica role |

---

## RPCs — Grants Finais

| Função | EXECUTE para |
|---|---|
| `complete_sale` | `authenticated` |
| `create_mp_pix_sale` | `authenticated` |
| `approve_mp_pix_sale` | `service_role` apenas |
| `cancel_mp_pix_sale` | `service_role` apenas |
| `admin_set_user_role` | `authenticated` (verificação interna de ADMIN) |
| `current_user_role` | Revogado de `anon`/`PUBLIC`; manter `authenticated` |
| `handle_new_user` | Trigger (não chamável via API) |
| `handle_updated_at` | Trigger (não chamável via API) |
| `rls_auto_enable` | Event trigger (não chamável via API) |

---

## Pendências (Fora do Escopo desta Fase)

| Item | Prioridade | Descrição |
|---|---|---|
| Webhook signature validation | 🟡 Alta | MP suporta `X-Signature` — validar HMAC antes de processar |
| Frontend RBAC aplicado na UI | 🟡 Alta | `permissions.ts` criado, mas componentes ainda não usam `can()` |
| `cancel_mp_pix_sale` revisão | 🟡 Alta | Verificar idempotência e regras de negócio completas |
| Testes automatizados de segurança | 🟡 Alta | Os 10 cenários do spec ainda precisam ser implementados |
| Divergência `setup.sql` vs `migrations/` | 🟢 Média | Dois arquivos de schema divergentes na branch |

---

## Histórico de Migrations de Segurança (nesta auditoria)

1. `hotfix_revoke_approve_mp_pix_sale_from_anon` — REVOKE `anon` de `approve_mp_pix_sale`
2. `hotfix_revoke_rpc_functions_from_anon` — REVOKE `anon`/`PUBLIC` de `complete_sale`, `create_mp_pix_sale`, `current_user_role`
3. `security_v01_handle_new_user_role_lockdown` — Trigger sempre cria EMPLOYEE
4. `security_v02_profiles_rls_with_check` — WITH CHECK em profiles UPDATE + RPC `admin_set_user_role`
5. `security_v03_complete_sale_auth_required` — Auth obrigatória em `complete_sale`
6. `security_v04b_approve_pix_idempotency_drop_recreate` — Idempotência em `approve_mp_pix_sale`
7. `security_v05b_rls_direct_insert_protection` — Remoção de INSERT direto + restrição de visualização financeira
8. `security_v06_create_mp_pix_sale_auth_required` — Auth obrigatória em `create_mp_pix_sale`
