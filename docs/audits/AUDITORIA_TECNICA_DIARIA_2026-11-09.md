# Auditoria Técnica Diária — CoreSys (2026-11-09)

**Repositório:** FlavioProgramador/projeto-loja-multimarcas
**Auditor:** Engenharia de Software Sênior (Auditoria Técnica Especializada CoreSys)
**Data:** 09 de Novembro de 2026
**Diretriz Operacional:** Análise aprofundada de segurança, isolamento multi-tenant, consistência do banco de dados e qualidade de código. Em total conformidade com as orientações, **nenhuma alteração automática destrutiva foi feita no código de produção ou no schema do banco** durante esta etapa de auditoria.

---

## 1. Sumário Executivo

A auditoria técnica diária de 09 de Novembro de 2026 analisou a base de código do frontend React (TypeScript/Vite), a infraestrutura do Supabase (PostgreSQL, Row Level Security, Triggers e RPCs PL/pgSQL) e o ciclo de integrações externas.

Observa-se um avanço contínuo na arquitetura do CoreSys, especialmente na implementação de travamento transacional (`pg_advisory_xact_lock`), idempotência e suporte a multi-loja. Contudo, foram mapeadas vulnerabilidades e inconsistências estruturais que representam riscos à integridade de dados e à segurança multi-tenant:

1. **Inconsistência Transacional no Rollback de Estoque PIX (Desvio de `reserved_quantity`):** Ao criar uma venda PIX pendente (`create_mp_pix_sale`), o estoque da loja (`store_inventory`) é decrementado e `product_variants.reserved_quantity` é incrementado. Todavia, a RPC de cancelamento de PIX pendente (`cancel_mp_pix_sale`) apenas restaura `store_inventory.quantity`, deixando o campo `reserved_quantity` intacto e sem atualizar `product_variants.stock_quantity`. Isso gera "reservas fantasmas" que distorcem o saldo real de estoque do produto.
2. **Search Path Hijacking em Trigger `SECURITY DEFINER`:** A função `protect_profile_role()`, executada em contexto `SECURITY DEFINER` com privilégios de superusuário, não define `SET search_path = public`, abrindo margem para sequestro de caminho de busca via schemas voláteis ou temporários.
3. **Fragilidade Fail-Closed em Verificações de Role nas RPCs de Privacidade/LGPD:** Nas funções de exportação de dados e requisições LGPD (`export_customer_personal_data`, `create_privacy_request`, `resolve_privacy_request`), a verificação de autorização utiliza o padrão `if v_role not in ('ADMIN', 'MANAGER')`. Em PostgreSQL, se `v_role` for `NULL`, a expressão avalia para `NULL` (não `TRUE`), gerando inconsistência nas regras de bloqueio.
4. **Ausência de Isolamento Multi-Tenant em Cadastros Globais (`suppliers`, `brands`, `categories`):** Os serviços e tabelas de fornecedores, marcas e categorias não possuem a chave `store_id` e suas políticas RLS permitem que qualquer usuário autenticado com perfil gerencial visualize e manipule dados de parceiros comerciais pertencentes a outras lojas da rede.
5. **Bypass de Permissões e Inserção Direta no Catálogo em `InventoryService`:** Em `InventoryService.registerStockEntry`, ao dar entrada em um novo produto, o frontend executa `insert` direto em `products` preenchendo `cost_price`. Essa prática contorna a RPC `manage_product` e a revogação de privilégios da coluna `cost_price` estabelecida no hardening do banco.
6. **Risco de BOLA/IDOR em Despesas Fixas:** O método `FinanceService.toggleExpensePaid` recebe apenas o `id` da despesa e não vincula a mutação ao `store_id` da loja ativa.
7. **Vulnerabilidades Conhecidas em Dependências:** O scanner de segurança (`npm audit --audit-level=moderate`) acusa 19 vulnerabilidades (1 crítica em `dompurify`, 4 altas em `vite`, `zod`, `body-parser`, `undici`).
8. **Código Morto e Alertas do Linter:** O serviço `DashboardService` realiza agregações diretas na tabela `sales` sem paginação e sem filtro de loja, além de não ser consumido pela UI. O linter reporta 26 warnings de código não utilizado e dependências de hooks.

---

## 2. Matriz Resumo de Vulnerabilidades e Achados

| ID | Severidade | Categoria | Descrição do Problema | Componente / Arquivo / Objeto Afetado |
| :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | 🔴 **CRÍTICO** | Integridade / Transações | `cancel_mp_pix_sale` não reverte `product_variants.reserved_quantity`, gerando estoque fantasma | RPC `public.cancel_mp_pix_sale(uuid)` (`supabase/migrations/20260828000003_multi_store.sql`) |
| **SEC-02** | 🟠 **ALTO** | Segurança / SQL Injection | Trigger `SECURITY DEFINER` `protect_profile_role` sem `SET search_path = public` | Trigger `public.protect_profile_role()` (`20260828000001_hardening_rls.sql`) |
| **SEC-03** | 🟠 **ALTO** | Segurança / Auth / RLS | Role checks sem fail-closed (`v_role IS NULL`) em RPCs de privacidade e LGPD | RPCs `export_customer_personal_data`, `create_privacy_request`, `resolve_privacy_request` |
| **SEC-04** | 🟠 **ALTO** | Multi-Tenancy / IDOR | Falta de segregação por `store_id` em `suppliers`, `brands` e `categories` | Tabelas `suppliers`, `brands`, `categories` e seus serviços correspondentes |
| **SEC-05** | 🟠 **ALTO** | RLS / Integridade de Dados | `InventoryService.registerStockEntry` insere diretamente em `products` contornando `manage_product` | `src/services/inventory.service.ts` (linhas 120–150) |
| **SEC-06** | 🟠 **ALTO** | Supply Chain / Deps | Dependências com vulnerabilidades críticas e moderadas (`dompurify`, `vite`, `zod`, `minimatch`) | `package.json`, `package-lock.json` |
| **SEC-07** | 🟡 **MÉDIO** | BOLA / IDOR | `FinanceService.toggleExpensePaid` altera status de despesa sem validar `store_id` ativo | `src/services/finance.service.ts` (`public.fixed_expenses`) |
| **PERF-01**| 🟡 **MÉDIO** | Performance / Banco | Ausência de índices em chaves estrangeiras operacionais (`user_store_access.store_id`, `automation_runs.rule_id`) | Tabelas `user_store_access`, `automation_runs` |
| **CODE-01**| 🟡 **MÉDIO** | Concorrência / Frontend | Ausência de `useCallback` e proteção contra duplo clique no handler `handleConfirmSale` do PDV | `src/components/pdv/PdvView.tsx` |
| **ARCH-01**| 🟢 **BAIXO** | Código Morto / Arquitetura | `DashboardService.getMetrics` não utilizado, sem filtro de tenant e com cálculo pesado em memória | `src/services/dashboard.service.ts` |
| **LINT-01**| 🟢 **BAIXO** | Higiene de Código | 26 warnings do ESLint referentes a variáveis não utilizadas e dependências ausentes de hooks | Módulos PDV, Dashboard, Inventory, Returns, Suppliers |

---

## 3. Detalhamento Técnico dos Achados

---

### 🔴 SEC-01: Inconsistência Transacional no Rollback de Estoque PIX
- **Severidade:** 🔴 **CRÍTICO**
- **Categoria:** Integridade de Dados / Estoque Multi-Loja
- **Objeto Afetado:** Função `public.cancel_mp_pix_sale(uuid)`
- **Arquivos Relacionados:** `supabase/migrations/20260828000003_multi_store.sql`, `supabase/migrations/20261003000000_coresys_audit_final_remediation.sql`
- **Explicação Técnica:**
  Na criação de uma venda PIX (`create_mp_pix_sale`), o sistema reserva os itens no estoque executando:
  ```sql
  UPDATE public.store_inventory SET quantity = quantity - v_item.quantity WHERE ...;
  UPDATE public.product_variants pv
  SET reserved_quantity = COALESCE(reserved_quantity, 0) + v_item.quantity,
      stock_quantity = (SELECT COALESCE(sum(si.quantity), 0) FROM public.store_inventory si WHERE si.product_variant_id = pv.id)
  WHERE pv.id = v_item.variant_id;
  ```
  Entretanto, a função `cancel_mp_pix_sale(p_sale_id UUID)` (utilizada pelo webhook do Mercado Pago e pelo worker de conciliação quando uma cobrança PIX expira) apenas devolve a quantidade para `store_inventory`:
  ```sql
  UPDATE public.store_inventory SET quantity = quantity + v_item.quantity WHERE ...;
  ```
  A função **não decrementa** `reserved_quantity` e **não recalcula** `stock_quantity` na tabela `product_variants`.
  Com isso, o saldo agregado fica distorcido indefinidamente, impossibilitando novas vendas ou provocando relatórios de disponibilidade incorretos.
- **Sugestão de Correção:**
  Atualizar `cancel_mp_pix_sale` para incluir a sincronização de `product_variants` dentro da mesma transação atômica:
  ```sql
  UPDATE public.product_variants pv
  SET reserved_quantity = GREATEST(0, COALESCE(reserved_quantity, 0) - v_item.quantity),
      stock_quantity = (
        SELECT COALESCE(sum(si.quantity), 0)
        FROM public.store_inventory si
        WHERE si.product_variant_id = pv.id
      )
  WHERE pv.id = v_item.product_variant_id;
  ```

---

### 🟠 SEC-02: Search Path Hijacking em Trigger `SECURITY DEFINER`
- **Severidade:** 🟠 **ALTO**
- **Categoria:** Segurança PostgreSQL / Privilégios
- **Função Afetada:** `public.protect_profile_role()`
- **Arquivo:** `supabase/migrations/20260828000001_hardening_rls.sql`
- **Explicação Técnica:**
  A função trigger `protect_profile_role()` foi declarada como `SECURITY DEFINER` sem fixar o `SET search_path = public`. Funções `SECURITY DEFINER` sem search_path fixo executam no contexto do usuário proprietário (`postgres`), tornando-se suscetíveis a ataques onde um usuário malicioso cria objetos substitutos em schemas temporários (`pg_temp`) ou em schemas presentes no início do search_path.
- **Sugestão de Correção:**
  Redefinir a função ou aplicar explicitamente o comando de alteração:
  ```sql
  ALTER FUNCTION public.protect_profile_role() SET search_path = public;
  ```

---

### 🟠 SEC-03: Falta de Fail-Closed em Verificações de Role nas RPCs de Privacidade/LGPD
- **Severidade:** 🟠 **ALTO**
- **Categoria:** Autenticação / Autorização / RLS
- **Funções Afetadas:**
  - `public.export_customer_personal_data(uuid, uuid)`
  - `public.create_privacy_request(uuid, uuid, text, text)`
  - `public.resolve_privacy_request(uuid, uuid, text, text)`
- **Arquivos:** `supabase/migrations/20261001150554_add_customer_personal_data_export.sql`, `supabase/migrations/20261001150645_add_privacy_request_workflow.sql`, `supabase/migrations/20261001150659_add_privacy_request_resolution.sql`
- **Explicação Técnica:**
  As RPCs utilizam a seguinte validação:
  ```sql
  v_role := public.get_user_store_role(p_store_id);
  if v_role not in ('ADMIN', 'MANAGER') then
    raise exception 'personal data export requires ADMIN or MANAGER role';
  end if;
  ```
  Na semântica trivalente do SQL, se `v_role` for `NULL`, a expressão `NULL NOT IN ('ADMIN', 'MANAGER')` resulta em `NULL`, e o bloco `IF` não é executado se houver inversões ou se a função helper falhar em levantar exceção. O padrão fail-closed adotado nas migrações mais recentes do CoreSys exige checagem explícita de `NULL`:
  ```sql
  IF v_role IS NULL OR v_role NOT IN ('ADMIN', 'MANAGER') THEN ...
  ```
- **Sugestão de Correção:**
  Refatorar as verificações em todas as funções afetadas para:
  ```sql
  IF v_role IS NULL OR v_role NOT IN ('ADMIN', 'MANAGER') THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores ou gerentes.';
  END IF;
  ```

---

### 🟠 SEC-04: Ausência de Segregação por `store_id` em Entidades Globais
- **Severidade:** 🟠 **ALTO**
- **Categoria:** Arquitetura Multi-Tenant / Confidencialidade
- **Tabelas Afetadas:** `public.suppliers`, `public.brands`, `public.categories`
- **Serviços Afetados:** `src/services/suppliers.service.ts`, `src/services/brands.service.ts`, `src/services/categories.service.ts`
- **Explicação Técnica:**
  As tabelas `suppliers`, `brands` e `categories` foram criadas sem a coluna `store_id`. Em uma implantação multi-loja onde empresas distintas compartilham a mesma instância de banco, gerentes de uma loja conseguem listar, alterar e excluir fornecedores, acordos e categorias de concorrentes ou parceiros comerciais que utilizam a mesma plataforma.
- **Sugestão de Correção:**
  1. Adicionar `store_id UUID REFERENCES public.stores(id)` nessas tabelas ou um sinalizador `is_global BOOLEAN DEFAULT false`.
  2. Atualizar as políticas RLS para filtrar por `store_id = current_store` ou `is_global = true`.
  3. Atualizar as chamadas de serviço no frontend para enviar e filtrar pelo `storeId`.

---

### 🟠 SEC-05: Inserção Direta em `products` Contornando `manage_product`
- **Severidade:** 🟠 **ALTO**
- **Categoria:** Integridade de Dados / Bypass de RLS
- **Arquivo Afetado:** `src/services/inventory.service.ts` (linhas 120–150)
- **Tabelas Afetadas:** `public.products`, `public.product_variants`
- **Explicação Técnica:**
  No fluxo de entrada de estoque com produto novo, o método `registerStockEntry` insere o produto diretamente via cliente Supabase:
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
  Nas migrações `20260930010321` e `20260930024000`, os privilégios de escrita direta da coluna `cost_price` foram revogados para `authenticated` visando proteção de segredos comerciais e auditoria, elegendo a RPC `manage_product` como caminho oficial. Além disso, se a inserção da variante falhar na sequência, o produto pai fica órfão no catálogo.
- **Sugestão de Correção:**
  Utilizar a RPC transacional `manage_product` ou centralizar a criação via `ProductsService.create`.

---

### 🟠 SEC-06: Vulnerabilidades Conhecidas em Dependências
- **Severidade:** 🟠 **ALTO**
- **Categoria:** Segurança da Cadeia de Suprimentos (Supply Chain)
- **Arquivos Afetados:** `package.json`, `package-lock.json`
- **Explicação Técnica:**
  A execução de `npm run security:dependencies` (`npm audit --audit-level=moderate`) acusa 19 vulnerabilidades:
  - 1 Crítica: `dompurify` (bypasses em template expressions e shadow roots).
  - 4 Altas: `vite`, `zod`, `body-parser`, `undici`.
  - 14 Moderadas: `minimatch`, `qs`, `@vitest/mocker`.
- **Sugestão de Correção:**
  Atualizar `dompurify`, `vite` e pacotes diretos no `package.json`, configurando `overrides` para dependências transitivas (`minimatch: ^11.0.4`) sem introduzir conflitos de breaking changes no build.

---

### 🟡 SEC-07: Risco de BOLA/IDOR em `FinanceService.toggleExpensePaid`
- **Severidade:** 🟡 **MÉDIO**
- **Categoria:** Controle de Acesso / API Design
- **Arquivo Afetado:** `src/services/finance.service.ts`
- **Tabela:** `public.fixed_expenses`
- **Explicação Técnica:**
  O método atualiza uma despesa fixa filtrando exclusivamente pelo identificador único:
  ```typescript
  const { data, error } = await supabase
    .from('fixed_expenses')
    .update({ paid: !currentPaidState })
    .eq('id', uuid)
    .select(...)
    .single();
  ```
  Caso um operador tenha permissão em múltiplas lojas, ele pode alternar o status de uma despesa pertencente a uma loja diferente daquela em que está operando no momento, quebrando a consistência do contexto multi-tenant.
- **Sugestão de Correção:**
  Exigir `storeId: string` na assinatura do método e adicionar `.eq('store_id', storeId)` na query.

---

### 🟡 PERF-01: Chaves Estrangeiras Sem Índices Secundários Dedicados
- **Severidade:** 🟡 **MÉDIO**
- **Categoria:** Performance e Escalabilidade do PostgreSQL
- **Tabelas Afetadas:** `user_store_access(store_id)`, `automation_runs(rule_id)`, `physical_inventories(store_id, created_by)`
- **Explicação Técnica:**
  Em bancos relacionais PostgreSQL com RLS intensivo, foreign keys sem índices provocam sequential scans na tabela referenciada durante operações de mutação na tabela de origem, aumentando contenção e tempo de resposta.
- **Sugestão de Correção:**
  Criar índices B-tree cobrindo essas colunas em migração dedicada.

---

### 🟡 CODE-01: Ausência de `useCallback` e Proteção Contra Reentrância no PDV
- **Severidade:** 🟡 **MÉDIO**
- **Categoria:** Resiliência e Concorrência Frontend
- **Arquivo Afetado:** `src/components/pdv/PdvView.tsx` (linha 235)
- **Explicação Técnica:**
  A rotina `handleConfirmSale` é recriada em cada ciclo de renderização e chamada em atalhos de teclado (F2, Enter). Sem `useCallback` e sem flag de bloqueio atômico de clique (`isSubmitting`), cliques repetidos ou teclas pressionadas em rápida sucessão podem disparar chamadas concorrentes à RPC de venda antes da resposta do servidor.
- **Sugestão de Correção:**
  Envolver o handler em `useCallback` e travar disparos subsequentes enquanto a Promise estiver pendente.

---

### 🟢 ARCH-01: Código Morto em `DashboardService.getMetrics`
- **Severidade:** 🟢 **BAIXO**
- **Categoria:** Arquitetura / Dívida Técnica
- **Arquivo Afetado:** `src/services/dashboard.service.ts`
- **Explicação Técnica:**
  `DashboardService` não está conectado a nenhuma view ativa do sistema (o `DashboardView` consome dados do `StoreContext`). O serviço faz leitura total da tabela `sales` e processamento em memória JavaScript, gerando risco caso seja reativado inadvertidamente.
- **Sugestão de Correção:**
  Refatorar `DashboardService` para invocar a RPC `report_commercial_summary` ou removê-lo caso seja desnecessário.

---

### 🟢 LINT-01: 26 Avisos do ESLint
- **Severidade:** 🟢 **BAIXO**
- **Categoria:** Qualidade e Higiene de Código
- **Arquivos Afetados:** `DashboardView.tsx`, `InventoryView.tsx`, `NewProductModal.tsx`, `PdvView.tsx`, `SupplierForm.tsx`, Contextos
- **Explicação Técnica:**
  Avisos de variáveis declaradas e não utilizadas (`CreditCard`, `ChevronDown`, `Trash2`, `formatPhone`), além de warnings do plugin `react-refresh` devido a exports múltiplos no mesmo módulo.
- **Sugestão de Correção:**
  Limpar imports não utilizados e mover funções auxiliares para arquivos utilitários dedicados.

---

## 4. Plano de Ação Recomendado (Próximos Passos)

Em conformidade com a política de governança técnica do CoreSys de **uma melhoria pequena, de alto impacto e segura por PR**, recomenda-se a seguinte ordem de execução:

1. **Sprint Imediata (P0 — Integridade & Confiabilidade):**
   - **Ticket 1:** Corrigir a RPC `cancel_mp_pix_sale` para decrementar atomicamente `reserved_quantity` e recalcular `product_variants.stock_quantity`.
   - **Ticket 2:** Adicionar `SET search_path = public` ao trigger `protect_profile_role()`.
   - **Ticket 3:** Corrigir validação fail-closed (`v_role IS NULL OR ...`) nas RPCs de LGPD/privacidade.
2. **Sprint Curto Prazo (P1 — Segurança & Multi-Tenancy):**
   - **Ticket 4:** Adicionar `store_id` obrigatório em `FinanceService.toggleExpensePaid`.
   - **Ticket 5:** Refatorar `InventoryService.registerStockEntry` para usar `manage_product`.
   - **Ticket 6:** Atualizar dependências com vulnerabilidades críticas (`dompurify`, `vite`, `zod`).
3. **Sprint Médio Prazo (P2 — Performance & Higiene):**
   - **Ticket 7:** Adicionar índices de chaves estrangeiras em `user_store_access` e `automation_runs`.
   - **Ticket 8:** Otimizar atalhos do PDV com `useCallback` e limpar warnings do ESLint.

---
*Relatório técnico consolidado gerado e arquivado para o ciclo de auditoria diária do CoreSys.*
