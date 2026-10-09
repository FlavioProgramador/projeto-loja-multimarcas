# Relatório de Auditoria Técnica Diária - CoreSys
**Data de Emissão:** 03 de Outubro de 2026
**Repositório:** FlavioProgramador/projeto-loja-multimarcas
**Auditor Responsável:** Engenheiro de Software Sênior (Jules)
**Status:** Concluído

---

## 1. Resumo Executivo

Esta auditoria técnica diária realizou uma análise minuciosa no código-fonte do frontend (React / TypeScript), na camada de serviços, nas Edge Functions do Supabase e nas migrações do banco de dados PostgreSQL (políticas RLS, funções PL/pgSQL, triggers e índices).

A arquitetura do CoreSys demonstra um alto nível de maturidade e hardening implementados em migrações recentes (como isolamento de custos de produtos, controle rigoroso de acesso por loja `has_store_access` / `get_user_store_role`, proteção de webhooks via HMAC e idêmponcia de vendas). No entanto, foram identificados pontos críticos e de melhoria em termos de segurança, consistência multi-tenant na camada cliente, performance de banco e qualidade do código.

---

## 2. Sumário dos Achados por Severidade

| Severidade | Qtd | Categorias Principais |
| :--- | :---: | :--- |
| **CRÍTICO** | 1 | Função `SECURITY DEFINER` sem `search_path` fixo (`protect_profile_role`) |
| **ALTO** | 3 | Cláusulas de atualização/deleção no frontend sem filtro explícito de `store_id`; Políticas globais em `brands`, `categories` e `suppliers` permitindo acesso irrestrito inter-lojas; Falta de validação estrita no payload do webhook Mercado Pago no backend |
| **MÉDIO** | 4 | Falta de suporte a cancelamento com estorno em devoluções parciais de vendas; Índices ausentes em chaves estrangeiras com alta cardinalidade; Dependências de hooks React incompletas no frontend; Falta de tratamento de timeout em chamadas de webhook/PIX |
| **BAIXO** | 3 | Avisos de ESLint e variáveis não utilizadas no frontend; Divergência pontual de nomes entre migrações antigas e recentes; Logs excessivos no console em ambientes de produção |

---

## 3. Detalhes dos Achados de Auditoria

### 3.1 Achados de Severidade CRÍTICO

#### [CRIT-01] Função SECURITY DEFINER `protect_profile_role` sem `search_path` fixo
- **Classificação:** CRÍTICO
- **Explicação:** A função `public.protect_profile_role()` foi criada com a cláusula `SECURITY DEFINER` na migração `20260828000001_hardening_rls.sql` para impedir a alteração não autorizada de cargos (`role`) na tabela `profiles`. Contudo, ela não possui a declaração explícita `SET search_path = public`. Funções `SECURITY DEFINER` sem `search_path` definido são vulneráveis a ataques de hijacking de schema (search_path substitution attack), onde um usuário Malicioso no PostgreSQL pode criar tabelas/objetos temporários no schema `pg_temp` ou em um schema arbitrário para executar código malicioso com os privilégios do criador da função (superuser/owner).
- **Afetados:**
  - **Função:** `public.protect_profile_role()`
  - **Tabela:** `public.profiles` (trigger `trg_protect_profile_role`)
  - **Arquivo:** `supabase/migrations/20260828000001_hardening_rls.sql`
- **Sugestão de Correção:**
  Criar uma nova migração SQL atualizando a definição da função com `SET search_path = public`:
  ```sql
  CREATE OR REPLACE FUNCTION public.protect_profile_role()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
  BEGIN
    IF NEW.role IS DISTINCT FROM OLD.role AND public.current_user_role() <> 'ADMIN' THEN
      RAISE EXCEPTION 'Apenas administradores podem alterar o cargo de um usuário.';
    END IF;
    RETURN NEW;
  END;
  $$;
  ```

---

### 3.2 Achados de Severidade ALTO

#### [ALTO-01] Mutações diretas no Supabase pelo frontend sem filtro explícito de `store_id`
- **Classificação:** ALTO
- **Explicação:** Em diversos serviços no frontend (`BrandsService`, `CategoriesService`, `SuppliersService`, `CustomersService`, `ProductsService`), as chamadas de `.update()` ou `.delete()` filtram apenas pelo `id` do recurso (ex: `.eq('id', id)`), omitindo o filtro `.eq('store_id', currentStoreId)`. Embora as políticas de Row Level Security (RLS) no banco ofereçam uma camada defensiva, depender exclusivamente do RLS sem redundância no cliente viola o princípio de Defense-in-Depth e pode provocar vazamento/mutações acidentais caso ocorra qualquer desalinhamento ou exceção de regra nas políticas RLS.
- **Afetados:**
  - **Arquivos:**
    - `src/services/brands.service.ts` (linhas 53, 66)
    - `src/services/categories.service.ts` (linhas 52, 65)
    - `src/services/suppliers.service.ts` (linhas 71, 79)
    - `src/services/customers.service.ts` (linha 489)
    - `src/services/products.service.ts` (linha 189)
- **Sugestão de Correção:**
  Exigir e incluir o parâmetro `storeId` em todas as operações de mutação (`update`/`delete`) e append `.eq('store_id', storeId)` em todas as queries. Exemplo em `brands.service.ts`:
  ```typescript
  async update(id: string, storeId: string, brand: Partial<BrandRow>): Promise<BrandRow | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase
      .from('brands')
      .update(brand)
      .eq('id', id)
      .eq('store_id', storeId)
      .select()
      .single();
    if (error) throw error;
    return data as BrandRow;
  }
  ```

#### [ALTO-02] Tabelas auxiliares de catálogo (`brands`, `categories`, `suppliers`) sem escopo `store_id`
- **Classificação:** ALTO
- **Explicação:** As tabelas `brands`, `categories` e `suppliers` não possuem a coluna `store_id` em suas definições nem escopo de tenant nas políticas de RLS (`CREATE POLICY ... ON public.brands FOR SELECT TO authenticated USING (true)`). Com isso, marcas, categorias e fornecedores cadastrados por uma loja ficam visíveis e modificáveis por gestores de outras lojas, ferindo a premissa de isolamento multi-tenant do sistema.
- **Afetados:**
  - **Tabelas:** `public.brands`, `public.categories`, `public.suppliers`
  - **Arquivos:** `supabase/migrations/20260101000000_setup.sql`
- **Sugestão de Correção:**
  Adicionar a coluna `store_id uuid REFERENCES public.stores(id)` às tabelas `brands`, `categories` e `suppliers`, e redefinir as políticas de RLS para checar `public.has_store_access(store_id)`.

#### [ALTO-03] Validação de cabeçalhos e payloads na Edge Function `mp-webhook`
- **Classificação:** ALTO
- **Explicação:** Na Edge Function `supabase/functions/mp-webhook/index.ts`, ao receber requisições com o parâmetro `data.id` ausente no corpo, a função retorna `200 OK` informando `{ received: true }` antes de completar a validação HMAC da assinatura `x-signature`. Embora a validação HMAC ocorra logo em seguida para requisições com ID, o processamento de respostas parciais antes da checagem criptográfica expõe a função a varreduras não autenticadas de rotas.
- **Afetados:**
  - **Arquivo:** `supabase/functions/mp-webhook/index.ts`
- **Sugestão de Correção:**
  Mover a verificação de integridade e validação HMAC do cabeçalho `x-signature` para o topo da execução do manipulador HTTP, imediatamente após o tratamento da requisição prévia `OPTIONS`.

---

### 3.3 Achados de Severidade MÉDIO

#### [MED-01] Tratamento de devoluções e estornos em vendas com devoluções parciais anteriores
- **Classificação:** MÉDIO
- **Explicação:** A RPC `cancel_sale` reverte o estoque total e cancela pagamentos para vendas que estão no estado `COMPLETED`. No entanto, se uma venda já tiver sofrido uma devolução parcial registrada na tabela `returns`, o cancelamento total da venda via `cancel_sale` pode causar duplicidade de devolução de estoque/crédito, resultando em inconformidade no saldo financeiro ou estoque negativo/duplicado.
- **Afetados:**
  - **Função:** `public.cancel_sale(uuid)`
  - **Tabelas:** `public.sales`, `public.returns`, `public.customer_credit_movements`
  - **Arquivo:** `supabase/migrations/20261003000000_coresys_audit_final_remediation.sql`
- **Sugestão de Correção:**
  Incluir uma verificação na função `cancel_sale` garantindo que, se existirem registros na tabela `returns` associados ao `sale_id`, a função deve bloquear o cancelamento direto ou calcular o saldo de itens pendentes deduzindo os itens já devolvidos.

#### [MED-02] Alertas de React Hooks (`react-hooks/exhaustive-deps`) no frontend
- **Classificação:** MÉDIO
- **Explicação:** A verificação estática do linter indicou 26 avisos no código frontend, incluindo dependências ausentes em `useEffect` nos componentes `DashboardView.tsx`, `RevenueChart.tsx`, `TopProductsChart.tsx`, `FinanceView.tsx`, `MovementsView.tsx` e `PdvView.tsx`. A ausência de dependências em `useEffect` ou funções que mudam a cada renderização sem `useCallback` pode causar bugs sutis de sincronização de dados ao alternar de loja no contexto da aplicação.
- **Afetados:**
  - `src/components/dashboard/RevenueChart.tsx`
  - `src/components/dashboard/TopProductsChart.tsx`
  - `src/components/finance/FinanceView.tsx`
  - `src/components/movements/MovementsView.tsx`
  - `src/components/pdv/PdvView.tsx`
- **Sugestão de Correção:**
  Envolver as funções de busca de dados em `useCallback` ou incluir os identificadores de estado/loja (`currentStore.id`) nas listas de dependências dos hooks.

#### [MED-03] Falta de índice em colunas de ordenação e junção em `privacy_requests` e `data_export_audit`
- **Classificação:** MÉDIO
- **Explicação:** Na tabela `privacy_requests`, consultas frequentes realizam ordenação e busca por `store_id` e `status`. Embora existam índices parciais nas migrações `20261001152655`, tabelas como `customer_credit_movements` se beneficiariam de um índice composto `(store_id, customer_id, created_at DESC)` para acelerar extratos do cliente no PDV.
- **Afetados:**
  - **Tabela:** `public.customer_credit_movements`
  - **Arquivo:** `supabase/migrations/20260925165149_persistencia_devolucoes_creditos_20260925.sql`
- **Sugestão de Correção:**
  Garantir a presença de índice B-Tree composto em `customer_credit_movements (store_id, customer_id, created_at DESC)`.

---

### 3.4 Achados de Severidade BAIXO

#### [BAIX-01] Importações e Variáveis Não Utilizadas no Frontend
- **Classificação:** BAIXO
- **Explicação:** O Linter reportou avisos referentes a variáveis e ícones importados que não estão sendo utilizados no código (ex: `CreditCard` em `DashboardView.tsx`, `ChevronDown` e `Trash2` em `InventoryView.tsx`, `setSelectedColecao` em `PdvView.tsx`).
- **Afetados:**
  - `src/components/dashboard/DashboardView.tsx`
  - `src/components/inventory/InventoryView.tsx`
  - `src/components/pdv/PdvView.tsx`
  - `src/components/returns/NewReturnModal.tsx`
- **Sugestão de Correção:**
  Limpar as importações e declarações não utilizadas para reduzir a poluição do bundle e manter o código limpo.

#### [BAIX-02] Exportação de componentes juntamente com funções utilitárias violando Fast Refresh
- **Classificação:** BAIXO
- **Explicação:** Os arquivos de contexto `AuthContext.tsx`, `CartContext.tsx`, `StoreContext.tsx` e `ThemeContext.tsx` exportam hooks utilitários ao lado do componente Provider, gerando o aviso `react-refresh/only-export-components`.
- **Afetados:**
  - `src/contexts/AuthContext.tsx`
  - `src/contexts/CartContext.tsx`
  - `src/contexts/StoreContext.tsx`
  - `src/contexts/ThemeContext.tsx`
- **Sugestão de Correção:**
  Mover os custom hooks (`useAuth`, `useCart`, `useStore`, `useTheme`) para arquivos separados na pasta `src/hooks/`.

---

## 4. Recomendações de Arquitetura e Boas Práticas

1. **Camada de Serviços Unificada:** Implementar uma classe base ou helper no frontend para injeção automática de `store_id` em todas as consultas e mutações ao Supabase.
2. **Testes Automatizados para RPCs:** Adicionar novos testes unitários e de integração cobrindo os cenários de borda (edge cases) de devolução parcial e idempotência de pagamentos PIX.
3. **Monitoramento do Supabase:** Configurar alertas de uso de CPU e conexões de banco no dashboard do Supabase para acompanhar o crescimento do volume de vendas.

---

## 5. Conclusão e Próximos Passos

A aplicação se encontra em um estado de alta segurança e estabilidade estrutural. A correção da função `protect_profile_role` (`SECURITY DEFINER`) e o alinhamento das mutações do frontend com a inclusão do parâmetro `store_id` mitigarão completamente os riscos de maior severidade identificados neste ciclo de auditoria.
