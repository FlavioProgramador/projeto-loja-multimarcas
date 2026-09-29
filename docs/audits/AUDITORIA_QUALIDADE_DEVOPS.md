# Auditoria de Qualidade & DevOps — Vestra (React + Vite + TS + Supabase)

**Data:** 2026-ateral (execução local em `D:\Projetos\vestra`)
**Escopo:** testes, CI/CD, ferramentas de qualidade, documentação, build, ambientes.

---

## 1. Cobertura de Testes — 🔴 Crítico

**Achados:**
- `package.json` `"test"` é um placeholder: `echo "Testes automatizados ainda não configurados"` ([package.json](../package.json)).
- **Zero** testes de frontend (`**/*.test.*`, `**/*.spec.*`) — os únicos matches são dentro de `node_modules`.
- Em `supabase/tests/` existem 2 arquivos SQL de boa qualidade:
  - [20260928_auth_integrity_smoke.sql](../supabase/tests/20260928_auth_integrity_smoke.sql): smoke test transacional real (auth, RLS, estoque, inventário físico) com `ROLLBACK` — bem escrito, mas depende de fixture (ADMIN/EMPLOYEE/loja ativos) e **não é executado por nenhum pipeline nem script npm**.
  - [20260928000001_auth_integrity_regression.sql](../supabase/tests/20260928000001_auth_integrity_regression.sql): na prática é apenas uma **checklist comentada**, sem assertions executáveis.
- Edge functions (`mp-webhook`, `create-mp-pix`) — caminho crítico de pagamento PIX — sem nenhum teste (nem Deno test).
- Nenhum runner instalado (sem vitest, jest, testing-library, playwright, pgTAP).

**Recomendações (stack recomendada para este projeto):**
1. **Vitest + @testing-library/react + jsdom** (integra nativamente com Vite; script `test:unit`).
2. **Playwright** para 2–3 fluxos E2E críticos: login, venda PDV, checkout PIX.
3. **pgTAP no banco** (ou promover o smoke SQL existente via `supabase test db`), executado no CI contra banco local (`supabase db start`).
4. **Deno test** para as edge functions (`deno test supabase/functions`).
5. Substitua o script fake: `"test": "vitest run"` e adicione `test:coverage` (meta inicial: lógica de negócio em `src/` ≥ 60%).

---

## 2. CI/CD — 🟠 Alto

**Achados:**
- 5 workflows em [.github/workflows/](../.github/workflows/): `dev.yml`, `staging.yml`, `production.yml` + 2 workflows **descartáveis de auditoria** com trigger em branches efêmeras (`auditoria-final-v2.yml`, `auditoria-visual.yml`).
- Todas as pipelines executam apenas: `checkout` → `npm ci` → `typecheck` → `build`. Ou seja:
  - ❌ **Sem testes** (nem o placeholder é chamado).
  - ❌ **Sem lint** real.
  - ❌ **Sem deploy** (apenas comentários "futuro"), mesmo em `production.yml`.
  - ❌ **Sem validação de migrations Supabase** (comentário "Futuro" no dev.yml).
  - ❌ Sem cache de `node_modules` no `setup-node` (build mais lento).
- `production.yml` depende de `Required reviewers` no GitHub Environment, mas não há deploy configurado — push na `main` não entrega nada.
- Git Flow documentado menciona branch `staging`, mas o workflow de staging tem trigger em `release/*` e PR→`main` — **drift entre doc e CI**.

**Pipeline mínima recomendada (PR → develop/main):**
```yaml
- npm ci
- npm run typecheck        # já existe
- npm run lint             # eslint (ver §3)
- npm run test             # vitest run
- npm run build
- supabase db start && supabase test db   # pgTAP migrations/RLS
```
E um job de deploy real (Vercel/Netlify/S3+CloudFront) em `main` com environment protection. Remova os 2 workflows de auditoria pontuais.

---

## 3. Ferramentas de Qualidade — 🟠 Alto

**Achados:**
- ❌ **Sem ESLint**: nenhum `.eslintrc*` / `eslint.config.*` e eslint não está nas deps. O script `lint` é apenas `tsc --noEmit` (alias de `typecheck`) — **nome enganoso**.
- ❌ **Sem Prettier** (sem config, sem dep) → formatação inconsistente; há mistura de encoding nos arquivos (mojibake visível em workflows/README).
- ⚠️ **TypeScript não está em strict mode**: [tsconfig.json](../tsconfig.json) não tem `"strict": true`, nem `noUncheckedIndexedAccess`, `noImplicitAny` etc. `allowJs: true` sem `checkJs`. Como o CI usa o typecheck como único portão de qualidade, o portão é fraco.
- Alias `@/*` aponta para a **raiz do projeto** (não `src/`) — funciona, mas convencionalmente seria `./src/*`; cuidado ao mover arquivos.

**Recomendações:**
1. Adicionar `eslint` + `typescript-eslint` + `eslint-plugin-react-hooks` (flat config) e `prettier` com `lint-staged` + `simple-git-hooks` (ou CI check).
2. Ativar `"strict": true` incrementalmente (ex.: `strictNullChecks` primeiro).
3. Renomear script `lint` → usar eslint de verdade.

---

## 4. Documentação — 🟡 Médio

**O que existe:**
- [README.md](../README.md) bem escrito: funcionalidades, stack, setup local, Git Flow, governança de migrations e secrets.
- Pasta [docs/](../docs/): AUTH.md, SECURITY.md, auditorias (AUDITORIA.md, BACKEND_AUDIT.md, SECURITY_AUDIT.md) e 7 documentos históricos em `docs/audits/`.

**O que falta / problemas:**
- **Drift README ↔ código:** README cita **Recharts** e **date-fns**, mas o projeto usa **chart.js** (nenhum dos dois está no package.json). Cita CSS puro, mas há Tailwind 4 configurado.
- ❌ Sem **CONTRIBUTING.md** (padrões de código, como rodar testes, convenção de commits).
- ❌ Sem documentação de **como executar os testes SQL** de `supabase/tests/` (eles exigem fixtures e sessão dedicada).
- ❌ Sem **ADR**/docs de arquitetura do fluxo de pagamento PIX (webhook → RPC → idempotência), que é a parte mais crítica do sistema.
- Pasta `docs/audits/` acumulando relatórios datados — considere arquivar (`docs/audits/archive/`) e manter só o estado atual.

---

## 5. Build & Typecheck — 🟡 Médio

**Configuração avaliada (sem execução):**
- [vite.config.ts](../vite.config.ts) simples e correto: `appType: 'spa'`, plugins react + tailwind, alias `@`, HMR condicional. Nada de errado.
- `npm run build` = `vite build` **sem `tsc -b`** — o typecheck roda separado no CI, então erros de tipo não quebram o build local (aceitável, desde que CI obrigue).
- Pontos de atenção no tsconfig que afetam `typecheck`:
  - `allowImportingTsExtensions: true` sem `noEmit`... noEmit está presente ✅
  - `paths` sem `baseUrl` (ok com moduleResolution `bundler` no TS 5.x) ✅
  - Ausência de `strict` é o maior risco: o CI "typecheck" passa com código fracamente tipado.
- ⚠️ `vite` está **duplicado** em `dependencies` e `devDependencies`; `express`, `dotenv` e `@google/genai` são dependências de runtime num app SPA — investigar se são realmente usados no bundle (há `server.js`/`clean` sugerindo resquício de SSR). Dependências ociosas aumentam superfície de supply-chain.
- Encoding: vários arquivos (workflows, README vivo, env examples) estão em não-UTF-8 (mojibake "Ã§") — padronizar UTF-8.

---

## 6. Ambientes & Secrets — 🔴 Crítico

**Achados:**
- ✅ Boa estrutura de exemplos: `env/.env.{development,staging,production}.example` com placeholders (os 3 são iguais, só muda o rótulo).
- ✅ `.gitignore` cobre `.env*` e `env/.env*` com exceção dos examples; **`.env` e `.env.local` NÃO estão versionados** (confirmado via `git ls-files`) ✅.
- 🔴 **`.env` e `.env.local` contêm a ANON KEY real** do projeto `ndrjynlbwrugakjqtzwy`. Não é secret grave (anon key é pública por design, protegida por RLS), mas: o README admite não saber se esse projeto é DEV ou PRODUÇÃO — **risco operacional de rodar dev/testes contra dados de produção**. Sem SERVICE_ROLE key exposta (bom).
- 🟠 `vite.config.ts` tem `envDir: '.'` — a pasta `env/` **não é usada em runtime**; empilha-se `.env.local` → `.env`. A duplicação `VITE_*` e `NEXT_PUBLIC_*` (herança Next.js) é ruído — Supabase no Vite só lê `VITE_*`.
- 🟠 CI usa um único par de secrets (`VITE_SUPABASE_URL/ANON_KEY`) para dev/staging/production workflows — não distingue ambientes; use **GitHub Environment secrets** por ambiente.

**Recomendações:**
1. Definir formalmente `ndrjynlbwrugakjqtzwy` (dev ou prod) e criar os projetos separados conforme README.
2. Secrets por GitHub Environment (dev/staging/production) e passar env correto em cada workflow.
3. Remover variáveis `NEXT_PUBLIC_*` ou documentar o porquê.
4. Adicionar scan de secrets no CI (`gitleaks` ou `trufflehog`) — barato e preventivo.

---

## Resumo de Severidades

| # | Área | Severidade | Ação-chave |
|---|------|-----------|------------|
| 1 | Testes inexistentes (front + pagamentos) | 🔴 Crítico | Vitest + Testing Library + Playwright + pgTAP |
| 6 | Ambiguidade PROD/DEV do projeto Supabase em uso | 🔴 Crítico | Classificar projeto e segregar ambientes |
| 2 | CI sem testes/lint/deploy | 🟠 Alto | Pipeline mínima (§2) + deploy real |
| 3 | Sem ESLint/Prettier, TS sem strict | 🟠 Alto | typescript-eslint + strict incremental |
| 4 | Drift README (Recharts/date-fns/CSS) e falta de CONTRIBUTING | 🟡 Médio | Corrigir docs, arquivar auditorias antigas |
| 5 | Deps ociosas/duplicadas, encoding misto | 🟡 Médio | Limpeza do package.json, UTF-8 |

**Ponto positivo:** governança de banco madura (migrations versionadas, hardening RLS documentado, smoke test SQL transacional) — a base existe, falta ligar tudo em automação.
