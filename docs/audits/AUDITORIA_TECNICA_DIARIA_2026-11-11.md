# Auditoria Técnica Diária — CoreSys (2026-11-11)

**Repositório:** FlavioProgramador/projeto-loja-multimarcas
**Auditor:** Engenharia de Software Sênior (Auditoria Técnica Especializada CoreSys)
**Data:** 11 de Novembro de 2026
**Diretriz Operacional:** Análise aprofundada de segurança, isolamento multi-tenant, consistência do banco de dados e integridade do código. Em cumprimento rigoroso às diretrizes de auditoria, **nenhuma alteração automática foi aplicada ao código ou ao schema do banco nesta etapa**.

---

## 1. Sumário Executivo

A auditoria técnica diária de 11 de Novembro de 2026 compreendeu uma varredura completa da base de código frontend React (TypeScript/Vite), da infraestrutura Supabase (PostgreSQL, Row Level Security, Triggers e RPCs PL/pgSQL) e das dependências do ecossistema.

O CoreSys demonstra maturidade crescente com o uso de transações com lock consultivo (`pg_advisory_xact_lock`), idempotência de vendas via `sale_idempotency` e segregação de dados por `store_id`. Contudo, permanecem vulnerabilidades latentes e inconformidades arquiteturais que afetam a integridade do estoque, o controle de acesso e a segurança da aplicação:

1. **Inconsistência Transacional no Rollback de Vendas PIX (Estoque Fantasma):** Ao criar uma venda PIX pendente (`create_mp_pix_sale`), a aplicação decrementa `store_inventory.quantity` e incrementa `product_variants.reserved_quantity`. Porém, a rotina de cancelamento (`cancel_mp_pix_sale`) apenas incrementa `store_inventory.quantity`, omitindo a redução de `product_variants.reserved_quantity` e a sincronização de `product_variants.stock_quantity`. Esse desvio gera inconsistência crônica de saldo de estoque.
2. **Potencial Search Path Hijacking em Trigger `SECURITY DEFINER`:** O trigger `protect_profile_role()` roda com privilégios de superusuário (`SECURITY DEFINER`) mas não declara `SET search_path = public`, abrindo brecha para execução de código arbitrário via schemas temporários/mutáveis.
3. **Ausência de Fail-Closed em Verificações de Role nas RPCs de Privacidade/LGPD:** Nas funções `export_customer_personal_data`, `create_privacy_request` e `resolve_privacy_request`, a validação de papel utiliza `IF v_role NOT IN ('ADMIN', 'MANAGER')`. Caso `v_role` seja `NULL`, a expressão SQL avalia para `NULL` (e não `TRUE`), quebrando o princípio de fechamento por padrão (fail-closed).
4. **Ausência de Segregação Multi-Tenant em Cadastros Globais (`suppliers`, `brands`, `categories`):** As entidades de fornecedores, marcas e categorias não possuem vínculo obrigatório com `store_id`, permitindo que operadores de uma loja visualizem e alterem dados comerciais pertencentes a outras organizações no mesmo banco.
5. **Bypass de Permissões e Escrita Direta em `products` via Frontend:** No método `InventoryService.registerStockEntry`, quando um produto não existe, o frontend executa `insert` direto em `products` preenchendo a coluna `cost_price`. Essa prática contorna a RPC oficial `manage_product` e os privilégios restritos aplicados na migração de segurança.
6. **Risco de BOLA/IDOR em Despesas Fixas (`FinanceService.toggleExpensePaid`):** A alteração do status de pagamento de uma despesa fixa filtra apenas por `id` UUID sem validar o `store_id` ativo da loja atual, possibilitando mutação indevida caso um usuário tenha acesso a múltiplas lojas.
7. **Vulnerabilidades Conhecidas em Dependências:** O scanner `npm audit --audit-level=moderate` acusa 19 vulnerabilidades (1 crítica em `dompurify`, 4 altas em `vite`, `zod`, `body-parser`, `undici`, e 14 moderadas).
8. **Problemas de Performance e Concorrência Frontend:** Falta de índices secundários cobrindo foreign keys como `user_store_access(store_id)` e `automation_runs(rule_id)`, além de ausência de `useCallback` e proteção atômica contra duplo clique no fluxo de finalização de venda do PDV (`handleConfirmSale`).

---

## 2. Matriz Consolidada de Riscos e Achados

| ID | Severidade | Categoria | Descrição do Problema | Objeto / Arquivo Afetado |
| :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | 🔴 **CRÍTICO** | Integridade / Transacional | `cancel_mp_pix_sale` não reverte `product_variants.reserved_quantity`, retendo reservas fantasmas | RPC `public.cancel_mp_pix_sale(uuid)` (`supabase/migrations/20260828000003_multi_store.sql`) |
| **SEC-02** | 🟠 **ALTO** | Segurança / SQL Injection | Trigger `SECURITY DEFINER` `protect_profile_role` sem `SET search_path = public` | Trigger `public.protect_profile_role()` (`20260828000001_hardening_rls.sql`) |
| **SEC-03** | 🟠 **ALTO** | Segurança / Auth / RLS | Role checks sem fail-closed (`v_role IS NULL`) em RPCs de dados pessoais e LGPD | RPCs `export_customer_personal_data`, `create_privacy_request`, `resolve_privacy_request` |
| **SEC-04** | 🟠 **ALTO** | Multi-Tenancy / IDOR | Falta de segregação por `store_id` em `suppliers`, `brands` e `categories` | Tabelas `suppliers`, `brands`, `categories` e seus serviços |
| **SEC-05** | 🟠 **ALTO** | RLS / Integridade de Dados | `InventoryService.registerStockEntry` insere direto em `products` contornando `manage_product` | `src/services/inventory.service.ts` |
| **SEC-06** | 🟠 **ALTO** | Supply Chain / Deps | Dependências com vulnerabilidades críticas e altas (`dompurify`, `vite`, `zod`, `body-parser`) | `package.json`, `package-lock.json` |
| **SEC-07** | 🟡 **MÉDIO** | BOLA / IDOR | `FinanceService.toggleExpensePaid` altera status de despesa sem validar `store_id` ativo | `src/services/finance.service.ts` (`public.fixed_expenses`) |
| **PERF-01**| 🟡 **MÉDIO** | Performance / Banco | Ausência de índices em chaves estrangeiras (`user_store_access.store_id`, `automation_runs.rule_id`) | Tabelas `user_store_access`, `automation_runs` |
| **CODE-01**| 🟡 **MÉDIO** | Concorrência / Frontend | Ausência de `useCallback` e proteção contra duplo clique no handler `handleConfirmSale` do PDV | `src/components/pdv/PdvView.tsx` |
| **ARCH-01**| 🟢 **BAIXO** | Código Morto / Arquitetura | `DashboardService.getMetrics` não utilizado, sem filtro de tenant e com cálculo pesado em memória | `src/services/dashboard.service.ts` |
| **LINT-01**| 🟢 **BAIXO** | Higiene de Código | 26 avisos do ESLint referentes a variáveis não utilizadas e dependências ausentes de hooks | Módulos PDV, Dashboard, Inventory, Returns, Suppliers |

---

## 3. Detalhamento Técnico dos Problemas

---

### 🔴 SEC-01: Inconsistência Transacional no Rollback de Estoque PIX (`cancel_mp_pix_sale`)
- **Severidade:** 🔴 **CRÍTICO**
- **Categoria:** Integridade de Dados / Transações do Banco
- **Função Afetada:** `public.cancel_mp_pix_sale(p_sale_id UUID)`
- **Arquivos:** `supabase/migrations/20260828000003_multi_store.sql` (linhas 893–995) e `supabase/setup.sql`
- **Explicação Técnica:**
  No fluxo de venda PIX Mercado Pago (`create_mp_pix_sale`), a reserva do item executa:
  ```sql
  UPDATE public.store_inventory
  SET quantity = quantity - v_item.quantity
  WHERE store_id = p_store_id AND product_variant_id = v_item.variant_id;

  UPDATE public.product_variants pv
  SET reserved_quantity = COALESCE(reserved_quantity, 0) + v_item.quantity,
      stock_quantity = (SELECT COALESCE(sum(si.quantity), 0)
                        FROM public.store_inventory si
                        WHERE si.product_variant_id = pv.id)
  WHERE pv.id = v_item.variant_id;
  ```
  Contudo, quando a venda PIX expira, é recusada ou cancelada pelo operador via `cancel_mp_pix_sale`, o loop de restauração apenas realiza:
  ```sql
  UPDATE public.store_inventory
  SET quantity = quantity + v_item.quantity
  WHERE store_id = v_sale.store_id
    AND product_variant_id = v_item.product_variant_id;
  ```
  O campo `product_variants.reserved_quantity` **não é decrementado** e `product_variants.stock_quantity` não é recalculado. Como resultado:
  1. A quantidade reservada permanece inflacionada indefinidamente ("reserva fantasma").
  2. Consultas que subtraem `stock_quantity - reserved_quantity` passam a considerar o produto esgotado, impedindo novas vendas legítimas.
  3. Relatórios gerenciais e conciliação de inventário físico acusam discrepância contínua entre o estoque das lojas e a tabela agregada de variantes.
- **Sugestão de Correção:**
  Atualizar o loop de cancelamento na RPC `cancel_mp_pix_sale` para ajustar atomicamente a variante do produto:
  ```sql
  UPDATE public.product_variants pv
  SET reserved_quantity = GREATEST(0, COALESCE(pv.reserved_quantity, 0) - v_item.quantity),
      stock_quantity = (
        SELECT COALESCE(sum(si.quantity), 0)
        FROM public.store_inventory si
        WHERE si.product_variant_id = pv.id
      )
  WHERE pv.id = v_item.product_variant_id;
  ```

---

### 🟠 SEC-02: Função `SECURITY DEFINER` sem `search_path` Fixo (`protect_profile_role`)
- **Severidade:** 🟠 **ALTO**
- **Categoria:** Segurança / Elevação de Privilégios / Search Path Hijacking
- **Função Afetada:** `public.protect_profile_role()`
- **Arquivo:** `supabase/migrations/20260828000001_hardening_rls.sql` (linhas 19–32)
- **Explicação Técnica:**
  A função de gatilho `protect_profile_role()` foi declarada com `SECURITY DEFINER`, mas sem definir explicitamente a cláusula `SET search_path = public`:
  ```sql
  CREATE OR REPLACE FUNCTION public.protect_profile_role()
  RETURNS TRIGGER AS $$
  BEGIN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      IF public.current_user_role() != 'ADMIN' THEN
        RAISE EXCEPTION 'Acesso negado: Apenas administradores podem alterar papéis (roles).';
      END IF;
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER;
  ```
  De acordo com as diretrizes do PostgreSQL e do Supabase Security Advisor, qualquer função `SECURITY DEFINER` sem `search_path` fixo é vulnerável ao sequestro da resolução de nomes caso um operador consiga criar tabelas ou funções em schemas mutáveis (como `pg_temp`), podendo executar código arbitrário com as permissões do proprietário da função (`postgres`).
- **Sugestão de Correção:**
  Aplicar comando DDL para fixar o `search_path`:
  ```sql
  ALTER FUNCTION public.protect_profile_role() SET search_path = public;
  ```

---

### 🟠 SEC-03: Falta de Fail-Closed em Verificações de Role nas RPCs de LGPD/Privacidade
- **Severidade:** 🟠 **ALTO**
- **Categoria:** Autenticação / Autorização / RLS Fail-Closed
- **Funções Afetadas:**
  - `public.export_customer_personal_data(uuid, uuid)`
  - `public.create_privacy_request(uuid, uuid, text, text)`
  - `public.resolve_privacy_request(uuid, uuid, text, text)`
- **Arquivos:**
  - `supabase/migrations/20261001150554_add_customer_personal_data_export.sql`
  - `supabase/migrations/20261001150645_add_privacy_request_workflow.sql`
  - `supabase/migrations/20261001150659_add_privacy_request_resolution.sql`
- **Explicação Técnica:**
  Essas RPCs executam a verificação de autorização da seguinte forma:
  ```sql
  v_role := public.get_user_store_role(p_store_id);
  if v_role not in ('ADMIN', 'MANAGER') then
    raise exception 'personal data export requires ADMIN or MANAGER role';
  end if;
  ```
  Na lógica trivalente do SQL, se `v_role` for `NULL`, a expressão `NULL NOT IN ('ADMIN', 'MANAGER')` resulta em `NULL`. Em condicionais onde haja negações ou inversões lógicas, essa condição pode falhar silenciosamente sem disparar a exceção de bloqueio. O padrão de segurança adotado nas migrações mais recentes do CoreSys exige verificação explícita de `NULL` para ser estritamente fail-closed.
- **Sugestão de Correção:**
  Alterar a validação em todas as funções para o padrão unificado do CoreSys:
  ```sql
  v_role := public.get_user_store_role(p_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN', 'MANAGER') THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores ou gerentes desta loja.';
  END IF;
  ```

---

### 🟠 SEC-04: Falta de Segregação por `store_id` em Cadastros Globais
- **Severidade:** 🟠 **ALTO**
- **Categoria:** Isolamento Multi-Tenant / Confidencialidade
- **Tabelas Afetadas:** `public.suppliers`, `public.brands`, `public.categories`
- **Serviços Afetados:** `src/services/suppliers.service.ts`, `src/services/brands.service.ts`, `src/services/categories.service.ts`
- **Explicação Técnica:**
  As tabelas `suppliers`, `brands` e `categories` foram projetadas originalmente sem a coluna `store_id`. Em uma arquitetura SaaS multi-inquilino onde múltiplas empresas compartilham a mesma instância do banco, gerentes de uma loja conseguem listar, cadastrar, editar e excluir fornecedores, acordos de preço e categorias de marcas pertencentes a outras lojas concorrentes.
- **Sugestão de Correção:**
  1. Adicionar `store_id UUID REFERENCES public.stores(id)` ou uma flag `is_global BOOLEAN DEFAULT false` nestas entidades.
  2. Implementar políticas RLS garantindo que usuários só visualizem itens vinculados às lojas onde possuem autorização ativa (`store_id = current_store` ou `is_global = true`).
  3. Atualizar os serviços frontend para incluir o filtro de contexto `storeId`.

---

### 🟠 SEC-05: Inserção Direta em `products` Contornando `manage_product`
- **Severidade:** 🟠 **ALTO**
- **Categoria:** Integridade de Catálogo / Bypass de RLS
- **Arquivo Afetado:** `src/services/inventory.service.ts` (linhas 130–150)
- **Tabelas Afetadas:** `public.products`, `public.product_variants`
- **Explicação Técnica:**
  No fluxo de entrada de estoque com produto novo (`registerStockEntry`), o serviço insere o produto diretamente via cliente Supabase:
  ```typescript
  const { data: newProd, error: prodErr } = await supabase
    .from('products')
    .insert({
      name: params.productName.trim(),
      brand_id: brandId,
      category_id: categoryId,
      sale_price: Math.max(0, Number(params.price) || 0),
      cost_price: custoUnitario,
      is_active: true
    })
    .select()
    .single();
  ```
  Nas migrações de integridade do CoreSys (`20260930010321` e `20260930024000`), a escrita direta da coluna sensível `cost_price` foi revogada para o perfil `authenticated`, tornando a RPC `manage_product` o ponto de entrada transacional obrigatório. Além disso, a inserção não transacional no frontend cria risco de produtos órfãos caso a etapa seguinte (criação da variante ou da entrada de estoque) falhe.
- **Sugestão de Correção:**
  Substituir o `insert` manual por chamada à RPC `manage_product` ou ao método `ProductsService.create`.

---

### 🟠 SEC-06: Vulnerabilidades Conhecidas em Dependências do Projeto
- **Severidade:** 🟠 **ALTO**
- **Categoria:** Segurança da Cadeia de Suprimentos (Supply Chain)
- **Arquivos Afetados:** `package.json`, `package-lock.json`
- **Explicação Técnica:**
  A execução da checagem de segurança `npm run security:dependencies` (`npm audit --audit-level=moderate`) aponta 19 vulnerabilidades no grafo de pacotes:
  - 1 Crítica: `dompurify` (bypasses em templates aninhados e shadow roots).
  - 4 Altas: `vite`, `zod`, `body-parser`, `undici`.
  - 14 Moderadas: `minimatch`, `qs`, `@vitest/mocker`.
- **Sugestão de Correção:**
  Atualizar os pacotes diretos no `package.json` (`dompurify`, `vite`, `zod`) e utilizar o mecanismo de `overrides` do npm para sanar dependências transitivas (`minimatch: ^11.0.4`, `body-parser`, `undici`), executando `npm ci` para validação em CI.

---

### 🟡 SEC-07: Risco de BOLA/IDOR em `FinanceService.toggleExpensePaid`
- **Severidade:** 🟡 **MÉDIO**
- **Categoria:** Broken Object Level Authorization (BOLA)
- **Arquivo Afetado:** `src/services/finance.service.ts` (linhas 274–283)
- **Tabela:** `public.fixed_expenses`
- **Explicação Técnica:**
  O método atualiza o status de quitação de uma despesa fixa filtrando unicamente pelo `id` da entidade:
  ```typescript
  const { data, error } = await supabase
    .from('fixed_expenses')
    .update({ paid: !currentPaidState })
    .eq('id', uuid)
    .select(...)
    .single();
  ```
  Se um usuário tiver acesso a duas ou mais lojas na plataforma, ele pode acidentalmente ou maliciosamente alterar despesas de uma loja com a qual não está operando na interface atual, pois a query não vincula a mutação ao `store_id` selecionado.
- **Sugestão de Correção:**
  Tornar o parâmetro `storeId: string` obrigatório e adicionar `.eq('store_id', storeId)` na query de atualização.

---

### 🟡 PERF-01: Chaves Estrangeiras Sem Índices Secundários Cobrindo Junções
- **Severidade:** 🟡 **MÉDIO**
- **Categoria:** Performance e Escalabilidade do Banco
- **Tabelas Afetadas:** `user_store_access(store_id)`, `automation_runs(rule_id)`, `physical_inventories(store_id)`
- **Explicação Técnica:**
  Em cenários com Row Level Security intenso (onde `has_store_access` e `get_user_store_role` são avaliados a cada query), foreign keys sem índices B-tree dedicados forçam sequential scans nas tabelas referenciadas durante junções e verificações de integridade referencial, gerando locks indesejados e latência sob concorrência.
- **Sugestão de Correção:**
  Criar índices explícitos:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_user_store_access_store_id ON public.user_store_access(store_id);
  CREATE INDEX IF NOT EXISTS idx_automation_runs_rule_id ON public.automation_runs(rule_id);
  ```

---

### 🟡 CODE-01: Ausência de `useCallback` e Bloqueio de Concorrência no PDV
- **Severidade:** 🟡 **MÉDIO**
- **Categoria:** Resiliência e Concorrência Frontend
- **Arquivo Afetado:** `src/components/pdv/PdvView.tsx` (linha 235)
- **Explicação Técnica:**
  A função `handleConfirmSale` é instanciada novamente a cada renderização e está acoplada a atalhos de teclado globais (F2, Enter). A ausência de memorização via `useCallback` e de uma flag de trava atômica de submissão (`isSubmitting`) possibilita que cliques múltiplos ou repetições de tecla disparem requisições simultâneas contra o Supabase antes da resposta da RPC.
- **Sugestão de Correção:**
  Envolver a função em `useCallback` e travar a execução enquanto a confirmação da venda estiver em trânsito.

---

### 🟢 ARCH-01: Código Morto em `DashboardService.getMetrics`
- **Severidade:** 🟢 **BAIXO**
- **Categoria:** Arquitetura / Limpeza de Código
- **Arquivo Afetado:** `src/services/dashboard.service.ts`
- **Explicação Técnica:**
  O serviço `DashboardService` calcula métricas através de varredura completa da tabela `sales` diretamente em memória JavaScript, sem paginação e sem filtro de tenant. No momento, o `DashboardView` consome métricas locais do `StoreContext`. Manter esse serviço exposto traz riscos de consumo indevido de banda e memória caso seja invocado.
- **Sugestão de Correção:**
  Remover o código inoperante ou refatorar o serviço para consumir a RPC agregada `report_commercial_summary`.

---

### 🟢 LINT-01: Avisos do Linter (Imports Não Utilizados e Dependências de Hooks)
- **Severidade:** 🟢 **BAIXO**
- **Categoria:** Higiene e Qualidade de Código
- **Arquivos Afetados:** `DashboardView.tsx`, `InventoryView.tsx`, `NewProductModal.tsx`, `PdvView.tsx`, `SupplierForm.tsx`, Contextos
- **Explicação Técnica:**
  O comando `npm run lint` reporta 26 warnings de variáveis importadas e não utilizadas (`CreditCard`, `ChevronDown`, `Trash2`, `formatPhone`), além de alertas de dependências não declaradas no array de `useEffect`.
- **Sugestão de Correção:**
  Remover variáveis inativas e declarar adequadamente as dependências dos hooks React.

---

## 4. Plano de Ação Recomendado (Próximos Passos)

Em conformidade com a política de governança técnica do CoreSys de **selecionar apenas uma melhoria pequena, de alto impacto e segura por Pull Request**, define-se a seguinte ordem de prioridade para as próximas execuções:

1. **Sprint Imediata (P0 — Integridade & Confiabilidade do Estoque):**
   - **Ticket 1:** Corrigir a RPC `cancel_mp_pix_sale` para decrementar atomicamente `reserved_quantity` e recalcular `product_variants.stock_quantity`.
   - **Ticket 2:** Adicionar `SET search_path = public` ao trigger `protect_profile_role()`.
   - **Ticket 3:** Corrigir a validação fail-closed (`v_role IS NULL OR ...`) nas RPCs de LGPD/privacidade.
2. **Sprint Curto Prazo (P1 — Segurança & Isolamento Multi-Tenant):**
   - **Ticket 4:** Adicionar `store_id` obrigatório em `FinanceService.toggleExpensePaid`.
   - **Ticket 5:** Refatorar `InventoryService.registerStockEntry` para usar `manage_product`.
   - **Ticket 6:** Atualizar dependências vulneráveis no `package.json` mantendo compatibilidade com o CI.
3. **Sprint Médio Prazo (P2 — Performance & Higiene de Código):**
   - **Ticket 7:** Adicionar índices nas foreign keys de `user_store_access` e `automation_runs`.
   - **Ticket 8:** Otimizar atalhos e reentrância no PDV com `useCallback` e sanar warnings do ESLint.

---
*Relatório de auditoria técnica diária gerado, verificado e arquivado em conformidade com as políticas operacionais do CoreSys.*
