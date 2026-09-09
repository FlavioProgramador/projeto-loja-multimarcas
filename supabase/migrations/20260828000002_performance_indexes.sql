-- ============================================================================
-- MIGRATION: 20260828000002_performance_indexes.sql
-- FASE 4: Otimização de Performance e Índices (FKs)
-- ============================================================================

-- Adicionar índices para Foreign Keys frequentemente utilizadas em JOINS
-- e que podem sofrer table scans durante atualizações ou deleções.

-- 1. inventory_movements -> profiles(user_id)
CREATE INDEX IF NOT EXISTS idx_inventory_mov_user_id ON public.inventory_movements(user_id);

-- 2. sale_items -> products(product_id)
-- Note: idx_sale_items_variant (product_variant_id) já existia no setup inicial
CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON public.sale_items(product_id);

-- 3. sales -> profiles(user_id)
CREATE INDEX IF NOT EXISTS idx_sales_user_id ON public.sales(user_id);
