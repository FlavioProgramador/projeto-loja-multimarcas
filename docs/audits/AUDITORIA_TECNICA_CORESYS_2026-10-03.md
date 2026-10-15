# Relatório de Auditoria Técnica Diária — CoreSys (Vestra ERP/PDV)

**Data:** 2026-10-03
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Responsável:** Engenharia de Software Sênior (Auditoria CoreSys)
**Status do Projeto:** 0 Erros de Compilação / 0 Falhas nos Testes Automatizados (39/39 executados com sucesso) / 26 Warnings de Linting

---

## 1. Resumo Executivo

Nesta auditoria técnica diária, realizamos uma varredura completa no código-fonte frontend (`src/`), nas rotinas de banco/migrations (`supabase/migrations/`), funções de borda (`supabase/functions/`) e nas regras de isolamento multi-tenant do CoreSys.

O sistema demonstra avanços significativos com a implementação das migrations recentes de hardening em 2026-10-03 (`20261003000000_coresys_audit_final_remediation.sql`), assegurando que RPCs críticas como `complete_sale`, `create_mp_pix_sale` e `cancel_sale` operem de forma atômica e com revogação de acessos legados.

Entretanto, foram identificados **pontos críticos de vazamento de dados multi-tenant no frontend e na camada de métricas do Dashboard**, além de **riscos de concorrência em checkout**, **consultas sem paginação** e **persistência inadequada em `localStorage`**.

---

## 2. Detalhamento dos Achados por Severidade

### 🔴 CRÍTICO

#### 1. Quebra do Isolamento Multi-Tenant na Consulta de Métricas do Dashboard
- **Severidade:** CRÍTICO
- **Explicação:** A função `DashboardService.getMetrics()` em `src/services/dashboard.service.ts` executa consultas no Supabase para buscar vendas (`sales`) e variações com baixo estoque (`product_variants`) sem aplicar o filtro de escopo por loja (`.eq('store_id', storeId)`). Como consequência, as métricas e alertas exibidos no Dashboard consolidam informações de todas as lojas do banco que o usuário autenticado consiga visualizar via RLS, violando o isolamento multi-tenant.
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivo: `src/services/dashboard.service.ts`
  - Tabelas: `sales`, `product_variants`
  - Função/Método: `DashboardService.getMetrics()`
- **Sugestão de Correção:**
  Atualizar a assinatura do método para `getMetrics(storeId: string)` e incluir obrigatoriamente `.eq('store_id', storeId)` na busca de vendas e na checagem de estoque por loja (`store_inventory`).

#### 2. Persistence e Bleeding de Dados Multi-Tenant no LocalStorage
- **Severidade:** CRÍTICO
- **Explicação:** No `StoreContext.tsx` e em diversos hooks de domínio, produtos, fornecedores e despesas são salvos no `localStorage` sob chaves genéricas (`erp_products`, `erp_suppliers`, `erp_fixed_expenses`, `erp_notifications`). As chaves não incorporam o `store_id` nem o `user_id`. Se um usuário alternar de loja ou se outro usuário fizer login no mesmo navegador, o estado mantido em cache local pode ser renderizado incorretamente ou expor dados de um tenant para outro offline.
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivos: `src/contexts/StoreContext.tsx`, `src/hooks/domains/useProductsDomain.ts`
  - Armazenamento: `window.localStorage`
- **Sugestão de Correção:**
  Garantir que todas as chaves do `localStorage` utilizem o identificador da loja e usuário (ex.: `erp_${userId}_${activeStoreId}_products`) e forçar a limpeza total do `localStorage` no evento de logout ou de troca de tenant ativo.

---

### 🟠 ALTO

#### 3. Consultas e Mutações de Marcas e Categorias sem Filtro por Tenant
- **Severidade:** ALTO
- **Explicação:** Em `brands.service.ts` e `categories.service.ts`, os métodos de busca e alteração de marcas e categorias executam seleções e inserções diretas no banco sem validar se pertencem ao tenant ativo. Em organizações onde marcas/categorias sejam segmentadas por loja, usuários podem visualizar ou modificar registros de outros tenants.
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivos: `src/services/brands.service.ts`, `src/services/categories.service.ts`
  - Tabelas: `brands`, `categories`
- **Sugestão de Correção:**
  Exigir `storeId` em todas as chamadas de serviços de catálogo e aplicar a restrição de tenant na query Supabase `.eq('store_id', storeId)`.

#### 4. Risco de Duplo Envio (Race Condition) no Checkout do PDV
- **Severidade:** ALTO
- **Explicação:** No componente `PdvView.tsx`, ao acionar o atalho `F4` ou clicar repetidamente no botão "Finalizar Venda", a função `handleConfirmSale` é disparada. Embora o backend utilize chaves de idempotência na RPC `complete_sale`, a interface do usuário não desabilita os botões/atalhos imediatamente antes de iniciar a requisição assíncrona, abrindo margem para requisições concorrentes duplas no canal de rede.
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivo: `src/components/pdv/PdvView.tsx`
  - Função/Método: `handleConfirmSale`, `handleOpenCheckout`
- **Sugestão de Correção:**
  Adicionar um estado `isSubmitting` no componente `PdvView` que bloqueie os atalhos de teclado e desabilite o botão de checkout durante todo o ciclo de vida da promessa.

#### 5. Consultas Ilimitadas de Histórico no Frontend (Risco de Performance/OOM)
- **Severidade:** ALTO
- **Explicação:** Múltiplas funções em `sales.service.ts`, `inventory.service.ts` e `suppliers.service.ts` realizam consultas com `.select()` sem `.range()` ou `.limit()`. Em lojas em produção com milhares de registros de vendas e movimentações, isso causará lentidão extrema na renderização do navegador e estouro de memória no cliente.
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivos: `src/services/sales.service.ts`, `src/services/inventory.service.ts`, `src/services/suppliers.service.ts`
  - Tabelas: `sales`, `inventory_movements`, `suppliers`
- **Sugestão de Correção:**
  Forçar paginação obrigatória via RPC ou limitar resultados para no máximo 50 a 100 itens em listagens do cliente.

---

### 🟡 MÉDIO

#### 6. Inconsistência de Mapeamento de Formatos de Pagamento entre PDV e Backend
- **Severidade:** MÉDIO
- **Explicação:** O PDV envia métodos de pagamento como `'Cartão'`, `'PIX'`, ou `'Dinheiro'`, enquanto visões do Dashboard e relatórios financeiros dependem de identificadores enums `'CREDIT_CARD'`, `'DEBIT_CARD'`, `'CASH'` e `'PIX'`. A conversão ocorre parcialmente nas RPCs, mas em algumas telas de filtragem do frontend ocorrem divergências na exibição.
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivos: `src/components/pdv/PdvView.tsx`, `src/components/dashboard/DashboardView.tsx`
- **Sugestão de Correção:**
  Unificar os enums de meio de pagamento em uma constante e tipo compartilhados em `src/types/database.ts`.

#### 7. Acúmulo de Warnings de Linter, Hook Dependencies e Dependências Mortas
- **Severidade:** MÉDIO
- **Explicação:** A execução do `eslint` revelou 26 avisos no projeto, incluindo dependências ausentes nos hooks `useEffect` de gráficos (`RevenueChart.tsx` e `TopProductsChart.tsx`) e do PDV (`PdvView.tsx`). Adicionalmente, o `package.json` possui dependências não utilizadas como `express` e `@google/genai`.
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivo: `package.json`
  - Arquivos de componentes: `RevenueChart.tsx`, `TopProductsChart.tsx`, `PdvView.tsx`, `FinanceView.tsx`
- **Sugestão de Correção:**
  Remover os pacotes mortos do `package.json` e envolver funções de efeito em `useCallback` ou ajustar os arrays de dependência do `useEffect`.

---

### 🟢 BAIXO

#### 8. Instabilidade de IDs Numéricos Sintéticos no Mapeamento de Listas
- **Severidade:** BAIXO
- **Explicação:** Serviços no frontend (`products.service.ts`, `customers.service.ts`, `sales.service.ts`) geram IDs sintéticos baseados no índice do array (`index + 1`). Ao filtrar ou reordenar listagens, a propriedade `id` é alterada, provocando perda de estado interno e re-renderizações desnecessárias em listas do React.
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivos: `src/services/products.service.ts`, `src/services/customers.service.ts`, `src/services/sales.service.ts`
- **Sugestão de Correção:**
  Utilizar sempre o identificador estável `uuid` como propriedade principal e chave das listas React (`key={item.uuid}`).

---

## 3. Matriz de Severidade e Priorização

| ID | Item | Severidade | Categoria | Esforço de Correção |
|---|---|---|---|---|
| 1 | Escopo de loja ausente em `DashboardService.getMetrics` | **CRÍTICO** | Multi-tenant / Segurança | Baixo (1h) |
| 2 | Cache em `localStorage` sem escopo de tenant | **CRÍTICO** | Multi-tenant / Privacidade | Médio (2h) |
| 3 | Mutações de Marcas/Categorias sem `store_id` | **ALTO** | Multi-tenant / Integridade | Baixo (1h) |
| 4 | Trava de UI contra checkout duplo no PDV | **ALTO** | Concorrência / Funcional | Baixo (1h) |
| 5 | Consultas ilimitadas no frontend sem paginação | **ALTO** | Performance / Banco | Médio (3h) |
| 6 | Inconsistência de enums de pagamento | **MÉDIO** | Integridade / UI | Baixo (1h) |
| 7 | Limpeza de Linter warnings e pacotes mortos | **MÉDIO** | Qualidade de Código | Baixo (1h) |
| 8 | Substituição de IDs numéricos sintéticos por UUIDs | **BAIXO** | Arquitetura / React | Baixo (1h) |

---

## 4. Recomendações e Próximos Passos

1. **Aprovação do Plano de Ação:** Submeter as correções dos itens **CRÍTICOS** e **ALTOS** em um PR dedicado para homologação.
2. **Homologação Multi-Tenant:** Testar acessos simultâneos de dois usuários pertencentes a lojas distintas para confirmar o isolamento completo de métricas e cache.
3. **Manutenção de Suíte de Testes:** Manter a rotina de execução de `npm run test:all` antes de cada publicação.
