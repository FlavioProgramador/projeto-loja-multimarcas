# Auditoria Completa do Projeto — Vestra / CoreSys ERP/PDV

**Data:** 2026-12-29
**Escopo:** código-fonte `src/`, `supabase/`, raiz (configs, CI, env), dependências e estado de execução local.
**Método:** leitura direta do código, verificação de diferença com auditorias anteriores (`docs/audits/`), execução real de `npm run typecheck`, `npm run build` e `npm audit`, inspeção de workflows e arquivos de ambiente.

---

## 1. Resumo Executivo

O Vestra é um PDV/ERP SPA em **React 19 + TypeScript + Vite 6**, sem backend próprio, acoplado diretamente ao **Supabase** (Postgres + Auth + Edge Functions Deno) via `anon key` no navegador; Mercado Pago (PIX) integrado via 2 Edge Functions. A arquitetura evoluiu significativamente desde a auditoria inicial de 25/09: multi-loja (`store_id`, `user_store_access`, `store_inventory`) está implementada, RLS foi endurecida por migrations dedicadas, o cadastro público não concede mais `ADMIN`, e o webhook do Mercado Pago valida assinatura HMAC com proteção anti-replay.

O estado atual é **razoavél para homologação controlada**, mas **não pronto para produção**: o `typecheck` falha no código atual (bloqueando as próprias pipelines), não há testes automatizados executando, a CI é só `npm ci + typecheck + build` (sem deploy real), e itens de hardening SQL pendentes da reanálise de 28/09 ainda não foram migrados. Segurança de pagamento PIX e RLS estão bem encaminhadas; falta fechar: correção do erro de TS, testes, remoção de dependências mortas, e padronização de ambiente dev/prod.

**Nota geral: 5,0 / 10** (melhorou de 3,5/10 na auditoria inicial — correções de segurança críticas foram implementadas).

---

## 2. Estado dos achados anteriores

### Corrigidos desde a auditoria inicial (25/09)
| Item antigo | Estado atual | Evidência |
|---|---|---|
| BUG-02 — signup público vira ADMIN | ✅ Corrigido | `src/pages/RegisterPage.tsx` chama `signUp(email, password, fullName)` sem papel; provisionamento de loja/papel via trigger em `supabase/migrations/20260928240000_provision_new_user_store_access.sql` |
| BUG-03 — auto-promoção via `profiles.role` | ✅ Mitigado | migrations `20260928000001_hardening_auth_integrity.sql` e `20260929*` restringem `role` a ADMIN |
| BUG-04/05 — RPCs PIX inexistentes + `process.env` | ✅ Corrigido | `create-mp-pix/index.ts`, `mp-webhook/index.ts` usam `Deno.env`, RPCs `create_mp_pix_sale`/`approve_mp_pix_sale` existem; `mp-webhook` com HMAC + replay protection |
| BUG-06/07 — delete+recreate de variantes / exclusão apaga histórico | ✅ Corrigido | `ProductsService.update()` passou a chamar `manage_product` (RPC); `remove()` faz soft delete (`is_active=false`) |
| BUG-08 — vendas canceladas somando como faturamento | ✅ Corrigido | `SalesService.getMovements()` filtra `status = 'COMPLETED'`; `process_return` valida venda concluída |
| Multi-loja inexistente | ✅ Implementado | `user_store_access`, `store_inventory`, `sale_idempotency`, migrations `20260925`/`20260928` |
| RBAC no frontend | ✅ Parcial | `App.tsx`/`AppLayout.tsx`/`Sidebar.tsx` têm `MODULE_PERMISSIONS` por papel; ainda sem bloqueio fino por ação |

### Itens pendentes (da reanálise Supabase 28/09)
- 🔴 Sobrecarga legada `complete_sale(uuid,text,text,jsonb,text,integer,numeric,numeric,text)` ainda executável por `authenticated` — precisa de `REVOKE EXECUTE` ou migração de endurecimento.
- 🔴 RPCs `complete_sale` (nova), `create_mp_pix_sale`, `cancel_sale`, `manage_product`, `approve_physical_inventory` com padrões que **não são fail-closed quando `role IS NULL`**; exigir idempotency key obrigatória.
- 🟠 Relatórios `report_stock_status`, `report_top_selling_products`, `report_inventory_movements_summary`, `get_profitability_*` sem filtro por loja no corpo — inseguros em multi-loja.
- 🟠 Policy de UPDATE de `physical_inventories` deve preservar `store_id`/`created_by`.
- 🟡 3 funções do schema `stripe` com `search_path` mutável; código das Edge Functions Stripe (`stripe-setup`, `stripe-webhook`, `stripe-worker`) não está versionado neste repositório.
- 🟡 Advisor: proteção contra senhas vazadas desativada; índices não utilizados/FK sem índice no schema `stripe`.
- 🟡 Histórico de estoque: 18 linhas legadas com `store_id = NULL` (imutáveis por trigger) — visíveis só a ADMIN; tratado como dívida histórica.

---

## 3. Achados atuais (execução em 29/12/2026)

### 🔴 CRÍTICO — `typecheck` reprovando
`npx tsc --noEmit` falha com:
```
src/contexts/StoreContext.tsx(372,37): error TS2339: Property 'custo' does not exist on type 'Omit<Product, "id">'.
```
Impacto: todas as pipelines CI chamam `npm run typecheck` — ou seja, o CI de `dev`, `staging`, `production` e o workflow de auditoria estão todos **quebrando hoje** com o código em `main`. Como as pipelines não fazem deploy real, o impacto imediato é bloqueio de merge/entrega, não produção. Regressão provável de 6f9ab38 / 71be81a.

Correção: incluir `custo?: number` em `Product` (`src/types.ts`) ou alterar `StoreContext.addProduct` para passar `custoUnitario` apenas por parâmetro já aceito por `ProductsService.create`.

### 🟠 Alto — Cobertura de testes = zero
- `npm run test` é placeholder: `echo "Testes automatizados ainda não configurados"`.
- Nenhum arquivo `*.test.*` fora de `node_modules`.
- Em `supabase/tests/` há smoke/regression SQL, mas não são executados por nenhum pipeline.
- Edge Functions críticas de pagamento sem testes Deno.

### 🟠 Alto — Build sem code splitting e com dependências mortas
- `npm run build` gera **bundle único de 818,79 kB** (233,33 kB gzip) — acima do limite de 500 kB do Vite. Detectado warning oficial de code-splitting obrigatório.
- Dependências declaradas **não usadas** em `src/` (grep confirmou ausência de uso): `express`, `dotenv`, `@google/genai`. Risco de supply-chain e CVEs sem benefício.
- `package.json` duplica `vite` em `dependencies` e `devDependencies`.

### 🟠 Alto — `npm audit` com vulnerabilidades moderadas
```
qs (<=6.15.3) — DoS / array-limit bypass
body-parser (1.20.5-1.20.6) — depende de qs
express (4.22.2) — depende de qs
```
Fix simples (`npm audit fix`), mas deve-se subir.
Não explorado: dependências do projeto em si são desnecessárias em SPA (sem uso em `src/`) — remover é melhor que corrigir.

### 🟡 Médio — CI/CD fraca e sem deploy real
- 5 workflows em `.github/workflows/`; todos fazem apenas `checkout → npm ci → typecheck → build`. Sem lint, sem testes, sem deploy. `production.yml` promete proteção por `GitHub Environment`, mas não entrega o artefato.
- `staging.yml` e branch de staging não estão alinhados com Git Flow documentado (README cita `staging`, workflow dispara em `release/*` e PR para `main`).
- 2 workflows de auditoria (`auditoria-final-v2.yml`, `auditoria-visual.yml`) parecem efêmeros e deveriam ser removidos.

### 🟡 Médio — Qualidade de código/ferramentas
- **Sem ESLint/Prettier**; `npm run lint` é apenas alias de `tsc --noEmit`.
- `tsconfig.json` **não tem `strict: true`** — porta de qualidade fraca mesmo com typecheck habilitado.
- Arquivos com encoding misto (mojibake em workflows/Readme), indicado também na auditoria de qualidade & DevOps.
- Aliás `@/*` em [vite.config.ts](vite.config.ts) e tsconfig apontam para raiz do projeto, não `src/` — funcional, mas convenciónalmente é `./src/*` e pode confundir ao modificar estrutura.

### 🟡 Médio — Ambientes e secrets
- `.env` e `.env.local` contêm a **anon key real** do projeto `ndrjynlbwrugakjqtzwy`. Por ser anon+RLS isso não vaza segredo sozinho, mas o README confessa não saber se esse projeto é DEV ou PROD — risco operacional de testes em produção e também de que environments de CI não consigam distinguir chaves por ambiente.
- `NEXT_PUBLIC_SUPABASE_*` duplicado com `VITE_SUPABASE_*` — ruído de herança Next.js que deve ser removido ou documentado.
- Workflows usam um único par de secrets sem GitHub Environments distintos.

### 🟡 Médio — Pontos positivos relevantes
- Nada de segredo hardcoded em código fonte nem `.env*` no Git (confirmado).
- Sem `dangerouslySetInnerHTML`/`eval()`/`innerHTML` em `src/`; sem chamadas óbvias inseguras.
- RLS habilitada em todas as tabelas de negócio; migrations com hardening explícito (EXECUTE revogado de `anon`, `search_path` fixo nas RPCs críticas).
- CartContext e StoreContext usam locks/atómicas no backend; PIX usa idempotency e validação no webhook.
- Autenticação já corrige fluxo de recuperação via `AUTH_*` hardening de 28/09 (regression smoke SQL existe).

### 🟢 Baixo — Limpeza
- `_audit_trigger.txt` e `_visual_audit_trigger.txt` na raiz são triggers de CI acidentais.
- `audit-npm.json` deixado na raiz pela execução de auditoria.

---

## 4. Verificações executadas nesta auditoria

| Comando | Resultado |
|---|---|
| `npm run typecheck` | ❌ Falha — `StoreContext.tsx:372 property 'custo' does not exist` |
| `npm run build` | ✅ Completo com `vite build`, **mas gera 1 chunk ~819 kB** e warning de chunk >500 kB |
| `npm audit` | ⚠️ 3 moderações em `qs`/`body-parser`/`express` |
| `git log --oneline .env .env.local` | ✅ Nenhum commit (não versionados) |
| `git status` | ✅ Apenas `supabase/config.toml` modificado + artefatos de auditoria / `docs/audits/AUDITORIA_QUALIDADE_DEVOPS.md` |

---

## 5. Prioridades de ação (ordem sugerida)

1. **P0 — Corrigir `typecheck`**: resolver `Property 'custo' does not exist on type 'Omit<Product, "id">'` em `src/contexts/StoreContext.tsx:372`; rodar `npm run typecheck` e `npm run build` para destravar CI.
2. **P0 — Endurecer PostgreSQL** conforme `SUPABASE_REANALISE_2026-09-28.md`: `REVOKE EXECUTE` da sobrecarga antiga `complete_sale`, fail-closed em `role IS NULL`, exigência de idempotency key, filtro por loja nas RPCs de relatório, endurecer UPDATE de `physical_inventories`.
3. **P0 — Resolver ambiguidade PROD vs DEV do projeto Supabase `ndrjynlbwrugakjqtzwy`**: classificar e padronizar env/secrets por GitHub Environment.
4. **P1 — Pipeline mínima saudável**: `npm ci → typecheck → lint (ESLint) → test (Vitest) → build`; promoção de staging/production com deploy real (Vercel/Netlify/S3+CloudFront); remover workflows de auditoria pontual.
5. **P1 — Cobertura de testes**: Vitest + Testing Library no front; Deno test nas Edge Functions; promover os smoke SQLs via `supabase test db`.
6. **P1 — Limpeza de dependências**: remover `express`, `dotenv`, `@google/genai`, duplicata de `vite`; `npm audit fix`.
7. **P2 — Qualidade de código**: adicionar ESLint + Prettier, padronizar UTF-8, ativar `strict: true` no tsconfig, renomear `lint` para verdadeiro ESLint, corrigir drift do README (Recharts/date-fns não são usados; Tailwind 4 é).
8. **P2 — LGPD/Cache**: expirar `localStorage` sensível no logout (hoje `clearLocalCaches()` já limpa no signOut — manter e expandir), diferenciar leitura de PII por papel.

---

## 6. Conclusão

O Vestra evoluiu de um MVP inseguro para um sistema com camadas corretas de segurança no backend (RLS + RPCs atômicos + JWT no PIX) e o problema mais grave das explorações de privilégio inicial foi mitigado. O maior risco imediato **não é mais a autenticação**, mas sim a **ausência de sintonia operacional**: pipelines quebram por um erro de tipagem, não há testes nem deploy real, as dependências estão inchadas, e o papel do projeto Supabase de referência permanece indefinido. Com o P0 resolvido, o próximo passo é transformar a CI em guardiã de qualidade e completar os itens de hardening SQL pendentes da reanálise de 28/09.

**Recomendação pragmática:** não liberar para produção com dados reais até resolver o typecheck, os warns de build, o `npm audit` e o ponto 4 da seção 5; depois disso, produção mínima viável com homologação controlada.
