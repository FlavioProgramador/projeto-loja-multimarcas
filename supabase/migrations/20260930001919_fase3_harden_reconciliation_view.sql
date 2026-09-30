BEGIN;
ALTER VIEW public.inventory_reconciliation SET (security_invoker=true);
COMMIT;
