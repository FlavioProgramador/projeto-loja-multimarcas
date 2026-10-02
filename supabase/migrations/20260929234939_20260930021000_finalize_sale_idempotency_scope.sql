BEGIN;
ALTER TABLE public.sale_idempotency DROP CONSTRAINT IF EXISTS sale_idempotency_pkey;
UPDATE public.sale_idempotency i SET idempotency_key=s.user_id::text||':'||s.store_id::text||':'||i.idempotency_key FROM public.sales s WHERE s.id=i.sale_id AND i.idempotency_key NOT LIKE s.user_id::text||':'||s.store_id::text||':%';
ALTER TABLE public.sale_idempotency ADD CONSTRAINT sale_idempotency_pkey PRIMARY KEY (idempotency_key);
CREATE OR REPLACE FUNCTION public.set_sale_idempotency_scope() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user uuid; v_store uuid;
BEGIN
 SELECT s.user_id,s.store_id INTO v_user,v_store FROM public.sales s WHERE s.id=NEW.sale_id;
 IF v_user IS NULL OR v_store IS NULL THEN RAISE EXCEPTION 'Venda inválida para registro de idempotência.'; END IF;
 NEW.user_id:=v_user; NEW.store_id:=v_store;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_sale_idempotency_scope ON public.sale_idempotency;
CREATE TRIGGER trg_sale_idempotency_scope BEFORE INSERT OR UPDATE OF sale_id ON public.sale_idempotency FOR EACH ROW EXECUTE FUNCTION public.set_sale_idempotency_scope();
REVOKE ALL ON FUNCTION public.set_sale_idempotency_scope() FROM PUBLIC,anon,authenticated;
COMMIT;