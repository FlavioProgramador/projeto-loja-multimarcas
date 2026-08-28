# 📋 PLANO DE AÇÃO - Vestra ERP

**Objetivo:** Levar Vestra de 5/10 para 8+/10 e pronto para produção com dados reais

**Timeline Recomendada:** 3-4 sprints (8-12 semanas)  
**Equipe:** 1-2 engenheiros full-stack + 1 QA

---

## SPRINT 1: CORREÇÃO DE CRÍTICOS (Semanas 1-2)

### 🔴 B-01: Corrigir Seed SQL (Enum Mismatch)
**Prioridade:** P0  
**Dependências:** Nenhuma  
**Esforço:** 1 hora  

**Tarefa:**
```sql
-- Arquivo: supabase/setup.sql (final)
-- ANTES:
INSERT INTO public.financial_transactions (type, ...) VALUES ('entrada', ...);
INSERT INTO public.financial_transactions (type, ...) VALUES ('saida', ...);

-- DEPOIS:
INSERT INTO public.financial_transactions (type, ...) VALUES ('INCOME', ...);
INSERT INTO public.financial_transactions (type, ...) VALUES ('EXPENSE', ...);
```

**Testes:**
- Execute o SQL inteiro em um Supabase novo → sucesso
- Verifique `SELECT * FROM financial_transactions LIMIT 5`

**Critério de Aceitação:**
- ✅ Seed executa sem error
- ✅ 5+ registros inseridos

---

### 🔴 B-02/B-03/B-05: Implementar PIX Completo
**Prioridade:** P0  
**Dependências:** B-01 (seed fix)  
**Esforço:** 12-16 horas  

**Tarefa 1: Fix Deno em create-mp-pix**
```ts
// Arquivo: supabase/functions/create-mp-pix/index.ts (linha 4)
// ANTES:
'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',

// DEPOIS:
'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || '*',
```
**Esforço:** 0.5 horas

**Tarefa 2: Implementar `create_mp_pix_sale` RPC**
```sql
-- Arquivo: supabase/migrations/20260829000000_pix_functions.sql

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

  -- Validar loja
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store_id) THEN
    RAISE EXCEPTION 'Store not found: %', p_store_id;
  END IF;

  -- Criar venda PENDING (não baixa estoque ainda)
  INSERT INTO public.sales (
    store_id, user_id, customer_name, customer_cpf, 
    total, discount_value, status, created_at
  ) VALUES (
    p_store_id, v_user_id, p_customer_name, p_customer_cpf,
    p_amount, p_discount_value, 'PENDING', NOW()
  ) RETURNING id, sale_number INTO v_sale_id, v_sale_number;

  -- Inserir itens
  INSERT INTO public.sale_items (
    sale_id, variant_id, product_id, product_name, 
    variant_description, quantity, unit_price, created_at
  ) SELECT
    v_sale_id, 
    (item->>'variant_id')::UUID,
    (item->>'product_id')::UUID,
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
REVOKE EXECUTE ON FUNCTION create_mp_pix_sale FROM anon;
```
**Esforço:** 4 horas (incluindo testes)

**Tarefa 3: Implementar `approve_mp_pix_sale` RPC**
```sql
CREATE OR REPLACE FUNCTION approve_mp_pix_sale(
  p_sale_id UUID
) RETURNS jsonb AS $$
DECLARE
  v_sale_record RECORD;
  v_variant_id UUID;
  v_quantity INTEGER;
  v_store_id UUID;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  
  -- Lock da venda
  SELECT * INTO v_sale_record FROM public.sales 
    WHERE id = p_sale_id FOR UPDATE;

  IF v_sale_record IS NULL THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;

  v_store_id := v_sale_record.store_id;

  -- Idempotência
  IF v_sale_record.status = 'COMPLETED' THEN
    RETURN jsonb_build_object('idempotent', true, 'status', 'COMPLETED');
  END IF;

  IF v_sale_record.status NOT IN ('PENDING', 'APPROVED') THEN
    RAISE EXCEPTION 'Sale cannot be approved from status: %', v_sale_record.status;
  END IF;

  -- Baixar estoque (pessimistically lock cada variante)
  FOR v_variant_id, v_quantity IN
    SELECT variant_id, quantity FROM public.sale_items 
    WHERE sale_id = p_sale_id
  LOOP
    -- Validar estoque em store_inventory
    IF NOT EXISTS (
      SELECT 1 FROM public.store_inventory 
      WHERE store_id = v_store_id AND product_variant_id = v_variant_id 
      AND quantity >= v_quantity
    ) THEN
      RAISE EXCEPTION 'Insufficient stock for variant %', v_variant_id;
    END IF;

    -- Baixar em store_inventory
    UPDATE public.store_inventory 
    SET quantity = quantity - v_quantity
    WHERE store_id = v_store_id AND product_variant_id = v_variant_id;

    -- Registrar movimento
    INSERT INTO public.inventory_movements (
      store_id, product_variant_id, type, quantity_before,
      quantity_after, reference_id, user_id, notes, created_at
    ) SELECT
      v_store_id,
      v_variant_id,
      'SALE',
      quantity + v_quantity,
      quantity,
      p_sale_id,
      v_user_id,
      'PIX Approved - MP Transaction',
      NOW()
    FROM public.store_inventory 
    WHERE store_id = v_store_id AND product_variant_id = v_variant_id;
  END LOOP;

  -- Marcar venda COMPLETED
  UPDATE public.sales 
  SET status = 'COMPLETED', updated_at = NOW()
  WHERE id = p_sale_id;

  -- Registrar transação financeira
  INSERT INTO public.financial_transactions (
    store_id, type, category, description, amount, status, created_at
  ) VALUES (
    v_store_id,
    'INCOME',
    'Sales - PIX',
    'PIX Sale #' || v_sale_record.sale_number,
    v_sale_record.total,
    'PAID',
    NOW()
  );

  RETURN jsonb_build_object('success', true, 'status', 'COMPLETED');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION approve_mp_pix_sale TO service_role;
REVOKE EXECUTE ON FUNCTION approve_mp_pix_sale FROM authenticated, anon;
```
**Esforço:** 6 horas (incluindo testes com webhook mock)

**Tarefa 4: Testar Fluxo PIX Completo**
```bash
# Teste de integração (ts-node)
npx ts-node scripts/test-pix-flow.ts

# Checklist:
# 1. Frontend chama create-mp-pix → retorna QR Code
# 2. Webhook simula aprovação do MP
# 3. Venda marca COMPLETED
# 4. Estoque baixa
# 5. Transação financeira criada
```
**Esforço:** 2 horas

---

### 🔴 B-03/B-04: Implementar Soft Delete
**Prioridade:** P0  
**Dependências:** Nenhuma (mas impacta outras migrations)  
**Esforço:** 8 horas  

**Tarefa 1: Migração de soft delete**
```sql
-- Arquivo: supabase/migrations/20260829000001_soft_delete_implementation.sql

-- PRODUCTS: já tem is_active, apenas fazer UPDATE (nunca DELETE)
-- Atualizar services para usar `UPDATE ... SET is_active = false`

-- PRODUCT_VARIANTS: adicionar soft delete
ALTER TABLE public.product_variants DROP CONSTRAINT IF EXISTS product_variants_pkey CASCADE;
-- (Preservar dados, remover apenas constraint de exclusão)

-- CUSTOMERS: adicionar soft delete completo
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
-- UPDATE customers SET is_active = false, deleted_at = NOW() (soft delete)
-- SELECT * FROM customers WHERE is_active = true (hard delete from views)

-- SUPPLIERS: já tem is_active
-- Mesmo tratamento de products

-- INVENTORY_MOVEMENTS: NUNCA deletar (mudar FK para ON DELETE RESTRICT)
ALTER TABLE public.inventory_movements
  DROP CONSTRAINT IF EXISTS inventory_movements_product_variant_id_fkey,
  ADD CONSTRAINT inventory_movements_product_variant_id_fkey 
    FOREIGN KEY (product_variant_id) REFERENCES public.product_variants(id) ON DELETE RESTRICT;

-- Mesmo para sales/sale_items
ALTER TABLE public.sale_items
  DROP CONSTRAINT IF EXISTS sale_items_variant_id_fkey,
  ADD CONSTRAINT sale_items_variant_id_fkey 
    FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE RESTRICT;
```
**Esforço:** 3 horas

**Tarefa 2: Atualizar services**
```ts
// src/services/products.service.ts
async remove(uuid: string) {
  // ANTES: DELETE
  // DEPOIS:
  return supabase.from('products')
    .update({ is_active: false })
    .eq('id', uuid);
}

// src/services/customers.service.ts
async delete(uuid: string) {
  // NOVO:
  return supabase.from('customers')
    .update({ is_active: false, deleted_at: new Date().toISOString() })
    .eq('id', uuid);
}
```
**Esforço:** 2 horas

**Tarefa 3: Testar imutabilidade**
```bash
# Verificar:
# 1. Deletar produto → não apaga variantes
# 2. Deletar variante → não apaga movimentações
# 3. Histórico de estoque permanece intacto
```
**Esforço:** 1 hora

**Subtotal Sprint 1:** ~40-45 horas

---

## SPRINT 2: TESTES + LGPD (Semanas 3-4)

### 🟠 F-01/F-02: Validação de Input
**Prioridade:** P1  
**Esforço:** 3 horas

```ts
// src/lib/validation.ts
export const validateCPF = (cpf: string): boolean => {
  return /^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(cpf);
};

export const validateName = (name: string): boolean => {
  return name.length >= 2 && name.length <= 100 && /^[a-zA-Z\s]+$/.test(name);
};

export const validateQuantity = (qty: number): boolean => {
  return qty > 0 && Number.isInteger(qty);
};
```

---

### 📝 Testes Mínimos (10 críticos)
**Prioridade:** P1  
**Esforço:** 20-30 horas

**Testes a implementar:**
1. ✅ `complete_sale` com estoque válido → sucesso
2. ✅ `complete_sale` com estoque insuficiente → erro
3. ✅ `can(CASHIER, 'products.delete')` → false
4. ✅ User EMPLOYEE tenta INSERT produtos → denied by RLS
5. ✅ User ADMIN pode promover outro → allowed
6. ✅ User CASHIER tenta promover → denied by trigger
7. ✅ Soft delete produto → movimentações permanecem
8. ✅ PIX flow: create → approve → COMPLETED
9. ✅ Webhook com assinatura inválida → rejected
10. ✅ Cancel venda → estoque restaurado

**Config:**
```bash
npm install --save-dev vitest @testing-library/react @supabase/supabase-js
npx vitest run # CI
npx vitest # dev
```

---

### 🔐 LGPD Compliance
**Prioridade:** P1  
**Esforço:** 12-15 horas

**Tarefa 1: Adicionar Consentimento**
```tsx
// src/components/customers/NewCustomerModal.tsx
<label>
  <input type="checkbox" required onChange={e => setConsent(e.target.checked)} />
  Autorizo a coleta de meus dados para registro de vendas conforme a LGPD.
</label>
```

**Tarefa 2: Implementar Exclusão**
```ts
// src/services/customers.service.ts
async anonymizeCustomer(customerId: string) {
  return supabase.from('customers')
    .update({
      name: '[ANONIMIZADO]',
      cpf: null,
      phone: null,
      email: null,
      address: null,
      is_active: false,
      deleted_at: new Date().toISOString()
    })
    .eq('id', customerId);
}
```

**Tarefa 3: Política de Retenção**
```sql
-- Job PostgreSQL (rodar diariamente via pg_cron ou Temporal Tables)
UPDATE customers 
SET is_active = false, deleted_at = NOW()
WHERE is_active = true 
  AND (SELECT MAX(created_at) FROM sales WHERE customer_id = id) < NOW() - INTERVAL '3 years';
```

**Tarefa 4: Remover CPF Duplicado**
```sql
-- Remover customer_cpf de sales (manter só FK)
ALTER TABLE sales DROP COLUMN customer_cpf;
ALTER TABLE sales ADD COLUMN customer_id UUID REFERENCES customers(id);
```

---

### 🔒 Segurança Adicional
**Prioridade:** P1  
**Esforço:** 4 horas

- [ ] Implementar TTL em localStorage (1h)
- [ ] Validar CPF com biblioteca (0.5h)
- [ ] Tornar webhookSecret obrigatório (0.5h)
- [ ] Rate limiting no Supabase (1h)
- [ ] CORS com allowlist (1h)

---

### 🔄 CI/CD Básico
**Prioridade:** P1  
**Esforço:** 2-3 horas

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with: { node-version: 20 }
      - run: npm install
      - run: npm run lint
      - run: npm run type-check
      - run: npm test
```

**Subtotal Sprint 2:** ~35-40 horas

---

## SPRINT 3: PRODUÇÃO-READY (Semanas 5-6)

### 📊 Observabilidade
**Prioridade:** P1  
**Esforço:** 8-10 horas

```ts
// src/lib/logger.ts
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  tracesSampleRate: 1.0,
});

export const logger = {
  error: (msg: string, err: Error, context?: any) => {
    console.error(msg, err);
    Sentry.captureException(err, { extra: context });
  },
  warn: (msg: string, context?: any) => {
    console.warn(msg, context);
  },
  info: (msg: string, context?: any) => {
    console.log(msg, context);
  }
};
```

### 📋 Audit Log Genérico
**Prioridade:** P2  
**Esforço:** 10-12 horas

```sql
-- Tabela
CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  record_id UUID NOT NULL,
  old_data JSONB,
  new_data JSONB,
  user_id UUID,
  user_ip TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Triggers em tabelas sensíveis (products, sales, customers, profiles)
CREATE OR REPLACE FUNCTION audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_log (table_name, operation, record_id, old_data, new_data, user_id)
  VALUES (
    TG_TABLE_NAME,
    TG_OP,
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP = 'DELETE' THEN row_to_json(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN row_to_json(NEW) ELSE NULL END,
    auth.uid()
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Aplicar em: products, product_variants, sales, customers, profiles
CREATE TRIGGER products_audit AFTER INSERT OR UPDATE OR DELETE ON products
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();
```

### 📖 Documentação
**Prioridade:** P2  
**Esforço:** 5-8 horas

- [ ] API Reference (RPC + Edge Functions)
- [ ] Setup Guide (Deploy to Supabase)
- [ ] Architecture Diagram
- [ ] Runbook (incident response)
- [ ] LGPD Policy

### ✅ Teste de Staging
**Prioridade:** P1  
**Esforço:** 4-6 horas

- [ ] Deploy em staging
- [ ] Teste com dados sintéticos (1k clientes, 10k vendas)
- [ ] Teste de failover
- [ ] Teste de performance (load test)

**Subtotal Sprint 3:** ~30-40 horas

---

## 📊 ESTIMATIVA TOTAL

| Sprint | Foco | Horas | Semanas |
|--------|------|-------|---------|
| 1 | P0 Crítico | 40-45 | 2 |
| 2 | Testes + LGPD | 35-40 | 2 |
| 3 | Produção | 30-40 | 2 |
| **TOTAL** | | **105-125** | **6 semanas** |

---

## 🎯 MARCOS

| Milestone | Data | Critério |
|-----------|------|----------|
| **P0 Completo** | Semana 2 | Seed OK, PIX OK, Soft Delete OK |
| **Testes Verdes** | Semana 4 | 10+ testes com >80% coverage |
| **LGPD Ready** | Semana 4 | Consentimento, exclusão, retenção implementados |
| **Staging Test** | Semana 6 | Teste com 10k+ registros OK |
| **Go Live** | Semana 7 | Approval + monitoring ativo |

---

## 📋 CHECKLIST FINAL

Antes de produção com dados reais:

- [ ] P0 100% completo
- [ ] Seed SQL executa sem erro
- [ ] PIX fluxo completo testado
- [ ] Soft delete confirmado (não perde auditoria)
- [ ] 10+ testes passando
- [ ] LGPD conforme
- [ ] Observabilidade ativa (Sentry + alertas)
- [ ] CI/CD rodando
- [ ] Backup testado
- [ ] Rate limiting ativo
- [ ] Documentação completa
- [ ] Aprovação de stakeholders

---

## 🚀 RECOMENDAÇÃO

**Começar IMEDIATAMENTE com Sprint 1 (P0).** Não fazer qualquer venda real até P0 estar 100% completo.

Se equipe = 1 eng + 1 QA: ~10-12 semanas  
Se equipe = 2 eng + 1 QA: ~6-8 semanas  
Se equipe = 3 eng + 1 QA: ~4-6 semanas
