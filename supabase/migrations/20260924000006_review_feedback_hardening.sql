-- Correções adicionais derivadas da revisão automática do PR.
-- A autorização é reforçada também por trigger, evitando que outra RPC
-- insira uma venda PENDING/COMPLETED sem o papel permitido na loja.

CREATE OR REPLACE FUNCTION public.enforce_sale_store_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT;
  v_request_role TEXT;
BEGIN
  v_request_role := current_setting('request.jwt.claims', true)::json->>'role';
  IF v_request_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autorizado.';
  END IF;

  v_role := public.get_user_store_role(NEW.store_id);
  IF v_role NOT IN ('ADMIN', 'MANAGER', 'CASHIER') THEN
    RAISE EXCEPTION 'Permissão negada para registrar venda nesta loja.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_sale_store_role ON public.sales;
CREATE TRIGGER trg_enforce_sale_store_role
  BEFORE INSERT ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_sale_store_role();

REVOKE EXECUTE ON FUNCTION public.enforce_sale_store_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_sale_store_role() TO authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sale_idempotency_key
  ON public.sale_idempotency (idempotency_key);

ALTER TABLE public.store_inventory
  DROP CONSTRAINT IF EXISTS store_inventory_quantity_nonnegative;

ALTER TABLE public.store_inventory
  ADD CONSTRAINT store_inventory_quantity_nonnegative
  CHECK (quantity >= 0);
