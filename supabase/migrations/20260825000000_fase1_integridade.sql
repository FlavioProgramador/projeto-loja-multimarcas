-- FASE 1: 1. Adicionar is_active em product_variants e customers
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- FASE 1: 4 e 5. Remover ON DELETE CASCADE de inventory_movements -> product_variants
ALTER TABLE public.inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_product_variant_id_fkey;
ALTER TABLE public.inventory_movements 
  ADD CONSTRAINT inventory_movements_product_variant_id_fkey 
  FOREIGN KEY (product_variant_id) 
  REFERENCES public.product_variants(id) 
  ON DELETE RESTRICT;

-- Remover ON DELETE CASCADE de product_variants -> products
ALTER TABLE public.product_variants DROP CONSTRAINT IF EXISTS product_variants_product_id_fkey;
ALTER TABLE public.product_variants
  ADD CONSTRAINT product_variants_product_id_fkey
  FOREIGN KEY (product_id)
  REFERENCES public.products(id)
  ON DELETE RESTRICT;

-- Remover ON DELETE CASCADE de sale_items -> sales
ALTER TABLE public.sale_items DROP CONSTRAINT IF EXISTS sale_items_sale_id_fkey;
ALTER TABLE public.sale_items
  ADD CONSTRAINT sale_items_sale_id_fkey
  FOREIGN KEY (sale_id)
  REFERENCES public.sales(id)
  ON DELETE RESTRICT;

-- Remover ON DELETE CASCADE de payments -> sales
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_sale_id_fkey;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_sale_id_fkey
  FOREIGN KEY (sale_id)
  REFERENCES public.sales(id)
  ON DELETE RESTRICT;

-- Extensão para gerar SKU robusto
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- RPC para gerenciamento robusto de Produtos e Variantes (Soft Delete, SKU único e estável)
CREATE OR REPLACE FUNCTION public.manage_product(
  p_product_id UUID,
  p_name TEXT,
  p_brand_name TEXT,
  p_category_name TEXT,
  p_sale_price NUMERIC,
  p_cost_price NUMERIC,
  p_variants JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_brand_id UUID;
  v_category_id UUID;
  v_product_id UUID;
  v_variant RECORD;
  v_variant_ids UUID[] := '{}';
  v_generated_sku TEXT;
  v_idx INT := 1;
BEGIN
  IF public.current_user_role() NOT IN ('ADMIN', 'MANAGER') THEN
    RAISE EXCEPTION 'Permissão negada.';
  END IF;

  IF p_brand_name IS NOT NULL AND trim(p_brand_name) != '' THEN
    SELECT id INTO v_brand_id FROM public.brands WHERE name ILIKE trim(p_brand_name) LIMIT 1;
    IF v_brand_id IS NULL THEN
      INSERT INTO public.brands (name) VALUES (trim(p_brand_name)) RETURNING id INTO v_brand_id;
    END IF;
  END IF;

  IF p_category_name IS NOT NULL AND trim(p_category_name) != '' THEN
    SELECT id INTO v_category_id FROM public.categories WHERE name ILIKE trim(p_category_name) LIMIT 1;
    IF v_category_id IS NULL THEN
      INSERT INTO public.categories (name) VALUES (trim(p_category_name)) RETURNING id INTO v_category_id;
    END IF;
  END IF;

  IF p_product_id IS NOT NULL THEN
    UPDATE public.products SET
      name = trim(p_name),
      brand_id = v_brand_id,
      category_id = v_category_id,
      sale_price = COALESCE(p_sale_price, sale_price),
      cost_price = COALESCE(p_cost_price, cost_price)
    WHERE id = p_product_id
    RETURNING id INTO v_product_id;
  ELSE
    INSERT INTO public.products (name, brand_id, category_id, sale_price, cost_price)
    VALUES (trim(p_name), v_brand_id, v_category_id, p_sale_price, COALESCE(p_cost_price, 0))
    RETURNING id INTO v_product_id;
  END IF;

  FOR v_variant IN SELECT * FROM jsonb_to_recordset(p_variants) AS (
    id UUID, sku TEXT, barcode TEXT, size TEXT, color TEXT, stock_quantity INT
  ) LOOP
    v_generated_sku := v_variant.sku;
    IF v_generated_sku IS NULL OR trim(v_generated_sku) = '' THEN
      v_generated_sku := upper(substring(regexp_replace(unaccent(p_name), '[^a-zA-Z0-9]', '', 'g') from 1 for 4)) || 
                         '-' || upper(substring(regexp_replace(unaccent(v_variant.size), '[^a-zA-Z0-9]', '', 'g') from 1 for 3)) || 
                         '-' || upper(substring(regexp_replace(unaccent(v_variant.color), '[^a-zA-Z0-9]', '', 'g') from 1 for 3));
      WHILE EXISTS (SELECT 1 FROM public.product_variants WHERE sku = v_generated_sku AND (v_variant.id IS NULL OR id != v_variant.id)) LOOP
        v_generated_sku := v_generated_sku || v_idx::TEXT;
        v_idx := v_idx + 1;
      END LOOP;
    END IF;

    IF v_variant.barcode IS NOT NULL AND trim(v_variant.barcode) != '' THEN
      IF EXISTS (SELECT 1 FROM public.product_variants WHERE barcode = v_variant.barcode AND (v_variant.id IS NULL OR id != v_variant.id)) THEN
        RAISE EXCEPTION 'Código de barras % já está em uso.', v_variant.barcode;
      END IF;
    END IF;

    IF v_variant.id IS NOT NULL THEN
      UPDATE public.product_variants SET
        sku = trim(v_generated_sku),
        barcode = NULLIF(trim(v_variant.barcode), ''),
        size = COALESCE(v_variant.size, 'Único'),
        color = COALESCE(v_variant.color, 'Padrão'),
        is_active = true
      WHERE id = v_variant.id;
      v_variant_ids := array_append(v_variant_ids, v_variant.id);
    ELSE
      INSERT INTO public.product_variants (product_id, sku, barcode, size, color, stock_quantity, is_active)
      VALUES (
        v_product_id, 
        trim(v_generated_sku), 
        NULLIF(trim(v_variant.barcode), ''), 
        COALESCE(v_variant.size, 'Único'), 
        COALESCE(v_variant.color, 'Padrão'), 
        GREATEST(0, COALESCE(v_variant.stock_quantity, 0)),
        true
      )
      RETURNING id INTO v_variant.id;
      v_variant_ids := array_append(v_variant_ids, v_variant.id);
    END IF;
  END LOOP;

  UPDATE public.product_variants 
  SET is_active = false 
  WHERE product_id = v_product_id AND NOT (id = ANY(v_variant_ids));

  RETURN jsonb_build_object('success', true, 'product_id', v_product_id);
END;
$$;

-- Restrição adicional de integridade para cost_price
ALTER TABLE public.products ADD CONSTRAINT products_cost_price_check CHECK (cost_price >= 0);
