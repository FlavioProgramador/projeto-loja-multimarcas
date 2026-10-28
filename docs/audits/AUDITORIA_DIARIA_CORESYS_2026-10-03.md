# Relatório de Auditoria Técnica Diária do CoreSys — 2026-10-03

**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Auditor:** Engenheiro de Software Sênior (CoreSys)
**Data:** 03 de Outubro de 2026

---

## 1. Resumo Executivo

Esta auditoria técnica diária avaliou a integridade do CoreSys (ERP/PDV multi-tenant baseado em React, TypeScript e Supabase PostgreSQL), cobrindo a arquitetura de dados, funções RPC, Edge Functions, RLS, serviços de frontend, performance e conformidade com as regras de negócio multi-tenant.

As correções recentes de reconciliação de páginas de devolução e financeiro (fase 25c e hardening final) endureceram significativamente as RPCs e políticas RLS. Contudo, foram identificados pontos de atenção e inconsistências funcionais, de isolamento multi-tenant e de performance que demandam remedição.

---

## 2. Matriz de Achados e Severidades

---

### ACHADO 1: Falha no Fallback de Criação Direct-Insert de Produto com `cost_price` sem Isolamento Multi-Tenant
- **Severidade:** ALTO
- **Explicação:**
  No serviço `InventoryService.registerStockEntry` (`src/services/inventory.service.ts`), ao dar entrada de estoque em um produto inexistente, o código realiza inserção direta na tabela `products` incluindo a coluna `cost_price` e inserindo em `brands` e `categories` sem passar por RPC e sem vincular ao contexto da loja.
  1. A coluna `cost_price` possui privilégios de gravação restritos/revogados para papéis operacionais, fazendo com que a chamada de insert direto falhe com erro `42501 (permission denied)`.
  2. A criação de novos produtos deve obrigatoriamente utilizar a RPC `manage_product` para manter a consistência de variações, preços de custo/venda e auditoria.
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivo: `src/services/inventory.service.ts` (função `registerStockEntry`)
  - Tabelas: `public.products`, `public.brands`, `public.categories`
- **Sugestão de Correção:**
  Refatorar `InventoryService.registerStockEntry` para remover o fallback de `insert` direto em `products`. Toda criação de produto deve delegar exclusivamente para `ProductsService.create` ou para a RPC `manage_product`.

---

### ACHADO 2: Ausência de Escopo `store_id` na Tabela de Fornecedores (`suppliers`)
- **Severidade:** MÉDIO
- **Explicação:**
  A tabela `public.suppliers` e a API `SuppliersService.getAll()` (`src/services/suppliers.service.ts`) não possuem coluna `store_id` nem filtro por tenant.
  Fornecedores cadastrados por uma loja ficam visíveis globalmente para todas as lojas do sistema. Se o modelo de negócio exigir que o catálogo de fornecedores seja isolado por loja (ou compartilhado por grupo de lojas explicitamente), a estrutura atual expõe dados cadastrais de fornecedores (CNPJ, e-mail, contato, endereço) entre inquilinos.
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivo: `src/services/suppliers.service.ts`
  - Tabela: `public.suppliers`
- **Sugestão de Correção:**
  1. Adicionar a coluna `store_id UUID REFERENCES public.stores(id)` à tabela `suppliers` via migração.
  2. Atualizar as políticas RLS de `suppliers` para restrigir leitura e modificação ao escopo de `has_store_access(store_id)`.
  3. Atualizar `SuppliersService` para repassar `storeId` em todas as consultas e mutações.

---

### ACHADO 3: Ineficiência de Performance e Carga de Memória em `ProductsService.getAll` (Filtro In-Memory de Multi-Loja)
- **Severidade:** MÉDIO
- **Explicação:**
  O método `ProductsService.getAll(storeId)` (`src/services/products.service.ts`) realiza um `.from('products').select(...)` buscando **todos** os produtos, variações e registros de estoque do banco de dados, para somente depois filtrar em memória via JavaScript (`.filter(product => product.product_variants?.some(...))`).
  Em lojas com catálogos grandes (milhares de SKUs), esta query faz download desnecessário de todo o banco de produtos para o cliente frontend, consumindo banda, aumentando a latência e correndo risco de estouro de memória no navegador.
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivo: `src/services/products.service.ts` (função `getAll`)
  - Tabela/Visão: `public.products`, `public.store_inventory`
- **Sugestão de Correção:**
  1. Adicionar filtro `.eq('product_variants.store_inventory.store_id', storeId)` na query do Supabase ou utilizar uma RPC/View paginada no servidor.
  2. Implementar paginação no servidor para o catálogo de produtos no frontend.

---

### ACHADO 4: Ausência de Limite/Paginação em `InventoryService.getMovements`
- **Severidade:** MÉDIO
- **Explicação:**
  A função `InventoryService.getMovements(storeId)` (`src/services/inventory.service.ts`) executa a consulta na tabela `inventory_movements` ordenando por `created_at DESC` sem definir `.limit()` ou `.range()`.
  À medida que o histórico de movimentações da loja cresce, o componente `MovementsView` tentará carregar centenas de milhares de linhas em uma única requisição.
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivo: `src/services/inventory.service.ts` (função `getMovements`)
  - Tabela: `public.inventory_movements`
- **Sugestão de Correção:**
  Adicionar parâmetro de paginação (ou limite padrão de ex: 100 registros) em `InventoryService.getMovements` e conectar a UI de movimentações à paginação.

---

### ACHADO 5: `SalesService.getMovements` Permite Parâmetro `storeId` Opcional
- **Severidade:** MÉDIO
- **Explicação:**
  A assinatura da função `SalesService.getMovements(storeId?, period?)` (`src/services/sales.service.ts`) permite a chamada sem `storeId`. Quando chamada sem `storeId`, a query Supabase é montada sem a instrução `.eq('store_id', storeId)`.
  Embora o RLS limite os dados se a política estiver ativa, a API do serviço frontend deve ser estritamente *fail-closed*, exigindo `storeId` obrigatório para evitar vazamento acidental de consultas entre lojas.
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivo: `src/services/sales.service.ts` (função `getMovements`)
- **Sugestão de Correção:**
  Tornar `storeId` um parâmetro obrigatório (`storeId: string`) em `SalesService.getMovements`. Se `storeId` for nulo ou vazio, retornar array vazio imediatamente sem efetuar chamada ao Supabase.

---

### ACHADO 6: Mutação de Cliente (`CustomersService.update/remove`) e Fornecedor (`SuppliersService.update/remove`) sem `store_id` Explícito no Filtro
- **Severidade:** BAIXO
- **Explicação:**
  Em `CustomersService.update(uuid, customer)` e `CustomersService.remove(uuid)`, a instrução executada é `.from('customers').update(payload).eq('id', uuid)`. O parâmetro `store_id` não é incluído no trecho `.eq('store_id', storeId)`.
  Embora a política RLS do banco de dados bloqueie a alteração caso o usuário não tenha acesso à loja do cliente, incluir `store_id` no filtro `.eq('store_id', storeId)` fornece proteção *defense-in-depth* contra requisições IDOR/BOLA e evita mutações acidentais de clientes com UUIDs conflitantes.
- **Arquivos/Tabelas/Funções Afetados:**
  - Arquivos: `src/services/customers.service.ts`, `src/services/suppliers.service.ts`
  - Tabelas: `public.customers`, `public.suppliers`
- **Sugestão de Correção:**
  Exigir `storeId: string` como parâmetro em `CustomersService.update`, `CustomersService.remove`, `SuppliersService.update` e `SuppliersService.remove` e incluir `.eq('store_id', storeId)` nas consultas.

---

### ACHADO 7: Avisos de Linter (ESLint) em Componentes de Dashboard, PDV e Finanças
- **Severidade:** BAIXO
- **Explicação:**
  A verificação de linter (`npm run lint`) aponta 26 avisos (0 erros) relacionados a variáveis não utilizadas, dependências ausentes no array do `useEffect` e exportação de constantes em arquivos de contexto (React Fast Refresh).
  Embora não quebrem a compilação, Hooks com dependências ausentes (ex: `useEffect` em `PdvView.tsx`, `FinanceView.tsx`, `RevenueChart.tsx`) podem causar re-renders infinitos ou bugs de estado desatualizado durante a navegação entre lojas.
- **Arquivos/Tabelas/Funções Afetados:**
  - `src/components/pdv/PdvView.tsx`
  - `src/components/finance/FinanceView.tsx`
  - `src/components/dashboard/RevenueChart.tsx`
  - `src/components/dashboard/TopProductsChart.tsx`
  - `src/components/movements/MovementsView.tsx`
- **Sugestão de Correção:**
  Corrigir os arrays de dependência dos hooks `useEffect` utilizando `useCallback` ou incluindo as funções de carregamento no escopo correto, e remover as variáveis importadas não utilizadas.

---

## 3. Resumo da Classificação por Severidade

| Severidade | Quantidade | Principais Focos |
| :--- | :---: | :--- |
| **CRÍTICO** | 0 | Nenhum bloqueador crítico de segurança ou vazamento de dados detectado nesta auditoria. |
| **ALTO** | 1 | Fallback de criação direta de produtos com `cost_price` em `InventoryService.registerStockEntry`. |
| **MÉDIO** | 4 | Tabela `suppliers` sem escopo multi-tenant; Carga em memória desnecessária em `ProductsService.getAll`; Ausência de limite/paginação em `getMovements`; Parâmetro `storeId` opcional em `SalesService.getMovements`. |
| **BAIXO** | 2 | Ausência de `store_id` explícito nas mutações de clientes/fornecedores; Avisos de linter e dependências de `useEffect`. |

---

## 4. Próximos Passos Recomendados

1. **Prioridade 1 (Imediata):** Corrigir `InventoryService.registerStockEntry` para remover o `insert` direto em `products` com `cost_price`.
2. **Prioridade 2 (Multi-Tenant & Performance):** Adicionar `store_id` à tabela `suppliers` e refatorar `ProductsService.getAll` para usar paginação e filtragem server-side.
3. **Prioridade 3 (Qualidade de Código):** Limpar os avisos de ESLint e garantir que `storeId` seja obrigatório em todas as assinaturas de serviços.
