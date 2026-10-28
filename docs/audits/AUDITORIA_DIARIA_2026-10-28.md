# 📊 RELATÓRIO DE AUDITORIA TÉCNICA DIÁRIA - CORESYS
**Data:** 28 de outubro de 2026
**Responsável:** Engenharia de Software Sênior (CoreSys Auditor)
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Status da Auditoria:** Concluído — Achados Catalogados (Sem Alterações Automáticas de Código/Banco)

---

## 🎯 Resumo Executivo

A auditoria técnica diária analisou a integridade do código-fonte frontend (React 19 + TypeScript + Vite), backend (Supabase Edge Functions + PostgreSQL + PL/pgSQL + RLS) e a arquitetura multi-tenant do CoreSys.

### Indicadores Gerais de Prontidão

| Métrica | Situação |
| :--- | :--- |
| **Isolamento Multi-tenant no PDV / Vendas / Clientes** | ✅ Protegido via RPCs e RLS (`store_id` obrigatório) |
| **Integridade e Idempotência de Vendas (PDV / PIX)** | ✅ Garantido com trava aditiva (`pg_advisory_xact_lock`) e tabela `sale_idempotency` |
| **Segurança das Funções SECURITY DEFINER Críticas** | ✅ `search_path = public` e checagem de role *fail-closed* ativas (`complete_sale`, `cancel_sale`, `create_mp_pix_sale`) |
| **Qualidade / Linter Frontend** | ⚠️ 26 avisos de ESLint (variáveis não utilizadas e dependências de React Hooks) |
| **Vazamento de Métricas Multi-tenant (DashboardService)** | 🔴 **CRÍTICO** - Consulta legada de métricas globais sem filtro de `store_id` |

---

## 📋 Catalogação de Problemas por Severidade

---

### 🔴 1. CRÍTICO (Critical)

#### **[CRÍTICO-01] Vazamento Potencial de Métricas Multi-tenant no `DashboardService`**
- **Explicação do Problema:**
  O método `DashboardService.getMetrics()` na camada de serviço realiza consultas diretas às tabelas `sales` e `product_variants` sem aplicar o filtro obrigatorio `.eq('store_id', storeId)`. Caso esse serviço seja reaproveitado ou acionado diretamente por componentes ou rotas de relatórios, o sistema exibirá métricas de faturamento e contagem de vendas acumuladas de todas as lojas do banco de dados, violando o isolamento estrito entre inquilinos.
- **Arquivos / Tabelas / Funções Afetados:**
  - Arquivo: `src/services/dashboard.service.ts`
  - Função: `DashboardService.getMetrics()`
  - Tabelas: `public.sales`, `public.product_variants`
- **Sugestão de Correção:**
  Exigir `storeId: string` como argumento obrigatório da função e estender todas as consultas com `.eq('store_id', storeId)`. Para a verificação de estoque baixo, a consulta deve filtrar `store_inventory` pela loja ativa do usuário logado.

---

### 🟠 2. ALTO (High)

#### **[ALTO-01] Falta de Atomicidade na Criação de Produto com Estoque Inicial no Frontend**
- **Explicação do Problema:**
  Em `useProductsDomain.ts`, ao cadastrar um novo produto com estoque inicial, o frontend faz uma chamada RPC inicial `ProductsService.create` e, em seguida, executa um loop no lado do cliente chamando `InventoryService.registerStockEntry` para cada variação de SKU. Se ocorrer uma falha de conexão ou erro no banco durante o loop de inserção do segundo ou terceiro SKU, o produto permanece cadastrado no Supabase com estoque parcial, gerando estado inconsistente e sem suporte a rollback atômico.
- **Arquivos / Tabelas / Funções Afetados:**
  - Arquivos: `src/hooks/domains/useProductsDomain.ts`, `src/services/inventory.service.ts`
  - Função: `useProductsDomain -> addProduct`
  - Tabela/RPC: `products`, `product_variants`, `store_inventory`, RPC `manage_product`
- **Sugestão de Correção:**
  Evoluir a RPC `manage_product` no Supabase para que ela receba a quantidade e o custo inicial de cada variação como parte do parâmetro JSON `p_variants`, executando toda a criação e movimentação de estoque inicial em uma única transação atômica (`BEGIN ... COMMIT`).

#### **[ALTO-02] E-mail do Pagador Hardcoded (`financeiro@coresys.com.br`) na Integração Mercado Pago**
- **Explicação do Problema:**
  Na Edge Function `create-mp-pix` (`supabase/functions/create-mp-pix/index.ts`), o payload enviado à API do Mercado Pago fixa estaticamente `payer.email = 'financeiro@coresys.com.br'`. Com isso, recibos de pagamento, confirmações PIX e comunicações oficiais do gateway de pagamento são enviados para uma caixa postal interna centralizada em vez do e-mail do comprador ou da loja responsável.
- **Arquivos / Tabelas / Funções Afetados:**
  - Arquivo: `supabase/functions/create-mp-pix/index.ts`
  - Objeto / Propriedade: `mpPayload.payer.email`
- **Sugestão de Correção:**
  Receber e validar o e-mail do comprador no corpo da requisição (`customerEmail`), utilizando um e-mail dinâmico válido do cliente ou o e-mail configurado na loja de origem.

---

### 🟡 3. MÉDIO (Medium)

#### **[MÉDIO-01] Código Morto e Retenção de Fallbacks Legados Não Utilizados**
- **Explicação do Problema:**
  O arquivo `src/services/dashboard.service.ts` tornou-se código morto (dead code), pois o componente `DashboardView.tsx` realiza todos os cálculos de KPIs no lado do cliente diretamente do `StoreContext`. Adicionalmente, os serviços `CustomersService`, `ReturnsService` e `FinanceService` mantêm blocos extensos de código de *fallback* para buscar todos os registros e filtrar no cliente quando a RPC de paginação do servidor não está presente, o que infla o bundle e aumenta o custo de manutenção.
- **Arquivos / Tabelas / Funções Afetados:**
  - Arquivos: `src/services/dashboard.service.ts`, `src/services/customers.service.ts`, `src/services/returns.service.ts`, `src/services/finance.service.ts`
- **Sugestão de Correção:**
  Remover o arquivo `dashboard.service.ts` ou integrá-lo a uma visão consolidada de métricas do servidor, e refatorar os serviços para dependerem exclusivamente das RPCs de paginação server-side já implementadas.

#### **[MÉDIO-02] Desativação Lógica de Produtos Efetuada via Direct Update sem Validação de Escopo por Loja**
- **Explicação do Problema:**
  Em `src/services/products.service.ts`, a função `ProductsService.remove(uuid)` altera diretamente a tabela `products` definindo `is_active = false`. Como um mesmo produto pode ter variações em múltiplos inventários de loja, a desativação direta na tabela `products` afeta o produto globalmente sem verificar se a intenção do gestor da loja A era remover apenas o vínculo no inventário da sua loja.
- **Arquivos / Tabelas / Funções Afetados:**
  - Arquivo: `src/services/products.service.ts`
  - Função: `ProductsService.remove()`
  - Tabela: `public.products`
- **Sugestão de Correção:**
  Substituir a atualização direta por uma RPC dedicada (`remove_store_product`), desativando apenas o registro de inventário referente à loja ativa (`store_inventory.is_active = false`) ou marcando o produto como inativo apenas se ele não possuir estoque ativo em nenhuma outra loja.

---

### 🟢 4. BAIXO (Low)

#### **[BAIXO-01] Avisos do Linter (26 warnings de ESLint no Frontend)**
- **Explicação do Problema:**
  A execução do `npm run lint` reporta 26 avisos referentes a variáveis e ícones importados e não utilizados (como `CreditCard`, `ChevronDown`, `Trash2`, `StockStatus`, `AlertCircle`, etc.), além de arrays de dependências incompletos em Hooks `useEffect` (`RevenueChart`, `TopProductsChart`, `FinanceView`, `MovementsView`, `PdvView`).
- **Arquivos / Tabelas / Funções Afetados:**
  - Arquivos: `DashboardView.tsx`, `RevenueChart.tsx`, `TopProductsChart.tsx`, `FinanceView.tsx`, `InventoryView.tsx`, `MovementsView.tsx`, `PdvView.tsx`, `NewReturnModal.tsx`, `SupplierForm.tsx`, `AuthContext.tsx`, `CartContext.tsx`, `StoreContext.tsx`, `ThemeContext.tsx`, `store.service.ts`
- **Sugestão de Correção:**
  Remover as variáveis e importações não utilizadas e corrigir as dependências dos Hooks ou envelopar funções de efeito com `useCallback`.

---

## 🔍 Recomendações de Ação Priorizada (Roadmap de Correção)

1. **Imediato (P0 - Hoje):**
   - Corrigir a parametrização de `DashboardService` ou removê-lo se mantido desuso.
   - Ajustar o envio do e-mail dinâmico do pagador na Edge Function `create-mp-pix`.
2. **Curto Prazo (P1 - Esta Semana):**
   - Refatorar a criação de produtos com estoque em `useProductsDomain` para uma chamada RPC atômica única no Supabase.
   - Implementar a RPC de desativação scoped de produtos por loja.
3. **Manutenção e Qualidade (P2):**
   - Limpar avisos do linter ESLint (`npm run lint`).
   - Remover fallbacks legados dos serviços para simplificar a base de código.

---
**Relatório gerado e verificado sem alterações destrutivas na árvore de trabalho.**
