-- CoreSys Phase 2.5B: consolidate commercial report summary into one RPC.
-- Keeps the existing report semantics while reducing client round-trips.

BEGIN;

CREATE OR REPLACE FUNCTION public.report_commercial_summary(
  p_store_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_active boolean;
  v_role text;
  v_start timestamptz;
  v_end_exclusive timestamptz;
  v_sales_count bigint := 0;
  v_revenue numeric := 0;
  v_discounts numeric := 0;
  v_expenses numeric := 0;
  v_inventory_units bigint := 0;
  v_payments jsonb := '[]'::jsonb;
  v_series jsonb := '[]'::jsonb;
BEGIN
  SELECT p.is_active
    INTO v_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_uid IS NULL OR COALESCE(v_active, false) = false THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;

  IF p_store_id IS NULL OR NOT public.has_store_access(p_store_id) THEN
    RAISE EXCEPTION 'Acesso negado à loja.';
  END IF;

  v_role := public.get_user_store_role(p_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN', 'MANAGER') THEN
    RAISE EXCEPTION 'Permissão negada para relatórios desta loja.';
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Intervalo inválido.';
  END IF;

  v_start := p_start_date::timestamp AT TIME ZONE 'UTC';
  v_end_exclusive := (p_end_date + 1)::timestamp AT TIME ZONE 'UTC';

  SELECT
    count(*)::bigint,
    COALESCE(sum(s.total), 0)::numeric,
    COALESCE(sum(s.discount), 0)::numeric
  INTO v_sales_count, v_revenue, v_discounts
  FROM public.sales s
  WHERE s.store_id = p_store_id
    AND s.status = 'COMPLETED'
    AND s.created_at >= v_start
    AND s.created_at < v_end_exclusive;

  SELECT COALESCE(sum(ft.amount), 0)::numeric
  INTO v_expenses
  FROM public.financial_transactions ft
  WHERE ft.store_id = p_store_id
    AND ft.type = 'EXPENSE'
    AND ft.status <> 'CANCELLED'
    AND ft.created_at >= v_start
    AND ft.created_at < v_end_exclusive;

  SELECT COALESCE(sum(si.quantity), 0)::bigint
  INTO v_inventory_units
  FROM public.store_inventory si
  WHERE si.store_id = p_store_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'method', x.method,
        'amount', x.amount
      )
      ORDER BY x.amount DESC, x.method
    ),
    '[]'::jsonb
  )
  INTO v_payments
  FROM (
    SELECT
      COALESCE(p.method, 'OUTRO')::text AS method,
      COALESCE(sum(p.amount), 0)::numeric AS amount
    FROM public.payments p
    JOIN public.sales s ON s.id = p.sale_id
    WHERE s.store_id = p_store_id
      AND s.status = 'COMPLETED'
      AND p.status <> 'CANCELLED'
      AND p.created_at >= v_start
      AND p.created_at < v_end_exclusive
    GROUP BY COALESCE(p.method, 'OUTRO')
  ) x;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'label', x.label,
        'revenue', x.revenue,
        'orders', x.orders
      )
      ORDER BY x.label
    ),
    '[]'::jsonb
  )
  INTO v_series
  FROM (
    SELECT
      to_char(s.created_at AT TIME ZONE 'UTC', 'YYYY-MM') AS label,
      COALESCE(sum(s.total), 0)::numeric AS revenue,
      count(*)::bigint AS orders
    FROM public.sales s
    WHERE s.store_id = p_store_id
      AND s.status = 'COMPLETED'
      AND s.created_at >= v_start
      AND s.created_at < v_end_exclusive
    GROUP BY to_char(s.created_at AT TIME ZONE 'UTC', 'YYYY-MM')
  ) x;

  RETURN jsonb_build_object(
    'overview', jsonb_build_object(
      'salesCount', v_sales_count,
      'revenue', v_revenue,
      'discounts', v_discounts,
      'expenses', v_expenses,
      'operatingResult', v_revenue - v_expenses,
      'averageTicket', CASE
        WHEN v_sales_count > 0 THEN v_revenue / v_sales_count
        ELSE 0
      END,
      'inventoryUnits', v_inventory_units,
      'inventoryValue', 0
    ),
    'payments', v_payments,
    'series', v_series
  );
END;
$$;

REVOKE ALL ON FUNCTION public.report_commercial_summary(uuid,date,date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_commercial_summary(uuid,date,date)
  TO authenticated;

COMMIT;
