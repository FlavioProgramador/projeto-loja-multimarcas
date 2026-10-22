# Relatório de Auditoria Técnica Diária - CoreSys ERP/PDV Multi-Tenant
**Data:** 03 de Outubro de 2026
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Auditor:** Jules (Engenheiro de Software Sênior)
**Status do Sistema:** Operacional / Hardened (Segurança & Isolamento Multi-Tenant Reforçados)

---

## Executive Summary (Resumo Executivo)
Esta auditoria técnica diária analisou a integridade da arquitetura multi-tenant, validações de segurança (frontend, backend e Supabase PL/pgSQL RPCs), controle de acesso (RLS / Auth / IDOR / BOLA), funções `SECURITY DEFINER`, performance de queries e manutenibilidade do código.

As revisões e reparações recentes no repositório reduziram severamente os riscos críticos do CoreSys. No entanto, foram identificados pontos residuais no frontend e nas definições de funções/views do banco de dados que devem ser acompanhados e corrigidos nas próximas iterações.

---

## 1. Mapeamento e Classificação dos Achados

### 1.1 [CRÍTICO] Filtro de `store_id` Ausente em Consultas Diretas do Frontend (`suppliers`, `brands`, `categories`)
- **Severidade:** CRÍTICO / ALTO (Risco de BOLA / IDOR / Vazamento de Dados entre Tenants)
- **Descrição:**
  No serviço do frontend `src/services/suppliers.service.ts` (método `getAll`), as consultas Supabase executam `.from('suppliers').select('*').eq('is_active', true)` sem filtrar diretamente pelo `store_id` da loja ativa do contexto. Da mesma forma, em `src/services/inventory.service.ts`, buscas e inserções na tabela `brands` e `categories` operam sem passar `store_id` no `.select()` ou `.insert()`.
  Embora o Supabase RLS no banco restrinja as linhas visíveis para o usuário autenticado de acordo com seus privilégios nas lojas vinculadas, depender unicamente do RLS sem especificar o `store_id` no client-side pode resultar em retorno não intencional de dados de múltiplas lojas para usuários que pertencem a mais de uma loja (ex: Administradores ou Gerentes multi-loja).
- **Arquivos/Tabelas Afetados:**
  - `src/services/suppliers.service.ts` (`SuppliersService.getAll`)
  - `src/services/inventory.service.ts` (`InventoryService.registerStockEntry`)
  - Tabelas `suppliers`, `brands`, `categories`
- **Sugestão de Correção:**
  Injetar o `storeId` do contexto ativo em todas as chamadas do frontend para serviços de tabelas pertencentes ao tenant, garantindo filtro duplo (Client-side `store_id` + Server-side RLS):
  ```typescript
  // Exemplo em SuppliersService.getAll(storeId: string)
  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .eq('store_id', storeId)
    .eq('is_active', true);
  ```

---

### 1.2 [ALTO] Tratamento de Erros e Resiliência Ausente em Serviços Principais do Frontend
- **Severidade:** ALTO (Risco Funcional e de UX)
- **Descrição:**
  Serviços críticos como `src/services/suppliers.service.ts`, `src/services/products.service.ts`, `src/services/categories.service.ts`, e `src/services/automations/automations.service.ts` executam mutações (`insert`, `update`, `delete`) sem blocos `try/catch`. Caso o banco retorne um erro RLS, violação de constraint ou falha de rede, a Promise rejeita sem tratamento local, podendo travar o componente chamador ou causar exceções não capturadas no frontend.
- **Arquivos Afetados:**
  - `src/services/suppliers.service.ts`
  - `src/services/products.service.ts`
  - `src/services/categories.service.ts`
  - `src/services/automations/automations.service.ts`
- **Sugestão de Correção:**
  Envolver chamadas de mutação em blocos `try/catch` padronizados, retornando objetos com estrutura de erro explícita (`{ data, error }`) ou propagando mensagens amigáveis para a interface de usuário.

---

### 1.3 [MÉDIO] Função Trigger `protect_profile_role` Sem `search_path` Explícito
- **Severidade:** MÉDIO (Segurança em Funções PL/pgSQL)
- **Descrição:**
  A função `protect_profile_role` criada nas migrations de hardening é disparada via trigger para prevenir a alteração do papel do perfil por usuários não autorizados. No entanto, a função é executada com `SECURITY DEFINER` e não possui `SET search_path = public` explícito na sua declaração inicial, podendo ser vulnerável a ataques de *search_path hijacking* se executada por esquemas não confiáveis.
- **Arquivos/Funções Afetadas:**
  - `supabase/migrations/20260828000001_hardening_rls.sql`
  - Função `public.protect_profile_role()`
- **Sugestão de Correção:**
  Criar migration complementar adicionando `SET search_path = public` na assinatura de `public.protect_profile_role()`.

---

### 1.4 [MÉDIO] Métricas do Dashboard Recalculadas no Client-Side sem Filtro de Loja em Vendas e Variantes
- **Severidade:** MÉDIO (Inconsistência de Regra de Negócio e Multi-Tenant)
- **Descrição:**
  Em `src/services/dashboard.service.ts`, o método `getMetrics()` busca todas as vendas completadas (`.from('sales').select(...).eq('status', 'COMPLETED')`) e todos os produtos com estoque baixo (`.from('product_variants').select(...).lte('stock_quantity', 2)`). As métricas de "Vendas do Mês", "Vendas de Hoje" e "Ticket Médio" são agregadas no navegador utilizando JavaScript.
  Sem filtrar pelo `store_id` ativo da sessão, se um usuário tiver permissão em 2 lojas, o dashboard exibirá valores agregados misturados de ambas as lojas.
- **Arquivos Afetados:**
  - `src/services/dashboard.service.ts` (`DashboardService.getMetrics`)
- **Sugestão de Correção:**
  Receber `storeId` como parâmetro obrigatório em `getMetrics(storeId: string)` e aplicar `.eq('store_id', storeId)` em ambas as queries (`sales` e `product_variants`).

---

### 1.5 [BAIXO] Avisos do ESLint por Variáveis e Hooks Não Utilizados
- **Severidade:** BAIXO (Limpeza de Código e Qualidade)
- **Descrição:**
  O linter reporta 26 avisos (0 erros) relacionados a importações/variáveis não utilizadas e dependências ausentes no `useEffect` (ex: `CreditCard`, `formatPaymentMethod`, `ChevronDown`, dependências em `RevenueChart.tsx` e `TopProductsChart.tsx`).
- **Arquivos Afetados:**
  - `src/components/dashboard/DashboardView.tsx`
  - `src/components/dashboard/RevenueChart.tsx`
  - `src/components/inventory/InventoryView.tsx`
  - `src/components/pdv/PdvView.tsx`
- **Sugestão de Correção:**
  Limpar as variáveis não utilizadas e ajustar as dependências do `useEffect` usando `useCallback` ou removendo variáveis desnecessárias.

---

## 2. Matriz de Avaliação do Sistema

| Categoria | Avaliação | Detalhes |
| :--- | :---: | :--- |
| **Isolamento Multi-Tenant** | 🟢 FORTE / RLS ATIVO | Banco de dados totalmente isolado por `store_id` e RLS rigoroso nas RPCs críticas. Recomenda-se adicionar `store_id` explícito em `suppliers.service.ts` e `dashboard.service.ts`. |
| **Segurança Supabase Auth & RLS** | 🟢 ALTO | RPCs críticas (`complete_sale`, `cancel_sale`, `create_mp_pix_sale`) usam `SET search_path = public` e checagem *fail-closed* do papel do usuário via `auth.uid()`. |
| **Funções SECURITY DEFINER** | 🟡 BOM | 89 de 90 funções `SECURITY DEFINER` contêm `search_path = public` e autorização contextual. `protect_profile_role` deve receber `search_path`. |
| **Tratamento de Erros no Frontend** | 🟡 REGULAR | Serviços sem blocos `try/catch` diretos em mutações do banco. Exige refatoração para captura amigável de exceções. |
| **Performance e Índices** | 🟢 ALTO | Índices cobrindo `(store_id, is_active)`, `sale_id`, `product_id`, `created_at` e chaves estrangeiras de tabelas operacionais. |

---

## 3. Plano de Ação Recomendado (Roadmap de Correções)

1. **Prioridade 1 (Alta):** Refatorar `SuppliersService` e `DashboardService` para receber `storeId` e aplicar filtro `.eq('store_id', storeId)`.
2. **Prioridade 2 (Média):** Adicionar tratamento com `try/catch` nas chamadas do Supabase em todos os serviços do frontend.
3. **Prioridade 3 (Média):** Adicionar `SET search_path = public` na função PL/pgSQL `protect_profile_role`.
4. **Prioridade 4 (Baixa):** Resolver os 26 avisos do ESLint para manter a saúde do código.

---
*Relatório gerado e registrado para acompanhamento técnico contínuo.*
