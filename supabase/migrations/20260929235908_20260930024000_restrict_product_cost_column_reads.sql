BEGIN;
REVOKE SELECT ON public.products FROM anon, authenticated;
GRANT SELECT (id, brand_id, category_id, name, description, sale_price, minimum_stock, is_active, image_url, created_at, updated_at) ON public.products TO anon, authenticated;
COMMIT;