-- 20260828000004_soft_delete_and_fixes.sql
-- Fixes ON DELETE CASCADE issues and adds soft delete columns to critical tables.

-- 1. Modify FOREIGN KEYS to use ON DELETE RESTRICT instead of ON DELETE CASCADE

-- Drop old foreign keys
ALTER TABLE public.product_variants DROP CONSTRAINT IF EXISTS product_variants_product_id_fkey;
ALTER TABLE public.inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_product_variant_id_fkey;
ALTER TABLE public.sale_items DROP CONSTRAINT IF EXISTS sale_items_sale_id_fkey;
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_sale_id_fkey;

-- Add new foreign keys with ON DELETE RESTRICT
ALTER TABLE public.product_variants
  ADD CONSTRAINT product_variants_product_id_fkey 
  FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;

ALTER TABLE public.inventory_movements
  ADD CONSTRAINT inventory_movements_product_variant_id_fkey 
  FOREIGN KEY (product_variant_id) REFERENCES public.product_variants(id) ON DELETE RESTRICT;

ALTER TABLE public.sale_items
  ADD CONSTRAINT sale_items_sale_id_fkey 
  FOREIGN KEY (sale_id) REFERENCES public.sales(id) ON DELETE RESTRICT;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_sale_id_fkey 
  FOREIGN KEY (sale_id) REFERENCES public.sales(id) ON DELETE RESTRICT;

-- 2. Add is_active flag to support Soft Delete where missing
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE public.inventory_movements ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE public.financial_transactions ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- 3. Replace 'entrada'/'saida' with 'INCOME'/'EXPENSE' in financial_transactions type constraint if needed.
-- In setup.sql it is already INCOME/EXPENSE, but let's make sure the database is updated if this runs on an older schema.
ALTER TABLE public.financial_transactions DROP CONSTRAINT IF EXISTS financial_transactions_type_check;

-- Update existing data
UPDATE public.financial_transactions SET type = 'INCOME' WHERE type = 'entrada';
UPDATE public.financial_transactions SET type = 'EXPENSE' WHERE type = 'saida';

-- Add new constraint
ALTER TABLE public.financial_transactions 
  ADD CONSTRAINT financial_transactions_type_check 
  CHECK (type IN ('INCOME', 'EXPENSE'));

