# Relatório de Auditoria Técnica Diária - CoreSys

**Data:** 2026-10-21
**Repositório:** FlavioProgramador/projeto-loja-multimarcas
**Auditor:** Engenheiro de Software Sênior - CoreSys Technical Audit
**Status da Revisão:** Concluído (Sem alterações automáticas em código de produção nesta etapa)

---

## Executive Summary

Foi realizada uma análise minuciosa do codebase do CoreSys (Frontend React/TypeScript, Backend RPCs, Políticas RLS Supabase, Edge Functions e Schema de Banco de Dados).

Os achados foram categorizados e priorizados com foco em **Segurança, Isolamento Multi-tenant, Integridade de Dados e Performance Operacional**. O estado geral de segurança do banco de dados evoluiu significativamente com as últimas migrações (`20261003000000_coresys_audit_final_remediation.sql`), mas foram identificadas inconsistências no frontend, ausência de filtros explícitos de `store_id` em mutações diretas no client-side (dependendo exclusivamente do RLS), vulnerabilidade potencial no webhook do Mercado Pago quando sem validação de secret, e dependência em estatísticas globais no Dashboard sem escopo de loja.

---

## Resumo dos Achados por Severidade

| Severidade | Quantidade | Foco Principal |
| :--- | :--- | :--- |
| **CRÍTICO** | 1 | IDOR / Falta de escopo em mutações diretas em `customers.service.ts` e `suppliers.service.ts` |
| **ALTO** | 2 | Ausência de `SET search_path = public` em `protect_profile_role` e verificação de assinatura em Edge Function Webhook |
| **MÉDIO** | 3 | Query global sem `store_id` no `DashboardService`, catálogos globais compartilhados sem filtro por tenant (`brands`/`categories`/`suppliers`), e `useEffect` sem dependências de callback no PDV |
| **BAIXO** | 2 | Código morto/não utilizado no Frontend e `Fast Refresh` com exports mistos nos contextos |

---

## 1. Achados de Severidade CRÍTICA

### [CRÍTICO-01] Risco de IDOR / BOLA em Atualizações Diretas em `customers` e `suppliers`
- **Explicação:** No frontend, as chamadas `CustomersService.update(uuid, payload)`, `CustomersService.remove(uuid)` e `SuppliersService.update(uuid, payload)` realizam operações diretas `.eq('id', uuid)` sem incluir o filtro `.eq('store_id', storeId)`. Embora as políticas RLS na tabela barrem acessos entre lojas no banco de dados, a camada de aplicação/serviço não valida explicitamente a propriedade da loja antes do envio, violando a defesa em profundidade e criando risco de IDOR se o RLS sofrer regressão.
- **Arquivos/Tabelas Afetados:**
  - `src/services/customers.service.ts` (`update`, `remove`)
  - `src/services/suppliers.service.ts` (`update`, `remove`)
  - Tabelas: `public.customers`, `public.suppliers`
- **Sugestão de Correção:** Exigir o parâmetro `storeId` em todas as funções de mutação do serviço e encadear `.eq('store_id', storeId)` em todas as queries e mutações:
  ```typescript
  async update(storeId: string, uuid: string, customer: ...): Promise<void> {
    const { error } = await supabase
      .from('customers')
      .update(payload)
      .eq('id', uuid)
      .eq('store_id', storeId);
    if (error) throw error;
  }
  ```

---

## 2. Achados de Severidade ALTA

### [ALTO-01] Função `SECURITY DEFINER` `protect_profile_role()` sem `SET search_path = public`
- **Explicação:** A função de trigger `public.protect_profile_role()`, criada na migração `20260828000001_hardening_rls.sql`, possui a cláusula `SECURITY DEFINER`, porém não possui a propriedade `SET search_path = public`. Funções `SECURITY DEFINER` sem `search_path` fixo executam com os privilégios do criador da função e estão sujeitas a ataques de sequestro de caminho de busca (`search_path hijacking`).
- **Arquivos/Tabelas/Funções Afetados:**
  - Migração: `supabase/migrations/20260828000001_hardening_rls.sql`
  - Função: `public.protect_profile_role()`
- **Sugestão de Correção:** Aplicar uma nova migração adicionando `ALTER FUNCTION public.protect_profile_role() SET search_path = public;` ou alterando a definição da função:
  ```sql
  ALTER FUNCTION public.protect_profile_role() SET search_path = public;
  ```

### [ALTO-02] Processamento de Webhook do Mercado Pago com Supabase Service Role Key sem Validação de HMAC em Modo de Teste
- **Explicação:** A Edge Function `supabase/functions/mp-webhook/index.ts` executa usando `SUPABASE_SERVICE_ROLE_KEY` (ignorando RLS). Se a chave secreta de assinatura do webhook do Mercado Pago (`MP_WEBHOOK_SECRET`) não estiver configurada no ambiente de staging/desenvolvimento, a função aceita notificações sem validar a assinatura HMAC `x-signature`, permitindo que um atacante simule notificações de pagamento aprovado via chamadas POST diretas ao endpoint do webhook.
- **Arquivos Afetados:**
  - `supabase/functions/mp-webhook/index.ts`
- **Sugestão de Correção:** Garantir falha estrita (fail-closed) se `MP_WEBHOOK_SECRET` não estiver presente ou se a assinatura HMAC falhar, independentemente do ambiente, bloqueando o processamento com status 401/403.

---

## 3. Achados de Severidade MÉDIA

### [MÉDIO-01] Métrica do Dashboard Carrega Vendas Globais sem Filtro por `store_id`
- **Explicação:** A função `DashboardService.getMetrics()` executa uma query `supabase.from('sales').select(...)` e `supabase.from('product_variants').select(...)` sem filtrar por `store_id`. Se um usuário tiver permissão de leitura em múltiplas lojas ou se o RLS permitir visualização ampla, o dashboard somará totais e vendas de outras unidades da rede ao invés da loja selecionada no contexto atual.
- **Arquivos Afetados:**
  - `src/services/dashboard.service.ts`
- **Sugestão de Correção:** Passar o `storeId` da loja atualmente selecionada para `getMetrics(storeId: string)` e aplicar `.eq('store_id', storeId)` em todas as buscas de vendas e alertas de estoque.

### [MÉDIO-02] Catálogos Globais de Marcas e Categorias sem Contexto Tenant
- **Explicação:** Os serviços `BrandsService` e `CategoriesService` buscam todos os registros da tabela `brands` e `categories` (`select('*')`). À medida que a base crescer, a listagem total sem paginação e sem filtro contextual por tenant trará overhead de tráfego e dados irrelevantes para operadores de lojas específicas.
- **Arquivos Afetados:**
  - `src/services/brands.service.ts`
  - `src/services/categories.service.ts`
- **Sugestão de Correção:** Implementar paginação/limite de busca ou vincular tabelas de marcas e categorias ao tenant (`store_id`) quando aplicável, mantendo índices otimizados no banco.

### [MÉDIO-03] Recriação Semântica de Callbacks no Componente PDV
- **Explicação:** No componente `PdvView.tsx`, a função `handleConfirmSale` é reconstruída a cada render sem `useCallback`, provocando warnings de depêndencia do React Hook `useEffect` na linha 372 e re-renders desnecessários na interface da caixa registradora.
- **Arquivos Afetados:**
  - `src/components/pdv/PdvView.tsx`
- **Sugestão de Correção:** Envolver a handler de confirmação de venda em `useCallback` com as dependências corretas.

---

## 4. Achados de Severidade BAIXA

### [BAIXO-01] Warnings de ESLint e Código Não Utilizado no Frontend
- **Explicação:** O comando `npm run lint` reporta 26 warnings referentes a variáveis importadas e declaradas que não são utilizadas em componentes (`DashboardView.tsx`, `InventoryView.tsx`, `NewProductModal.tsx`, `NewReturnModal.tsx`, `SupplierForm.tsx`).
- **Arquivos Afetados:**
  - `src/components/dashboard/DashboardView.tsx`
  - `src/components/inventory/InventoryView.tsx`
  - `src/components/returns/NewReturnModal.tsx`
  - Outros componentes listados no log de linting.
- **Sugestão de Correção:** Remover as variáveis e imports não utilizados ou prefixá-los com `_`.

### [BAIXO-02] Múltiplos Exports nos Arquivos de Contexto (React Fast Refresh Warning)
- **Explicação:** Os arquivos `AuthContext.tsx`, `CartContext.tsx`, `StoreContext.tsx` e `ThemeContext.tsx` exportam componentes React e helpers/constantes adicionais no mesmo arquivo, gerando avisos do HMR (Hot Module Replacement) no Vite.
- **Arquivos Afetados:**
  - `src/contexts/AuthContext.tsx`
  - `src/contexts/CartContext.tsx`
  - `src/contexts/StoreContext.tsx`
  - `src/contexts/ThemeContext.tsx`
- **Sugestão de Correção:** Mover tipos, contextos crus e funções utilitárias para arquivos de tipos ou helpers dedicados (`auth.types.ts`, `cart.types.ts`).

---

## Matriz de Verificação de Segurança e Arquitetura

| Critério de Auditoria | Status | Observação |
| :--- | :--- | :--- |
| **Isolamento Multi-tenant (Database)** | **CONFORME** | RPCs críticas (`complete_sale`, `create_mp_pix_sale`, `cancel_sale`) validam rigorosamente `p_store_id` e papel do usuário (`get_user_store_role`). |
| **Políticas RLS Supabase** | **CONFORME** | RLS ativado e testado em todas as tabelas operacionais. |
| **RPCs e Security Definer** | **ATENÇÃO** | 1 função (`protect_profile_role`) pendente de `SET search_path = public`. RPCs de venda tratadas com sucesso. |
| **Client-side Service Isolation** | **ATENÇÃO** | `customers.service.ts` e `suppliers.service.ts` requerem acoplamento explícito de `store_id` em updates/deletes. |
| **Acesso a Dados Sensíveis** | **CONFORME** | Preços de custo e CPF mascarados adequadamente em consultas públicas e perfis não administrativos. |
| **Testes Automatizados** | **CONFORME** | Suíte Vitest rodando com 39 testes passando sem falhas. |

---

## Recomendações e Próximos Passos (Plano de Ação)

1. **Ação Imediata (Próxima Sprint):**
   - Criar migração SQL de patch para aplicar `SET search_path = public` na função `protect_profile_role()`.
   - Atualizar `src/services/customers.service.ts` e `suppliers.service.ts` para exigir `storeId` em todas as mutações.
   - Corrigir `DashboardService.getMetrics` no frontend para receber a loja ativa via `StoreContext`.
2. **Ação Secundária:**
   - Exigir validação estrita de webhook na Edge Function `mp-webhook`.
   - Limpar warnings de lint no frontend para zerar ruídos na integração contínua (CI).
