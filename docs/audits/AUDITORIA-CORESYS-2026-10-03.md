# Relatório de Auditoria Técnica Diária - CoreSys
**Data:** 03 de outubro de 2026
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Auditor:** Engenheiro de Software Sênior (Jules)
**Status da Auditoria:** Concluído

---

## 1. RESUMO EXECUTIVO

Foi realizada a auditoria técnica diária do sistema **CoreSys (Vestra ERP / PDV Multi-loja)** abrangendo o código frontend (React/TypeScript), a camada de serviços, a integração com Supabase Auth/RPCs, as políticas de Row Level Security (RLS) e as migrações SQL mais recentes.

### Principais Diagnósticos:
1. **Segurança & Multi-Tenant:** A arquitetura de isolamento multi-tenant está bem consolidada pelas migrações recentes (`20261003000000_coresys_audit_final_remediation.sql` e anteriores). As RPCs críticas de PDV (`complete_sale`, `create_mp_pix_sale`, `cancel_sale`, `process_return`) executam com `SECURITY DEFINER`, `SET search_path = public`, revogação explícita de `EXECUTE` para `anon/PUBLIC` e checagens *fail-closed* via `get_user_store_role(p_store_id)`.
2. **BOLA / IDOR:** A maioria dos endpoints e RPCs valida rigorosamente o vínculo entre a loja autenticada (`p_store_id`) e a entidade acessada. No entanto, identificou-se uma pequena vulnerabilidade de bypass de arquitetura no serviço de estoque frontend (`inventory.service.ts`), onde inserções diretas em `brands` e `categories` ignoram o fluxo da RPC `manage_product`.
3. **Estabilidade e Testes:** A suíte de testes unitários automatizados está com 100% de aprovação (39 testes em 11 arquivos de teste passando), e a auditoria de segurança de dependências registrou **0 vulnerabilidades**.
4. **Performance:** O banco de dados possui índices nas chaves primárias e estrangeiras de `store_id`, com ressalvas pequenas para consultas agregadas sobre `sale_items` e `store_inventory`.

---

## 2. QUADRO RESUMO DOS ACHADOS

| ID | Severidade | Categoria | Descrição Sucinta | Status |
|---|---|---|---|---|
| **AUD-01** | **ALTO** | Segurança / Arquitetura | Inserção direta de Marcas/Categorias no Frontend burla a RPC `manage_product` | Identificado |
| **AUD-02** | **MÉDIO** | Desempenho / DB | Ausência de índice composto otimizado em `sale_items(sale_id, product_variant_id)` para relatórios | Identificado |
| **AUD-03** | **MÉDIO** | Frontend / Qualidade | Warnings de React Hooks (`useEffect`/`useCallback`) no PDV e Gráficos do Dashboard | Identificado |
| **AUD-04** | **BAIXO** | Integração / Resiliência | Ausência de Backoff Exponencial para retentativa de falhas no Worker do Mercado Pago | Identificado |
| **AUD-05** | **BAIXO** | Limpeza de Código | Variáveis e imports não utilizados em serviços e componentes modais (26 warnings ESLint) | Identificado |

---

## 3. DETALHAMENTO DOS ACHADOS

### AUD-01 [ALTO] Inserção Direta de Marcas e Categorias no Frontend Burlando RPC
- **Severidade:** ALTO
- **Descrição & Causa Raiz:**
  No arquivo `src/services/inventory.service.ts` (`createProduct`), ao cadastrar um produto cujo nome de marca (`params.brand`) ou categoria (`params.category`) não exista previamente, o código faz requisições diretas de inserção na API Supabase: `supabase.from('brands').insert(...)` e `supabase.from('categories').insert(...)`.
  Isso contorna a RPC `manage_product` (que é o ponto centralizado de validação de negócios e permissões) e insere dados em tabelas compartilhadas sem validação de sanidade no backend, permitindo a criação arbitrária de entidades por usuários sem permissão administrativa adequada.
- **Objetos Afetados:**
  - Código: `src/services/inventory.service.ts` (linhas 113–128)
  - Banco de Dados: `public.brands`, `public.categories`
- **Sugestão de Correção:**
  Remover as chamadas `supabase.from('brands').insert()` e `supabase.from('categories').insert()` do frontend. Toda a resolução e criação de marcas e categorias deve ocorrer de forma atômica dentro da RPC `manage_product` ou por meio de uma RPC de suporte com verificação de papéis do usuário.

---

### AUD-02 [MÉDIO] Ausência de Índice Composto em `sale_items` para Agregações
- **Severidade:** MÉDIO
- **Descrição & Causa Raiz:**
  Relatórios como `report_top_selling_products` e `get_profitability_by_product` realizam *JOINs* e *GROUP BY* intensivos relacionando `sales` (filtrado por `store_id`) com `sale_items`. Embora `sales.store_id` e `sale_items.sale_id` possuam índices simples, a tabela `sale_items` não possui um índice composto em `(sale_id, product_variant_id)` incluindo colunas de quantidade e valor, o que pode causar *Sequential Scans* significativos em bases com volume elevado de itens vendidos.
- **Objetos Afetados:**
  - Banco de Dados: Tabela `public.sale_items`
  - Migrações / RPCs: `report_top_selling_products`, `get_profitability_by_product`
- **Sugestão de Correção:**
  Adicionar a seguinte migração de índice:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_sale_items_sale_variant_perf
  ON public.sale_items(sale_id, product_variant_id)
  INCLUDE (quantity, total);
  ```

---

### AUD-03 [MÉDIO] Dependências Incompletas em React Hooks e Invalidação de Instância
- **Severidade:** MÉDIO
- **Descrição & Causa Raiz:**
  No componente `src/components/pdv/PdvView.tsx`, a função `handleConfirmSale` é declarada no corpo do componente e passada no array de dependências de um `useEffect` na linha 372. Como a função não é estabilizada com `useCallback`, ela muda de referência a cada renderização, provocando a re-execução desnecessária do efeito. Em gráficos (`RevenueChart.tsx`, `TopProductsChart.tsx`) e telas de listagem (`FinanceView.tsx`, `MovementsView.tsx`), faltam dependências em `useEffect`, podendo gerar *stale closures* (dados desatualizados na interface) quando o usuário altera a loja selecionada.
- **Objetos Afetados:**
  - `src/components/pdv/PdvView.tsx`
  - `src/components/dashboard/RevenueChart.tsx`
  - `src/components/dashboard/TopProductsChart.tsx`
  - `src/components/finance/FinanceView.tsx`
  - `src/components/movements/MovementsView.tsx`
- **Sugestão de Correção:**
  Envolver `handleConfirmSale` com `useCallback` no `PdvView.tsx` e ajustar os arrays de dependências dos `useEffect` nos gráficos e views para reagir corretamente à alteração do contexto de loja ou filtros.

---

### AUD-04 [BAIXO] Estratégia de Retentativa sem Backoff Exponencial no Mercado Pago Worker
- **Severidade:** BAIXO
- **Descrição & Causa Raiz:**
  Nas Edge Functions `mp-webhook` e `mp-pix-reconciliation-worker`, o tratamento de eventos de pagamento falhos reprocessa registros imediatamente na próxima rodada do worker sem intervalo incremental de espera (backoff exponencial). Se a API externa do Mercado Pago estiver em instabilidade, todas as tentativas configuradas podem ser consumidas em sequência rápida.
- **Objetos Afetados:**
  - Edge Functions: `supabase/functions/mp-webhook/index.ts`, `supabase/functions/mp-pix-reconciliation-worker/index.ts`
  - Tabela: `public.mp_webhook_events`
- **Sugestão de Correção:**
  Adicionar uma coluna `next_retry_at timestamptz` na tabela `mp_webhook_events` e calcular o próximo tempo de execução com base no número de tentativas anteriores (`now() + (attempts ^ 2 * interval)`).

---

### AUD-05 [BAIXO] Código Morto e Alertas do Linter no Frontend
- **Severidade:** BAIXO
- **Descrição & Causa Raiz:**
  O linter reporta 26 avisos referentes a variáveis declaradas mas não utilizadas (ex: `CreditCard` e `formatPaymentMethod` em `DashboardView.tsx`, `ChevronDown` e `Trash2` em `InventoryView.tsx`, `formatPhone` em `SupplierForm.tsx`, import inútil de `Store` em `store.service.ts`).
- **Objetos Afetados:**
  - `src/services/store.service.ts`
  - `src/components/dashboard/DashboardView.tsx`
  - `src/components/inventory/InventoryView.tsx`
  - Modais em `src/components/inventory/` e `src/components/returns/`
- **Sugestão de Correção:**
  Limpar os imports e declarações não utilizadas para manter o código enxuto e atingir 0 avisos no linter.

---

## 4. VERIFICAÇÃO DE SEGURANÇA E MULTI-TENANT ISOLATION

### Supabase Auth & RLS
- **Isolamento de Tenant:** Confirmado. Todas as tabelas transacionais principais (`sales`, `financial_transactions`, `inventory_movements`, `customers`, `suppliers`, `store_inventory`) usam RLS habilitado com checagem rigorosa de `store_id` atrelado ao usuário em `user_store_access`.
- **Validação de SECURITY DEFINER:** A migração de remedição mais recente (`20261003000000_coresys_audit_final_remediation.sql`) revogou assinaturas legadas sem `store_id` da RPC `complete_sale` e impôs `SET search_path = public` em todas as funções elevadas.
- **Fail-Closed Role Check:** Funções como `complete_sale`, `create_mp_pix_sale` e `cancel_sale` verificam o papel retornado por `get_user_store_role(p_store_id)` e abortam caso a role não seja de nível permitido (`ADMIN`, `MANAGER`, `CASHIER`).

---

## 5. PLANO DE CORREÇÃO RECOMENDADO (PRÓXIMAS ETAPAS)

1. **Atuar sobre AUD-01 (ALTO):** Refatorar `src/services/inventory.service.ts` para eliminar escritas diretas nas tabelas `brands` e `categories`, delegando o gerenciamento à RPC do banco.
2. **Atuar sobre AUD-02 (MÉDIO):** Criar a migração do índice composto em `sale_items`.
3. **Atuar sobre AUD-03 e AUD-05 (MÉDIO / BAIXO):** Corrigir as dependências dos React Hooks e eliminar variáveis não utilizadas para zerar os avisos do ESLint.
4. **Atuar sobre AUD-04 (BAIXO):** Implementar retenção com backoff na reconciliação do PIX Mercado Pago.

---
*Relatório gerado automaticamente em 03/10/2026 como parte do processo diário de verificação do CoreSys.*
