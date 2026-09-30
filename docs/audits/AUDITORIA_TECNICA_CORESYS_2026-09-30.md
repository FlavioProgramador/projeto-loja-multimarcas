# Relatório de Auditoria Técnica Diária - CoreSys
**Data:** 30 de Setembro de 2026
**Responsável:** Engenheiro de Software Sênior (Auditoria Técnica CoreSys)
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`

---

##  EXECUTIVE SUMMARY / RESUMO EXECUTIVO

Foi realizada uma auditoria técnica completa e minuciosa no repositório **CoreSys / Vestra ERP & PDV**, abrangendo o código fonte do Frontend (React/TypeScript), Serviços, Contextos, Funções Serverless Edge Functions (Deno), Migrações do PostgreSQL/Supabase, Políticas de Segurança em Nível de Linha (RLS), Funções com `SECURITY DEFINER` e Estruturas da Arquitetura Multi-Tenant.

Nesta etapa de auditoria, **nenhuma alteração automática de código de produção ou banco de dados foi executada**, conforme diretrizes.

Abaixo estão registrados os achados classificados categoricamente por severidade.

---

## 1. ACHADOS DE SEVERIDADE: CRÍTICO

### 1.1 Incompatibilidade de Schema no Banco: Tabela `customers` sem Coluna `store_id`
* **Severidade:** CRÍTICO
* **Arquivos / Tabelas Afetados:**
  * Tabela: `public.customers`
  * Frontend Services: `src/services/customers.service.ts`
  * Frontend Context: `src/contexts/StoreContext.tsx`
* **Explicação do Problema:**
  O serviço de clientes no frontend (`CustomersService.getAll`) executa a consulta `supabase.from('customers').select(...).eq('store_id', storeId)` e o método `create` tenta inserir `{ store_id: storeId, name: ... }`. No entanto, a tabela `customers` (criada em `20260101000000_setup.sql` e atualizada em migrações subsequentes) **não possui a coluna `store_id`**.
  Quando qualquer operação de listagem ou cadastro de clientes é executada no ambiente conectado ao Supabase, o banco de dados PostgreSQL retorna um erro fatal de execução (`column customers.store_id does not exist`), quebrando a funcionalidade do módulo de CRM/Clientes e causando falha silenciosa ou exceção unhandled na UI.
* **Sugestão de Correção:**
  1. Criar uma nova migração SQL (`20261001000000_add_store_id_to_customers.sql`) adicionando a coluna `store_id UUID REFERENCES public.stores(id)` à tabela `customers` com índice apropriado (`CREATE INDEX idx_customers_store_id ON public.customers(store_id)`).
  2. Ajustar as políticas RLS da tabela `customers` para restringir `SELECT`, `INSERT`, `UPDATE` e `DELETE` ao escopo da loja ativa do usuário autenticado usando `has_store_access(store_id)`.

---

### 1.2 Erro de Escopo de Variável `xRequestId` no Bloco `catch` em `mp-webhook`
* **Severidade:** CRÍTICO
* **Arquivos / Funções Afetados:**
  * Edge Function: `supabase/functions/mp-webhook/index.ts` (Linhas 33 e 178)
* **Explicação do Problema:**
  Na Edge Function do Mercado Pago (`mp-webhook`), a constante `xRequestId` é declarada com escopo de bloco dentro da instrução `try`:
  ```ts
  try {
    ...
    const xRequestId = req.headers.get('x-request-id');
    ...
  } catch (error: unknown) {
    await supabase.rpc('fail_mp_webhook_event', {
      p_request_id: xRequestId, // <--- ReferenceError aqui!
      p_error: 'Webhook processing failed'
    });
  }
  ```
  Caso qualquer exceção ocorra dentro do bloco `try`, a execução salta para o bloco `catch`. Como `xRequestId` possui escopo restrito ao bloco `try`, o acesso a essa variável dentro do `catch` lança uma exceção JavaScript unhandled: `ReferenceError: xRequestId is not defined`.
  Isso faz com que o tratamento de erro da Edge Function falhe completamente, impedindo que o evento seja marcado como falho via `fail_mp_webhook_event` e derrubando o worker do Deno.
* **Sugestão de Correção:**
  Declarar `let xRequestId: string | null = null;` no escopo da função, fora do bloco `try`, atribuindo `xRequestId = req.headers.get('x-request-id');` dentro do handler, garantindo que a variável esteja sempre visível e acessível no bloco `catch`.

---

## 2. ACHADOS DE SEVERIDADE: ALTO

### 2.1 Função Trigger `protect_profile_role` Definida como `SECURITY DEFINER` sem `SET search_path = public`
* **Severidade:** ALTO
* **Arquivos / Funções Afetados:**
  * Migração: `supabase/migrations/20260828000001_hardening_rls.sql`
  * Função: `public.protect_profile_role()`
* **Explicação do Problema:**
  A função `protect_profile_role()` é executada como trigger antes de updates na tabela `profiles` para impedir escalonamento não autorizado de papéis (`role`). A função está declarada como `SECURITY DEFINER`, contudo **não possui a cláusula `SET search_path = public, pg_temp`**.
  Em PostgreSQL, funções `SECURITY DEFINER` sem um `search_path` fixo e seguro são vulneráveis a ataques de sequestro de caminho de busca (Search Path Hijacking / Privilege Escalation), permitindo que usuários maliciosos autenticados executem código arbitrário com os privilégios do proprietário da função.
* **Sugestão de Correção:**
  Criar nova migração redefinindo a função com a instrução explícita de segurança:
  ```sql
  CREATE OR REPLACE FUNCTION public.protect_profile_role()
  RETURNS TRIGGER AS $$
  BEGIN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      IF public.current_user_role() != 'ADMIN' THEN
        RAISE EXCEPTION 'Acesso negado: Apenas administradores podem alterar papéis.';
      END IF;
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
  ```

---

### 2.2 Riscos de IDOR / BOLA em Mutações Diretas no Frontend Sem Validação de `store_id`
* **Severidade:** ALTO
* **Arquivos / Serviços Afetados:**
  * `src/services/customers.service.ts` (Linha 151)
  * `src/services/products.service.ts` (Linha 189)
  * `src/services/suppliers.service.ts` (Linha 71)
  * `src/services/finance.service.ts` (Linha 70)
* **Explicação do Problema:**
  Operações de atualização e deleção direta nesses serviços utilizam apenas o UUID primário do registro (ex: `.eq('id', uuid)`) sem validar ou aplicar filtro pelo `store_id` da loja ativa do usuário logado na cláusula do cliente (ex: `supabase.from('products').update(...).eq('id', uuid)`).
  Se houver qualquer brecha ou política RLS excessivamente permissiva no banco de dados, um usuário de uma Loja A que obtenha o UUID de um registro de uma Loja B conseguirá alterar ou desativar dados de outra loja (Insecure Direct Object Reference / Broken Object Level Authorization).
* **Sugestão de Correção:**
  Sempre incluir `.eq('store_id', activeStoreId)` nas chamadas de `update` e `delete` do cliente Supabase, ou centralizar essas mutações em RPCs atômicas no PostgreSQL que exijam `has_store_access(p_store_id)`.

---

### 2.3 Exposição de Dados Transversais e Vazamento de Estoque/Produtos no `ProductsService.getAll(storeId)`
* **Severidade:** ALTO
* **Arquivos / Serviços Afetados:**
  * `src/services/products.service.ts` (Linhas 28-52)
* **Explicação do Problema:**
  O método `ProductsService.getAll(storeId)` consulta todos os produtos e variações de estoque globais do banco (`supabase.from('products').select(...)`) e realiza a filtragem por `storeId` no lado do cliente via código JavaScript (`.filter(product => ...)`).
  Isso gera dois grandes problemas:
  1. **Vazamento de Dados Multi-Tenant:** O payload JSON completo retornado pela API da Supabase contém informações sobre variações e estoques de outras lojas antes de o filtro JS ser aplicado na memória do navegador.
  2. **Gargalo de Desempenho:** À medida que o catálogo de produtos e número de lojas crescem, a aplicação transfere megabytes de dados desnecessários pela rede.
* **Sugestão de Correção:**
  Realizar o filtro por `store_id` diretamente na consulta do Supabase/PostgreSQL ou utilizar uma RPC/View no banco que filtre o estoque no lado do servidor.

---

## 3. ACHADOS DE SEVERIDADE: MÉDIO

### 3.1 Mutações Diretas no Banco em `InventoryService` Bypassando Regras de Negócio e RPCs
* **Severidade:** MÉDIO
* **Arquivos Afetados:**
  * `src/services/inventory.service.ts` (Linhas 105-148)
* **Explicação do Problema:**
  Ao registrar entradas de estoque de produtos não existentes, o `InventoryService.registerStockEntry` faz inserções diretas em `brands`, `categories`, `products` e `product_variants` via `supabase.from(...).insert(...)`.
  Inserções diretas no cliente ignoram a RPC padronizada `manage_product` e `register_stock_entry`, dificultando auditoria de movimentação, integridade referencial e validação de permissões por loja.
* **Sugestão de Correção:**
  Substituir as inserções diretas em tabelas por chamadas encadeadas às RPCs `manage_product` e `register_stock_entry`.

---

### 3.2 Ausência de Índices para Filtros Frequentes e Consultas com Baixa Performance
* **Severidade:** MÉDIO
* **Arquivos / Tabelas Afetados:**
  * Tabelas: `financial_transactions`, `fixed_expenses`, `sales`, `inventory_movements`
* **Explicação do Problema:**
  Algumas tabelas possuem consultas frequentes ordenadas por `created_at` e filtradas por `store_id` sem índices compostos adequados (ex: `(store_id, created_at DESC)`). Em bases com alto volume de vendas, essas consultas resultam em *Sequential Scans* no PostgreSQL.
* **Sugestão de Correção:**
  Adicionar índices compostos nas tabelas de grande volume:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_sales_store_created ON public.sales (store_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_fin_tx_store_created ON public.financial_transactions (store_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_inv_mov_store_created ON public.inventory_movements (store_id, created_at DESC);
  ```

---

### 3.3 Tratamento de Erros Inconsistente nos Serviços de Produtos e Fornecedores
* **Severidade:** MÉDIO
* **Arquivos Afetados:**
  * `src/services/products.service.ts` (método `getById`)
  * `src/services/suppliers.service.ts` (método `getAll`)
* **Explicação do Problema:**
  Em caso de erro na consulta, `products.service.ts` retorna `null` e `suppliers.service.ts` retorna um array vazio `[]` capturando a exceção silenciosamente (`console.error`). Isso impede que a interface do usuário (UI) identifique que houve uma falha de rede/autenticação/banco e exiba feedback adequado ao usuário.
* **Sugestão de Correção:**
  Lançar exceção ou retornar objeto com estrutura de resultado contendo a mensagem de erro para ser devidamente tratada pelo `StoreContext` ou componente de UI.

---

## 4. ACHADOS DE SEVERIDADE: BAIXO

### 4.1 Persistência Duplicada e Riscos de Cache Obsoleto no `localStorage` durante Troca de Loja
* **Severidade:** BAIXO
* **Arquivos Afetados:**
  * `src/contexts/StoreContext.tsx`
* **Explicação do Problema:**
  O `StoreContext` utiliza o `localStorage` do navegador para guardar estados de `erp_products`, `erp_suppliers`, `erp_fixed_expenses` e `erp_notifications`. Durante a alternância rápida de loja ativa (`activeStoreId`), existe o risco de o estado do `localStorage` exibir momentaneamente dados da loja anterior antes da conclusão do `refreshData()`.
* **Sugestão de Correção:**
  Chavear os registros do `localStorage` incluindo o ID da loja ativa (ex: `erp_products_${activeStoreId}`) ou limpar o cache local ao alterar a loja ativa.

---

## RESUMO DOS ACHADOS POR SEVERIDADE

| Severidade | Quantidade | Principais Focos |
| :--- | :---: | :--- |
| **CRÍTICO** | **2** | Schema Incompleto (`customers.store_id`), Erro de Escopo de Variável (`mp-webhook`) |
| **ALTO** | **3** | Function `SECURITY DEFINER` sem `search_path`, Potencial IDOR/BOLA em Updates, Vazamento Multi-tenant em Produtos |
| **MÉDIO** | **3** | Mutações Diretas Ignorando RPCs, Faltas de Índices Compostos, Erros Silenciosos na UI |
| **BAIXO** | **1** | Cache em `localStorage` desatualizado na troca de contexto de loja |

---

## PLANO DE AÇÃO E RECOMENDAÇÕES FINAIS

1. **Prioridade Imediata:**
   - Aplicar correção no `mp-webhook` para ajustar a declaração da variável `xRequestId`.
   - Criar migração para adicionar `store_id` na tabela `customers` e atualizar o `CustomersService`.
2. **Prioridade Alta:**
   - Atualizar a função `protect_profile_role()` com `SET search_path = public, pg_temp`.
   - Adicionar o filtro `.eq('store_id', activeStoreId)` em todas as chamadas de mutação do frontend.
   - Refatorar `ProductsService.getAll` para filtrar produtos por loja no banco de dados.
3. **Prioridade Média/Baixa:**
   - Padronizar mutações de produto via RPCs e otimizar índices de performance do PostgreSQL.
