# Relatório de Auditoria Técnica e de Segurança Diária — CoreSys (2026-10-27)

**Data da Auditoria:** 27 de Outubro de 2026
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Escopo:** Auditoria diária de Segurança, RLS, Arquitetura Multi-tenant, Supabase Auth, RPCs `SECURITY DEFINER`, Validação Frontend/Backend e Performance.
**Auditor Responsável:** Engenheiro de Software Sênior (Jules)

---

## 1. Resumo Executivo / Status Geral da Auditoria

Após uma análise profunda do repositório, das migrações SQL mais recentes (até `20261003000000_coresys_audit_final_remediation.sql`), dos serviços frontend, das políticas de Row-Level Security (RLS) e da suíte de verificação integrada (`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`), o estado do CoreSys apresenta um **nível elevado de maturidade e endurecimento em segurança (hardening)**.

As últimas remediações aplicadas corrigiram falhas históricas de RLS, garantiram `search_path = public` em todas as funções `SECURITY DEFINER`, e aplicaram checagens de role *fail-closed* contra retornos `NULL`.

Contudo, a auditoria diária identificou **oportunidades de melhoria contínua, discrepâncias sutis de UX/UI/DX e pontos de atenção arquiteturais** que devem ser monitorados e corrigidos para garantir resiliência total a longo prazo.

---

## 2. Matriz Sintética de Problemas por Severidade

| ID | Severidade | Categoria | Descrição Curta | Afetados |
| :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | **ALTO** | Supabase Auth / Hardening | Advisories de Plataforma: Proteção contra senhas vazadas desabilitada e extensão `unaccent` em `public`. | Supabase Auth Config / Schema `public` |
| **BUG-01** | **MÉDIO** | Backend / Legado | 18 registros de movimentação de estoque legados possuem `store_id = NULL` e dependem de bypass de trigger/RLS admin. | Tabela `inventory_movements` |
| **QA-01** | **MÉDIO** | Lint / DX | 26 warnings de ESLint por variáveis não utilizadas e dependências ausentes em React Hooks. | Diversos componentes UI (`DashboardView`, `PdvView`, `ReturnsView`, etc.) |
| **PERF-01**| **BAIXO** | Performance Build | Bundle de produção gerando warning com chunks superiores a 500kB (`ReportsView` com ~412kB gzipped). | `vite.config.ts`, `ReportsView.tsx` |
| **SEC-02** | **BAIXO** | Frontend / Resiliência | Ausência de limite de taxa (rate limiting) local ou debounce em submissões consecutivas de buscas. | `src/services/customers.service.ts` |

---

## 3. Detalhamento dos Achados de Auditoria

### 3.1. Achados de Segurança (Security, Auth & RLS)

#### SEC-01: Advisories de Plataforma Supabase (Proteção Auth & Schema `public`)
- **Severidade:** **ALTO**
- **Explicação:** Embora a lógica no banco de dados tenha sido adequadamente blindada contra SQL Injection e bypass de tenant via RLS e `SECURITY DEFINER`, os advisories da plataforma Supabase indicam duas pendências de infraestrutura:
  1. Proteção contra senhas vazadas (HaveIBeenPwned integration no Auth) permanece desabilitada na configuração do projeto Supabase.
  2. A extensão `unaccent` permanece instalada no schema `public` em vez de um schema reservado como `extensions`.
- **Objetos Afetados:** Configuração do Supabase Auth e schema `public.unaccent`.
- **Sugestão de Correção:**
  1. Habilitar a verificação de senhas vazadas no painel do Supabase Dashboard (Auth -> Security Settings -> Leak Password Protection).
  2. Criar uma migração para mover a extensão `unaccent` para o schema `extensions`:
     ```sql
     CREATE SCHEMA IF NOT EXISTS extensions;
     ALTER EXTENSION unaccent SET SCHEMA extensions;
     ```

---

### 3.2. Achados do Banco de Dados & Arquitetura Multi-Tenant

#### BUG-01: Registros Históricos de Movimentação com `store_id = NULL`
- **Severidade:** **MÉDIO**
- **Explicação:** Existem 18 linhas legadas na tabela `inventory_movements` criadas antes da implementação estrita do modelo multi-loja, onde `store_id IS NULL`. Por conta da imutabilidade estrita garantida pelo trigger de auditoria de estoque, atualizações diretas retroativas são bloqueadas pelo banco. Apenas administradores conseguem visualizar essas movimentações históricas.
- **Objetos Afetados:** Tabela `public.inventory_movements`.
- **Sugestão de Correção:** Manter o comportamento atual sem adulterar o histórico auditável (as novas vendas e movimentações já gravam `store_id` obrigatoriamente). Se necessário no futuro, executar um script administrativo idempotente que desative temporariamente a restrição de alteração de auditoria em ambiente de manutenção controlada para atribuir a loja default (`00000000-0000-0000-0000-000000000001`).

---

### 3.3. Achados de Qualidade de Código & Frontend (Lint, React & UX)

#### QA-01: Warnings de Linting e React Hooks (26 Advertências)
- **Severidade:** **MÉDIO**
- **Explicação:** A suíte `npm run lint` passa com sucesso por estar abaixo do limite máximo (`--max-warnings=50`), porém exibe 26 avisos referentes a importações/variáveis não utilizadas e dependências ausentes no array do `useEffect`. Exemplos:
  - `PdvView.tsx`: `handleConfirmSale` recria dependências em renderizações sucessivas.
  - `FinanceView.tsx`: dependências ausentes `loadTransactions` e `loadExpenses`.
  - Importações de ícones de Lucide sem uso em `InventoryView.tsx`, `NewReturnModal.tsx` e `DashboardView.tsx`.
- **Objetos Afetados:** `src/components/dashboard/DashboardView.tsx`, `src/components/pdv/PdvView.tsx`, `src/components/finance/FinanceView.tsx`, `src/components/inventory/InventoryView.tsx`, `src/components/returns/NewReturnModal.tsx`.
- **Sugestão de Correção:**
  1. Envolver funções assíncronas chamadas dentro de `useEffect` com `useCallback` ou declará-las no escopo interno do hook.
  2. Remover importações e constantes não utilizadas ou renomeá-las com prefixo `_` conforme regras do ESLint.

---

### 3.4. Achados de Performance & Build

#### PERF-01: Tamanho do Bundle JavaScript de Produção
- **Severidade:** **BAIXO**
- **Explicação:** Ao executar `npm run build`, o Vite emite uma advertência sobre chunks JavaScript que excedem 500 kB após minificação:
  - `dist/assets/ReportsView-CWXUbRIP.js`: ~412 kB gzipped (maior que 500 kB descompactado).
  - `dist/assets/index-BeWIja4o.js`: ~526 kB minificado.
- **Objetos Afetados:** `vite.config.ts`, `src/components/reports/ReportsView.tsx`.
- **Sugestão de Correção:**
  1. Configurar `manualChunks` no `vite.config.ts` para separar bibliotecas volumosas como `html2canvas` e bibliotecas de relatórios PDF.
  2. Utilizar `lazy()` e `Suspense` do React para importação sob demanda dos módulos pesados de relatórios.

---

### 3.5. Achados de Resiliência & IDOR/BOLA

#### SEC-02: Proteção IDOR/BOLA e Sanitização no Frontend/Backend
- **Severidade:** **BAIXO**
- **Explicação:** Todas as chamadas de API/RPC em `src/services/` já transmitem explicitamente o `store_id` ativo da sessão. As políticas de Row Level Security (RLS) no Supabase validam o pertencimento à loja via `get_user_store_role(store_id)` com fallback *fail-closed* contra `NULL`. Não foram identificadas brechas ativas de IDOR/BOLA na versão corrente.
- **Objetos Afetados:** `src/services/sales.service.ts`, `src/services/customers.service.ts`, `src/services/products.service.ts`.
- **Sugestão de Correção:** Manter a diretriz de design atual, garantindo que novos endpoints ou RPCs continuem exigindo validação de permissão no backend Supabase e nunca dependam exclusivamente do frontend.

---

## 4. Plano de Ação Recomendado (Próximos Passos)

1. **Sprint de Limpeza de Warnings (QA):**
   - Corrigir os 26 avisos de linting no frontend para atingir 0 warnings em `npm run lint`.
2. **Otimização de Build (Vite/Rollup):**
   - Ajustar a divisão de código (*code splitting*) em `vite.config.ts` para otimizar os tempos de carregamento do PDV e módulo de relatórios.
3. **Hardening de Configurações Supabase (Infraestrutura):**
   - Habilitar no Supabase Dashboard a proteção contra senhas vazadas (Pwned Passwords).
   - Mover a extensão `unaccent` para o schema `extensions`.

---

## 5. Conclusão da Auditoria Diária

O sistema **CoreSys** encontra-se seguro, funcionalmente estável, com isolamento multi-tenant ativo e validado, e sem vulnerabilidades críticas ou bloqueantes no código-fonte atual.
