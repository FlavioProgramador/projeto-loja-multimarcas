-- Phase 3: prevent direct mutation of sales by authenticated clients.
-- Sensitive sale state changes must use the transactional RPCs.
DROP POLICY IF EXISTS "Sales updatable by store managers" ON public.sales;
