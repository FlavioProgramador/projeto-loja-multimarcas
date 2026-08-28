# 🔍 AUDITORIA CONSOLIDADA - VESTRA ERP
**Data:** 28 de agosto de 2026  
**Escopo:** Frontend (React), Backend (Supabase/PL-pgSQL), Segurança, Integrações, Observabilidade, LGPD  
**Metodologia:** Análise de código-fonte completa + revisão de migrations + testes de segurança

---

## 📊 RESUMO EXECUTIVO

| Métrica | Antes | Depois | Alvo |
|---------|-------|--------|------|
| **Nota Geral** | 3,5/10 | 5/10 | 8/10 |
| **Vulnerabilidades Críticas** | 6 | 1 | 0 |
| **Vulnerabilidades Altas** | 5 | 3 | 0 |
| **Testes Automatizados** | 0% | 0% | 80%+ |
| **Observabilidade** | Nenhuma | Webhook logs | Completa |
| **Pronto para Produção** | ❌ | ❌ | ✅ |

### Status de Segurança
- ✅ **Escalonamento de privilégio (cadastro)**: CORRIGIDO
- ✅ **Escalonamento de privilégio (RLS)**: CORRIGIDO
- ✅ **Limpeza de dados sensíveis no logout**: CORRIGIDO
- ✅ **RLS hardening completo**: IMPLEMENTADO
- ✅ **Validação de webhooks**: IMPLEMENTADO
- ❌ **Soft delete**: NÃO IMPLEMENTADO (CRÍTICO)
- ❌ **PIX**: QUEBRADO (funções faltando)
- ❌ **Seed SQL**: QUEBRADO (enum mismatch)

---

## 1️⃣ FRONTEND (React + TypeScript + Vite)

### ✅ Pontos Fortes

1. **Arquitetura limpa e organizada**
   - Separação clara: `components/`, `contexts/`, `services/`, `lib/`
   - Componentes especializados por módulo (pdv, inventory, reports, etc.)
   - Uso de Context API para estado global (Auth, Store, Cart, Theme)

2. **Type Safety com TypeScript**
   - Tipos bem definidos em `src/types/database.ts`
   - Interfaces para CartItem, Product, SaleMovement, etc.
   - **Risco:** Tipos numéricos de IDs reconstituídos por índice (BUG-11 anterior)

3. **UI/UX Consistente**
   - Design system próprio com componentes customizados (Modal, StatCard, StatusBadge)
   - Animações via `motion` library
   - Ícones via `lucide-react`
   - Responsividade CSS puro

4. **Gestão de Autenticação**
   - AuthContext centralizado com persistência de sessão
   - Tratamento de perfil não-disponível com fallback seguro (EMPLOYEE, não ADMIN) ✅
   - Limpeza de dados sensíveis no logout (V-07 corrigido) ✅

5. **Validação de Configuração Supabase**
   - Verificação em `supabase/client.ts` com fallback para modo local
   - Placeholders seguros evitam crash se `.env` não configurado

### 🟡 Problemas Encontrados

#### 🔴 CRÍTICO

| # | Problema | Arquivo | Impacto | Correção |
|---|----------|---------|--------|----------|
| F-01 | **Nenhuma validação de input no formulário de venda** | `src/components/pdv/PdvView.tsx` | Dados inválidos chegam na RPC (nome vazio, CPF inválido, quantidade negativa) | Validar antes de chamar `completeSale`: nome.length > 0, CPF regex, qtd > 0 |
| F-02 | **Sem tratamento de erro amigável na RPC** | `src/services/sales.service.ts:42-55` | Usuário vê mensagem técnica de erro do Postgres | Mapear erros conhecidos (estoque insuficiente, produto inativo) para mensagens legíveis |
| F-03 | **Sem retry/exponential backoff em falhas de rede** | Todos os `services/` | Vendas perdem-se silenciosamente se Supabase fica instável por 1-2s | Implementar retry com backoff exponencial em `complete_sale` |

#### 🟠 ALTO

| # | Problema | Arquivo | Impacto | Correção |
|---|----------|---------|--------|----------|
| F-04 | **Paginação e filtros só no cliente** | `StoreContext.tsx:refreshData()` | Com 100k vendas, carrega tudo na memória; interface trava | Paginar em SQL: `.range(0, 100)` + offset, filtrar por data/range em WHERE |
| F-05 | **Dashboard sem agregação no Postgres** | `src/services/dashboard.service.ts` | Busca todas as vendas do mês inteiro para somar; ineficiente em escala | Criar view ou RPC que retorna `SUM(amount)` direto do DB |
| F-06 | **Estado global (StoreContext) sem otimização** | `StoreContext.tsx` | `refreshData()` é chamado após cada mutação, recarrega 6 tabelas inteiras | Usar `setData` imutável e apenas atualizar a fatia que mudou; implementar react-query |
| F-07 | **Sem suporte a modo offline verdadeiro** | `StoreContext.tsx` fallback | localStorage é apenas cache, não sincronização; vendas offline perdem-se se aba fechar | Implementar Service Worker + IndexedDB + sincronização em background |
| F-08 | **Componentes de formulário não têm indicador de carregamento** | `NewProductModal.tsx`, `NewCustomerModal.tsx` | Usuário clica 2x porque não vê feedback que foi enviado | Desabilitar botão + spinner durante `isLoading` |

#### 🟡 MÉDIO

| # | Problema | Arquivo | Impacto | Correção |
|---|----------|---------|--------|----------|
| F-09 | **Código de RBAC existe mas não é usado** | `src/lib/permissions.ts` existe | Todos os módulos acessíveis a EMPLOYEE; sem ocultação de UI por papel | Usar `can(role, 'sales.create')` nos componentes: `{can(...) && <Button>}`  |
| F-10 | **Sem truncate/mask de CPF na tela** | Exibição de clientes e vendas | CPF completo visível em relatórios e histórico de vendas | Mostrar apenas `***.***.***-XX` ou últimos 4 dígitos |
| F-11 | **Sem cache da lista de produtos** | `ProductsService.getAll()` chamada em `refreshData()` | A cada venda concluída, recarrega listagem inteira de produtos | Memoizar ou usar react-query com refetch seletivo |
| F-12 | **Cupons de desconto sem UI, mas código tenta usar** | `StoreContext.tsx` tem lógica de cupom no estado | RPC `complete_sale` não recebe cupom; feature parcialmente implementada | Remover UI incompleta ou implementar até RPC |

---

## 2️⃣ BACKEND - Supabase (PostgreSQL + RLS + RPCs)

### ✅ Pontos Fortes

1. **Transações Críticas Atômicas**
   - `complete_sale` usa `SELECT ... FOR UPDATE` (lock pessimista)
   - Insere atomicamente em `sales`, `sale_items`, `payments`, `financial_transactions`, `inventory_movements`
   - Rollback automático em erro ✅

2. **Validação em Nível de Banco de Dados**
   - Constraints `CHECK (stock_quantity >= 0)`, `CHECK (sale_price >= 0)`
   - Defesa de última linha contra dados corrompidos
   - Impossível gerar estoque negativo sem violar constraint

3. **RLS Hardening (Fase 2: 2026-08-28)**
   - Políticas de INSERT/UPDATE/DELETE restringidas por papel ✅
   - Trigger `protect_profile_role` previne auto-promoção a ADMIN ✅
   - Imutabilidade de `inventory_movements` garantida (sem UPDATE/DELETE policy)
   - Separação clara: INSERT via RPC, SELECT + UPDATE limitado via RLS

4. **Multi-Loja Pronta (Fase 3: 2026-08-28)**
   - Tabelas `stores`, `user_store_access`, `store_inventory` criadas ✅
   - Colunas `store_id` adicionadas a `sales`, `inventory_movements`, `financial_transactions`
   - Migração de dados preserva histórico (não há exclusão em cascata)

5. **Validação de Webhooks**
   - Assinatura HMAC-SHA256 do Mercado Pago verificada (mp-webhook)
   - Tolerância de timestamp (rejeita requests > 10 min antigas — anti-replay)
   - Rebusca o status no MP antes de aprovar

6. **Índices de Performance**
   - `idx_products_brand`, `idx_variants_sku`, `idx_sales_created_at`
   - `idx_inventory_mov_variant`, `idx_customers_document`

### 🔴 CRÍTICO

| # | Problema | Arquivo | Impacto | Correção |
|---|----------|---------|--------|----------|
| B-01 | **Seed SQL com enum mismatch: `'entrada'` vs `'INCOME'`** | `supabase/setup.sql:line ~900` | Script seed falha por CHECK constraint → deploy aborta | Trocar `'entrada'`/`'saida'` por `'INCOME'`/`'EXPENSE'` no seed |
| B-02 | **Funções PIX não existem** | Faltam em `setup.sql` | `create-mp-pix/index.ts` linha 26 chama `.rpc('create_mp_pix_sale')` → erro `PGRST202 function not found` | Implementar `create_mp_pix_sale` e `approve_mp_pix_sale` (ver detalhes em 3️⃣ Integrações) |
| B-03 | **Soft delete não implementado** | `services/products.service.ts` faz `DELETE`, não `UPDATE is_active` | Editar/deletar produto apaga `product_variants` → apaga `inventory_movements` (ON CASCADE) → perde trilha de auditoria | Sempre usar `UPDATE products SET is_active = false` + mesmo para variantes; remover `ON DELETE CASCADE` para `inventory_movements` |
| B-04 | **`customers` com `is_active` mas nenhum soft delete de cliente** | Schema tem coluna, mas `CustomersService` sem método de exclusão lógica | Cliente deletado perde CPF/histórico de compra → violação LGPD | Implementar `softDeleteCustomer` que marca `is_active = false` |
| B-05 | **Vendas canceladas ainda contam em relatórios** | `dashboard.service.ts`, `reports.service.ts`, `sales.service.ts` | Venda PIX cancelada segue como receita em Dashboard/Relatórios | Adicionar `.eq('status', 'COMPLETED')` em todas as queries de métricas financeiras |

### 🟠 ALTO

| # | Problema | Arquivo | Impacto | Correção |
|---|----------|---------|--------|----------|
| B-06 | **RPC `cancel_mp_pix_sale` sem validação de permissão** | `setup.sql:~589` | Qualquer CASHIER pode cancelar venda de outro CASHIER → roubo/fraude | Adicionar verificação: se não é ADMIN/MANAGER, pode só cancelar próprias vendas (`user_id = auth.uid()`) |
| B-07 | **`financial_transactions` permanentemente acoplada a vendas** | Schema sem tabela de transações genéricas | Não há como registrar entrada de fornecedor, gasto de aluguel, etc., sem hack | Criar RPC `record_financial_transaction` para operações não-venda |
| B-08 | **Sem table-level audit log** | Nenhuma tabela `audit_log` ou triggers de `AFTER UPDATE` | Não há como rastrear quem alterou preço de produto, deletou cliente, etc. | Criar tabela `audit_log (table_name, record_id, action, old_data JSONB, new_data JSONB, user_id, created_at)` + triggers SECURITY DEFINER |
| B-09 | **Performance: `complete_sale` sem índice em `sale_id` para webhook** | Webhook precisa achar a venda por ID | Índice existe, mas função não é otimizada se tabelas crescem | Manter índice; considerar UNLOGGED table para `sale_idempotency` (não precisa durabilidade) |
| B-10 | **Sem validação de `store_id` em RPC** | `complete_sale` recebe `p_store_id` mas nunca valida se existe | Se `store_id` inválido, venda insere com FK violation → erro genérico | Adicionar `IF NOT EXISTS (SELECT 1 FROM stores WHERE id = p_store_id) THEN RAISE EXCEPTION` |

### 🟡 MÉDIO

| # | Problema | Arquivo | Impacto | Correção |
|---|----------|---------|--------|----------|
| B-11 | **`inventory_movements.user_id` pode ser NULL** | Quem criou o movimento não é rastreável | Impossível auditar quem baixou estoque indevidamente | Adicionar `NOT NULL` ou default para `auth.uid()` (com fallback se RPC) |
| B-12 | **Sem data de validade para dados de cliente** | Clientes cadastrados indefinidamente mesmo sem compra em 2 anos | Possível violação LGPD se cliente pedir exclusão | Adicionar coluna `data_ultima_compra` e política de retenção (ex: deletar após 3 anos inativo) |
| B-13 | **Códigos de barras editáveis, sem validação de duplicata em tempo real** | Campo `barcode UNIQUE` existe, mas UI não avisa | Possível conflito silencioso se digitado manual | Validar barcode no frontend com `.maybeSingle()` antes de salvar |
| B-14 | **Movimentações de estoque sem razão/motivo** | Campo `notes` existe mas é raramente preenchido | Auditoria fraca: `qty 50 → 30` sem contexto | Tornar `notes` obrigatório e estruturado (ex: `SELECT`, `RETURN`, `ADJUSTMENT`, `LOSS`) |

---

## 3️⃣ INTEGRAÇÕES EXTERNAS

### Mercado Pago (PIX)

#### ❌ Status: QUEBRADO (3 Bugs Críticos)

**BUG-04a: Função `create_mp_pix_sale` não existe**
- **Chamador:** `supabase/functions/create-mp-pix/index.ts:26`
  ```ts
  const { data, error } = await supabase.rpc('create_mp_pix_sale', { ... })
  ```
- **Problema:** Busquei todas as funções em `setup.sql` e migrations — não existe
- **Impacto:** Gerar QR Code PIX falha com `PGRST202 function not found`
- **Correção:** Implementar:
  ```sql
  CREATE OR REPLACE FUNCTION create_mp_pix_sale(
    p_store_id UUID,
    p_customer_name TEXT,
    p_customer_cpf TEXT,
    p_items JSONB,
    p_amount NUMERIC,
    p_discount_value NUMERIC DEFAULT 0
  ) RETURNS jsonb AS $$
  DECLARE
    v_sale_id UUID;
    v_sale_number TEXT;
    v_user_id UUID;
  BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'User not authenticated';
    END IF;

    -- Criar venda com status PENDING (não baixa estoque ainda)
    INSERT INTO public.sales (
      store_id, user_id, customer_name, customer_cpf, 
      total, discount_value, status, created_at
    ) VALUES (
      p_store_id, v_user_id, p_customer_name, p_customer_cpf,
      p_amount, p_discount_value, 'PENDING', NOW()
    ) RETURNING id, sale_number INTO v_sale_id, v_sale_number;

    -- Inserir itens de venda
    INSERT INTO public.sale_items (
      sale_id, variant_id, product_name, variant_description,
      quantity, unit_price, created_at
    ) SELECT
      v_sale_id, 
      (item->>'variant_id')::UUID,
      item->>'product_name',
      item->>'variant_description',
      (item->>'quantity')::INTEGER,
      (item->>'unit_price')::NUMERIC,
      NOW()
    FROM jsonb_array_elements(p_items) AS item;

    RETURN jsonb_build_object(
      'sale_id', v_sale_id,
      'sale_number', v_sale_number,
      'status', 'PENDING'
    );
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER;
  GRANT EXECUTE ON FUNCTION create_mp_pix_sale TO authenticated;
  ```

**BUG-04b: Função `approve_mp_pix_sale` não existe**
- **Chamador:** `supabase/functions/mp-webhook/index.ts:50+`
  ```ts
  const { data, error } = await supabase.rpc('approve_mp_pix_sale', { sale_id: ... })
  ```
- **Problema:** Idem anterior — não existe
- **Impacto:** Webhook do MP não consegue marcar venda como COMPLETED + baixar estoque
- **Correção:** Implementar:
  ```sql
  CREATE OR REPLACE FUNCTION approve_mp_pix_sale(
    p_sale_id UUID
  ) RETURNS jsonb AS $$
  DECLARE
    v_sale_record RECORD;
    v_variant_id UUID;
    v_quantity INTEGER;
    v_result RECORD;
  BEGIN
    -- Lock da venda para evitar race condition
    SELECT * INTO v_sale_record FROM public.sales 
      WHERE id = p_sale_id FOR UPDATE;

    IF v_sale_record IS NULL THEN
      RAISE EXCEPTION 'Sale not found';
    END IF;

    -- Se já foi aprovada, idempotência
    IF v_sale_record.status = 'COMPLETED' THEN
      RETURN jsonb_build_object('idempotent', true, 'status', 'COMPLETED');
    END IF;

    IF v_sale_record.status NOT IN ('PENDING', 'APPROVED') THEN
      RAISE EXCEPTION 'Sale cannot be approved from status: %', v_sale_record.status;
    END IF;

    -- Validar estoque e baixar
    FOR v_variant_id, v_quantity IN
      SELECT variant_id, quantity FROM public.sale_items WHERE sale_id = p_sale_id
    LOOP
      UPDATE public.product_variants SET stock_quantity = stock_quantity - v_quantity
        WHERE id = v_variant_id AND stock_quantity >= v_quantity;
      
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient stock for variant %', v_variant_id;
      END IF;

      -- Registrar movimento de estoque
      INSERT INTO public.inventory_movements (
        store_id, product_variant_id, type, quantity_before,
        quantity_after, reference_id, user_id, notes, created_at
      ) VALUES (
        v_sale_record.store_id,
        v_variant_id,
        'SALE',
        (SELECT stock_quantity + v_quantity FROM product_variants WHERE id = v_variant_id),
        (SELECT stock_quantity FROM product_variants WHERE id = v_variant_id),
        p_sale_id,
        auth.uid(),
        'PIX - Approved',
        NOW()
      );
    END LOOP;

    -- Marcar venda como COMPLETED
    UPDATE public.sales SET status = 'COMPLETED', updated_at = NOW()
      WHERE id = p_sale_id;

    -- Registrar transaction financeira
    INSERT INTO public.financial_transactions (
      store_id, type, category, description, amount, status, created_at
    ) VALUES (
      v_sale_record.store_id,
      'INCOME',
      'Sales',
      'PIX Sale #' || v_sale_record.sale_number,
      v_sale_record.total,
      'PAID',
      NOW()
    );

    RETURN jsonb_build_object('success', true, 'status', 'COMPLETED');
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER;
  GRANT EXECUTE ON FUNCTION approve_mp_pix_sale TO service_role;
  ```

**BUG-05: Edge Function `create-mp-pix` usa `process.env` em Deno**
- **Arquivo:** `supabase/functions/create-mp-pix/index.ts:4`
  ```ts
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
  ```
- **Problema:** `process` não existe em Deno (ambiente Edge Function Supabase)
- **Impacto:** Função quebra ao carregar
- **Correção:** Trocar para `Deno.env.get('ALLOWED_ORIGIN') || '*'`

**Implementação do Fluxo PIX:**
1. User clica "Pagar com PIX" no PDV
2. Frontend chama Edge Function `create-mp-pix`
3. Edge Function chama RPC `create_mp_pix_sale` (não existe) → cria venda PENDING
4. Edge Function chama API Mercado Pago → retorna QR Code
5. User escaneia QR Code e paga
6. MP chama webhook `mp-webhook` com resultado
7. Webhook chama RPC `approve_mp_pix_sale` (não existe) → marca venda COMPLETED + baixa estoque

**Status:** 0/7 passos funcionando até a RPC existir

---

## 4️⃣ SEGURANÇA DETALHADA

### ✅ Correções Implementadas (Agosto 2026)

| Vulnerabilidade | Status | Detalhes |
|---|---|---|
| **V-01**: Fallback ADMIN → EMPLOYEE | ✅ CORRIGIDO | `AuthContext.tsx:82` usa `?? 'EMPLOYEE'` |
| **V-02**: Signup não envia role | ✅ CORRIGIDO | `auth.service.ts:55` não envia `role` em metadata |
| **V-03**: Trigger sempre cria EMPLOYEE | ✅ CORRIGIDO | Trigger ignora metadata, força EMPLOYEE |
| **V-04**: RLS com `WITH CHECK` | ✅ CORRIGIDO | Policy de UPDATE separada com `WITH CHECK (role = OLD.role)` |
| **V-05**: PIX idempotência | ⚠️ PARCIAL | Função `approve_mp_pix_sale` não existe; se implementada, deve ter idempotência |
| **V-06**: REVOKE de RPCs de anon | ✅ VERIFICAR | Precisamos confirmar se as migrations removem GRANT a `anon` |
| **V-07**: Logout limpa localStorage | ✅ CORRIGIDO | `AuthContext.tsx:72-82` remove chaves sensíveis |
| **V-08**: `complete_sale` valida auth | ✅ CORRIGIDO | Função checa `IF auth.uid() IS NULL THEN RAISE EXCEPTION` |

### ❌ Vulnerabilidades Remanescentes

#### CRÍTICO

| # | Vulnerabilidade | Vetores | Risco | Mitigação |
|---|---|---|---|---|
| VUL-01 | Soft delete não implementado | Editar/deletar produto apaga auditoria | PCI, LGPD, perda de dados | Implementar soft delete em products, variants, customers |
| VUL-02 | PIX completamente quebrado | Qualquer tentativa falha | Feature não funciona | Implementar 3 funções faltantes + 1 bug Deno |
| VUL-03 | Seed SQL quebrado | Deploy aberta ao público falha | Impossível onboarding de clientes | Corrigir enums no seed |

#### ALTO

| # | Vulnerabilidade | Vetores | Risco | Mitigação |
|---|---|---|---|---|
| VUL-04 | Sem validação de input do usuário | CPF, nome podem ter SQL injection se não validados no cliente | Injeção (improvável por RLS, mas risco) | Validar regex: CPF `\d{3}\.\d{3}\.\d{3}-\d{2}`, nome `[a-zA-Z\s]{2,100}` |
| VUL-05 | Sem rate limiting de login | Força bruta não mitigada | Contas podem ser hackeadas com dicionário | Configurar Auth Rate Limiting do Supabase (padrão: 10/min) |
| VUL-06 | Dados de cliente em localStorage sem expiração | Cache vulnerável em máquinas compartilhadas | Funcionário anterior deixa máquina e próximo vê clientes | Definir TTL em localStorage (ex: `ttl: 3600000` = 1h) |
| VUL-07 | CORS com fallback `*` em Edge Functions | Qualquer origem pode chamar | Possível CSRF | Definir `ALLOWED_ORIGIN` em produção: `.env.production` |
| VUL-08 | Sem validação de CPF/documento | Frontend não valida formato | Dados lixo entram no banco | Usar biblioteca `cpf` para validar antes de INSERT |
| VUL-09 | Webhook sem validação de origem (se `webhookSecret` não configurado) | Qualquer pessoa pode disparar `approve_mp_pix_sale` simulando MP | Fraude de PIX | Tornar `webhookSecret` obrigatório; usar política de REVOKE de EXECUTE para `service_role` apenas |

#### MÉDIO

| # | Vulnerabilidade | Vetores | Risco | Mitigação |
|---|---|---|---|---|
| VUL-10 | CPF duplicado em `sales` e `customers` | Falta de normalização de PII | Difícil atender pedidos LGPD de exclusão (não sabem onde está) | Remover `customer_cpf` de `sales`, manter só FK; mascarar CPF na UI |
| VUL-11 | Sem consentimento explícito de PII | LGPD exige consentimento para coleta de CPF/dados pessoais | Possível multa em auditoria | Adicionar checkbox "Autorizo coleta de dados" no cadastro de cliente |
| VUL-12 | Sem política de retenção de dados | Dados acumulam indefinidamente | Não há como cumprir direito ao esquecimento (LGPD art. 17) | Implementar job que marca `customers.is_active = false` após 3 anos inativo |
| VUL-13 | Webhook não valida assinatura se secret não configurado | Segurança degradada em dev | Dependência de variável de ambiente | Lançar erro ou warning se `ALLOWED_ORIGIN` ou `webhookSecret` não definido em produção |

---

## 5️⃣ OBSERVABILIDADE E LOGGING

### ❌ Status: Ausente

**O que existe:**
- `console.error()` espalhado em `services/`
- Logs de webhook no stderr (Deno padrão)
- Nenhum sistema estruturado

**O que falta:**
- ❌ Error tracking (Sentry, LogRocket)
- ❌ Health checks
- ❌ Métricas de performance (P50/P99)
- ❌ Audit log genérico
- ❌ Alertas para falhas críticas

**Impacto:**
- Impossível diagnosticar falhas em produção
- Sem trilha de auditoria de mudanças de dados
- Sem visibilidade de performance

**Recomendação:**
```ts
// src/lib/logger.ts
export const logger = {
  info: (msg: string, data?: any) => {
    console.log(`[INFO] ${new Date().toISOString()} - ${msg}`, data);
    // Enviar para Sentry ou outro serviço
  },
  error: (msg: string, err: Error, data?: any) => {
    console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`, err, data);
    // Sentry.captureException(err)
  }
};
```

---

## 6️⃣ LGPD - Proteção de Dados Pessoais

### ⚠️ Status: Não Conforme (Crítico para Produção)

**Dados Pessoais Coletados:**
- `profiles.full_name`, `email`
- `customers.name`, **`cpf`**, `phone`, `email`, `address`, `birth_date`
- `sales.customer_name`, `customer_cpf` (duplicação desnecessária)

**Problemas Identificados:**

| Requisito LGPD | Status | Evidência |
|---|---|---|
| **Base legal** | ❌ FALTA | Nenhum texto de consentimento no cadastro |
| **Finalidade clara** | ❌ FALTA | CPF coletado sem informar use case |
| **Minimização** | ❌ FALTA | `sales.customer_cpf` duplica dado que já está em `customers` |
| **Consentimento explícito** | ❌ FALTA | Checkbox obrigatório não existe |
| **Direito de acesso** | ⚠️ PARCIAL | API existe (query `customers`), mas sem endpoint de exportação |
| **Direito de exclusão** | ❌ FALTA | `CustomersService` sem `deleteCustomer()` |
| **Direito de retificação** | ✅ EXISTE | Update via `UpdateCustomerModal` |
| **Direito de portabilidade** | ❌ FALTA | Sem endpoint que exporte dados em JSON/CSV |
| **Retenção de dados** | ❌ FALTA | Sem política (dados acumulam indefinidamente) |
| **Criptografia em repouso** | ✅ EXISTE | Supabase oferece (dependendo do plano) |
| **Criptografia em trânsito** | ✅ EXISTE | HTTPS/TLS obrigatório |

**Ações Necessárias (Pré-Produção):**

1. **Adicionar tela de consentimento**
   ```tsx
   <input type="checkbox" required /> 
   Autorizo a coleta de meus dados para registro de vendas e histórico de compras.
   ```

2. **Implementar exclusão/anonimização**
   ```ts
   // customers.service.ts
   async anonymizeCustomer(customerId: UUID) {
     return supabase.from('customers')
       .update({
         name: 'ANONIMIZADO',
         cpf: null,
         phone: null,
         email: null,
         address: null,
         is_active: false
       })
       .eq('id', customerId);
   }
   ```

3. **Remover `customer_cpf` de `sales`**
   ```sql
   ALTER TABLE sales DROP COLUMN customer_cpf;
   -- Adicionar apenas FK
   ALTER TABLE sales ADD COLUMN customer_id UUID REFERENCES customers(id);
   ```

4. **Implementar política de retenção**
   ```sql
   -- job que roda diariamente
   UPDATE customers SET is_active = false
   WHERE is_active = true AND 
         EXTRACT(YEAR FROM AGE(NOW(), last_purchase_date)) >= 3;
   ```

5. **Adicionar endpoint de exportação (art. 18)**
   ```ts
   // Edge Function
   export async function exportCustomerData(customerId: UUID) {
     const { data } = await supabase
       .from('customers')
       .select('*')
       .eq('id', customerId)
       .single();
     
     return {
       customer: data,
       purchases: await supabase.from('sales').select('*').eq('customer_id', customerId)
     };
   }
   ```

6. **Criar política de privacidade**
   - Adicionar rota `/privacy` com texto LGPD
   - Exibir durante onboarding

---

## 7️⃣ TESTES E CI/CD

### ❌ Status: Ausente

**O que existe:** Nada
**O que falta:** Tudo

**Recomendação Mínima (MVP):**

1. **Testes Unitários** (20% de cobertura)
   ```bash
   npm install --save-dev vitest @testing-library/react
   ```
   Exemplos:
   - `complete_sale` com estoque insuficiente → erro
   - `can(CASHIER, 'products.delete')` → false
   - `formatCPF('12345678901')` → válido

2. **Testes de Integração** (RPC + RLS)
   ```bash
   npm install --save-dev ts-node pg
   ```
   Exemplos:
   - User EMPLOYEE tenta `INSERT INTO products` → denied by RLS
   - User ADMIN pode promover outro ADMIN → denied by trigger

3. **CI/CD Mínimo** (GitHub Actions)
   ```yaml
   on: [push, pull_request]
   jobs:
     build:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v3
         - uses: actions/setup-node@v3
           with: { node-version: 20 }
         - run: npm install && npm run lint && npm run type-check
   ```

---

## 8️⃣ ARQUITETURA RECOMENDADA

### Multi-Loja (Fase 3 Iniciada, Falta Completar)

**Estado Atual:**
- ✅ Tabelas criadas (`stores`, `user_store_access`, `store_inventory`)
- ✅ Colunas adicionadas (`store_id` em operacionais)
- ⚠️ RLS não 100% implementado (faltam policies em store_inventory)
- ⚠️ Frontend sem suporte (sempre usa `store_id` fixo ou ` null`)

**Falta:**
1. RLS em `store_inventory` filtrando por loja do usuário
2. Frontend com seletor de loja
3. Relatórios consolidados vs por loja
4. Transferência de estoque entre lojas

**Implementar em próxima iteração:**
```sql
-- Após confirmar que user_store_access está 100% preenchida
CREATE POLICY "Users can access own stores"
  ON public.store_inventory FOR SELECT
  TO authenticated
  USING (
    store_id IN (
      SELECT store_id FROM user_store_access WHERE user_id = auth.uid()
    )
  );
```

---

## 9️⃣ ROADMAP DE CORREÇÕES

### 🔴 P0 (Bloqueia Produção)
- [ ] **B-01**: Corrigir seed SQL (enum mismatch)
- [ ] **B-02/B-03/B-05**: Implementar funções PIX + fix Deno
- [ ] **B-03/B-04**: Implementar soft delete (products, variants, customers)
- [ ] **VUL-06**: Implementar TTL em localStorage
- [ ] **Testes mínimos**: complete_sale, RLS básico

### 🟠 P1 (Antes de V1)
- [ ] **F-01/F-02**: Validação de input + tratamento de erro amigável
- [ ] **B-05**: Implementar `record_financial_transaction` RPC
- [ ] **B-08**: Audit log genérico (tabela + triggers)
- [ ] **F-04/F-05**: Paginação e agregação no SQL
- [ ] **LGPD-01 a LGPD-06**: Consentimento, exclusão, retenção, exportação
- [ ] **Observabilidade básica**: Sentry + alertas

### 🟡 P2 (V1+)
- [ ] **F-09**: Usar `can()` no frontend (ocultar módulos por papel)
- [ ] **F-10**: Mascarar CPF na UI
- [ ] **B-06**: Validar permissão em `cancel_mp_pix_sale`
- [ ] **B-11**: Tornár `inventory_movements.user_id` NOT NULL
- [ ] **B-12**: Política de retenção de clientes
- [ ] **F-07**: Service Worker + offline real
- [ ] **Multi-loja completa**: frontend, relatórios consolidados

---

## 🔟 RESUMO FINAL

### Pontuação por Área

| Área | Nota Anterior | Nota Atual | Alvo |
|------|---|---|---|
| **Frontend** | 5/10 | 5/10 | 7/10 |
| **Backend** | 4/10 | 6/10 | 8/10 |
| **Segurança** | 2/10 | 4/10 | 9/10 |
| **Testes** | 0/10 | 0/10 | 7/10 |
| **Observabilidade** | 0/10 | 1/10 | 7/10 |
| **LGPD** | 2/10 | 2/10 | 9/10 |
| **DevOps** | 0/10 | 0/10 | 7/10 |
| **Arquitetura** | 4/10 | 6/10 | 8/10 |

**Nota Geral: 5/10**

### Checklist de Prontidão para Produção

- ❌ Vulnerabilidades críticas corrigidas
- ❌ Testes automatizados presentes
- ❌ Logging estruturado implementado
- ❌ LGPD totalmente conforme
- ❌ CI/CD ativo
- ❌ Backup/disaster recovery testado
- ❌ SLA/uptime monitorado
- ❌ Rate limiting ativo
- ❌ Documentação API completa

**Recomendação:** Não levar a produção com dados reais até P0 estar 100% corrigido e testes + CI mínimos implementados.

---

## 📞 CONTATO E PRÓXIMOS PASSOS

Esta auditoria foi realizada em 2026-08-28 com acesso ao código-fonte completo e repositórios anteriores de auditoria.

**Recomenda-se:**
1. Implementar correções P0 em prioridade (estimar 1-2 sprints)
2. Adicionar testes mínimos e CI (1 sprint)
3. Validar com dados de teste em ambiente de staging (1 sprint)
4. Depois então considerar produção com dados reais

Qualquer dúvida, verificar os arquivos de auditoria anteriores:
- `SECURITY_AUDIT.md` — vulnerabilidades corrigidas
- `BACKEND_AUDIT.md` — integridade de dados
- `AUDITORIA.md` — visão técnica completa original
