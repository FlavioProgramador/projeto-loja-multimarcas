-- CoreSys Phase 2.5C: server-side pagination and on-demand heavy data.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_customer_directory_page(
  p_store_id uuid,
  p_search text DEFAULT NULL,
  p_credit_filter text DEFAULT 'all',
  p_sort text DEFAULT 'name',
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
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
  v_total bigint := 0;
  v_rows jsonb := '[]'::jsonb;
  v_stats jsonb := '{}'::jsonb;
BEGIN
  SELECT is_active INTO v_active FROM public.profiles WHERE id = v_uid;
  IF v_uid IS NULL OR COALESCE(v_active, false) = false THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;
  IF p_store_id IS NULL OR NOT public.has_store_access(p_store_id) THEN
    RAISE EXCEPTION 'Acesso negado à loja.';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'Paginação inválida.';
  END IF;
  IF p_credit_filter NOT IN ('all', 'with-credit', 'without-credit') THEN
    RAISE EXCEPTION 'Filtro de crédito inválido.';
  END IF;
  IF p_sort NOT IN ('name', 'spending', 'purchases', 'recent') THEN
    RAISE EXCEPTION 'Ordenação inválida.';
  END IF;

  WITH sales_agg AS (
    SELECT
      s.customer_id,
      count(*)::bigint AS total_purchases,
      COALESCE(sum(s.total), 0)::numeric AS total_spent,
      max(s.created_at) AS last_purchase_at
    FROM public.sales s
    WHERE s.store_id = p_store_id
      AND s.customer_id IS NOT NULL
      AND s.status = 'COMPLETED'
    GROUP BY s.customer_id
  ),
  credit_agg AS (
    SELECT
      m.customer_id,
      GREATEST(
        0,
        COALESCE(sum(CASE WHEN m.type = 'CREDIT' THEN m.amount ELSE -m.amount END), 0)
      )::numeric AS credit_balance
    FROM public.customer_credit_movements m
    WHERE m.store_id = p_store_id
    GROUP BY m.customer_id
  ),
  base AS (
    SELECT
      c.id,
      c.name,
      c.cpf,
      c.rg,
      c.phone,
      c.email,
      c.address,
      c.birth_date,
      COALESCE(sa.total_purchases, 0)::bigint AS total_purchases,
      COALESCE(sa.total_spent, 0)::numeric AS total_spent,
      sa.last_purchase_at,
      COALESCE(ca.credit_balance, 0)::numeric AS credit_balance
    FROM public.customers c
    LEFT JOIN sales_agg sa ON sa.customer_id = c.id
    LEFT JOIN credit_agg ca ON ca.customer_id = c.id
    WHERE c.store_id = p_store_id
      AND c.is_active = true
  ),
  filtered AS (
    SELECT *
    FROM base
    WHERE (
      NULLIF(btrim(COALESCE(p_search, '')), '') IS NULL
      OR name ILIKE '%' || btrim(p_search) || '%'
      OR COALESCE(cpf, '') ILIKE '%' || btrim(p_search) || '%'
      OR COALESCE(phone, '') ILIKE '%' || btrim(p_search) || '%'
      OR COALESCE(email, '') ILIKE '%' || btrim(p_search) || '%'
    )
    AND (
      p_credit_filter = 'all'
      OR (p_credit_filter = 'with-credit' AND credit_balance > 0)
      OR (p_credit_filter = 'without-credit' AND credit_balance <= 0)
    )
  )
  SELECT count(*) INTO v_total FROM filtered;

  WITH sales_agg AS (
    SELECT
      s.customer_id,
      count(*)::bigint AS total_purchases,
      COALESCE(sum(s.total), 0)::numeric AS total_spent,
      max(s.created_at) AS last_purchase_at
    FROM public.sales s
    WHERE s.store_id = p_store_id
      AND s.customer_id IS NOT NULL
      AND s.status = 'COMPLETED'
    GROUP BY s.customer_id
  ),
  credit_agg AS (
    SELECT
      m.customer_id,
      GREATEST(
        0,
        COALESCE(sum(CASE WHEN m.type = 'CREDIT' THEN m.amount ELSE -m.amount END), 0)
      )::numeric AS credit_balance
    FROM public.customer_credit_movements m
    WHERE m.store_id = p_store_id
    GROUP BY m.customer_id
  ),
  base AS (
    SELECT
      c.id,
      c.name,
      c.cpf,
      c.rg,
      c.phone,
      c.email,
      c.address,
      c.birth_date,
      COALESCE(sa.total_purchases, 0)::bigint AS total_purchases,
      COALESCE(sa.total_spent, 0)::numeric AS total_spent,
      sa.last_purchase_at,
      COALESCE(ca.credit_balance, 0)::numeric AS credit_balance
    FROM public.customers c
    LEFT JOIN sales_agg sa ON sa.customer_id = c.id
    LEFT JOIN credit_agg ca ON ca.customer_id = c.id
    WHERE c.store_id = p_store_id
      AND c.is_active = true
  ),
  filtered AS (
    SELECT *
    FROM base
    WHERE (
      NULLIF(btrim(COALESCE(p_search, '')), '') IS NULL
      OR name ILIKE '%' || btrim(p_search) || '%'
      OR COALESCE(cpf, '') ILIKE '%' || btrim(p_search) || '%'
      OR COALESCE(phone, '') ILIKE '%' || btrim(p_search) || '%'
      OR COALESCE(email, '') ILIKE '%' || btrim(p_search) || '%'
    )
    AND (
      p_credit_filter = 'all'
      OR (p_credit_filter = 'with-credit' AND credit_balance > 0)
      OR (p_credit_filter = 'without-credit' AND credit_balance <= 0)
    )
  ),
  page_rows AS (
    SELECT *
    FROM filtered
    ORDER BY
      CASE WHEN p_sort = 'spending' THEN total_spent END DESC NULLS LAST,
      CASE WHEN p_sort = 'purchases' THEN total_purchases END DESC NULLS LAST,
      CASE WHEN p_sort = 'recent' THEN last_purchase_at END DESC NULLS LAST,
      CASE WHEN p_sort = 'name' THEN lower(name) END ASC NULLS LAST,
      lower(name) ASC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'name', name,
        'cpf', cpf,
        'rg', rg,
        'phone', phone,
        'email', email,
        'address', address,
        'birth_date', birth_date,
        'total_purchases', total_purchases,
        'total_spent', total_spent,
        'last_purchase_at', last_purchase_at,
        'credit_balance', credit_balance
      )
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM page_rows;

  WITH sales_agg AS (
    SELECT
      s.customer_id,
      count(*)::bigint AS total_purchases,
      COALESCE(sum(s.total), 0)::numeric AS total_spent
    FROM public.sales s
    WHERE s.store_id = p_store_id
      AND s.customer_id IS NOT NULL
      AND s.status = 'COMPLETED'
    GROUP BY s.customer_id
  ),
  credit_agg AS (
    SELECT
      m.customer_id,
      GREATEST(
        0,
        COALESCE(sum(CASE WHEN m.type = 'CREDIT' THEN m.amount ELSE -m.amount END), 0)
      )::numeric AS credit_balance
    FROM public.customer_credit_movements m
    WHERE m.store_id = p_store_id
    GROUP BY m.customer_id
  ),
  base AS (
    SELECT
      c.id,
      COALESCE(sa.total_purchases, 0)::bigint AS total_purchases,
      COALESCE(sa.total_spent, 0)::numeric AS total_spent,
      COALESCE(ca.credit_balance, 0)::numeric AS credit_balance
    FROM public.customers c
    LEFT JOIN sales_agg sa ON sa.customer_id = c.id
    LEFT JOIN credit_agg ca ON ca.customer_id = c.id
    WHERE c.store_id = p_store_id
      AND c.is_active = true
  )
  SELECT jsonb_build_object(
    'totalCustomers', count(*),
    'activeCustomers', count(*),
    'customersWithCredit', count(*) FILTER (WHERE credit_balance > 0),
    'totalPurchases', COALESCE(sum(total_purchases), 0),
    'totalRevenue', COALESCE(sum(total_spent), 0),
    'creditBalance', COALESCE(sum(credit_balance), 0)
  )
  INTO v_stats
  FROM base;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'stats', v_stats
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_detail(
  p_store_id uuid,
  p_customer_id uuid
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
  v_customer record;
  v_history jsonb := '[]'::jsonb;
  v_credit_movements jsonb := '[]'::jsonb;
  v_credit_balance numeric := 0;
BEGIN
  SELECT is_active INTO v_active FROM public.profiles WHERE id = v_uid;
  IF v_uid IS NULL OR COALESCE(v_active, false) = false THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;
  IF p_store_id IS NULL OR NOT public.has_store_access(p_store_id) THEN
    RAISE EXCEPTION 'Acesso negado à loja.';
  END IF;

  SELECT c.*
  INTO v_customer
  FROM public.customers c
  WHERE c.id = p_customer_id
    AND c.store_id = p_store_id
    AND c.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não encontrado nesta loja.';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'sale_id', s.id,
        'sale_number', s.sale_number,
        'total', s.total,
        'created_at', s.created_at,
        'status', CASE
          WHEN EXISTS (
            SELECT 1
            FROM public.returns r
            WHERE r.original_sale_id = s.id
              AND r.store_id = p_store_id
              AND r.status = 'CONCLUIDO'
          ) THEN 'DEVOLUCAO'
          ELSE 'CONCLUIDA'
        END,
        'payment_method', (
          SELECT p.method
          FROM public.payments p
          WHERE p.sale_id = s.id
            AND p.status <> 'CANCELLED'
          ORDER BY
            CASE WHEN p.status = 'APPROVED' THEN 0 ELSE 1 END,
            p.created_at DESC
          LIMIT 1
        ),
        'payment_installments', COALESCE((
          SELECT p.installments
          FROM public.payments p
          WHERE p.sale_id = s.id
            AND p.status <> 'CANCELLED'
          ORDER BY
            CASE WHEN p.status = 'APPROVED' THEN 0 ELSE 1 END,
            p.created_at DESC
          LIMIT 1
        ), 1),
        'payment_status', (
          SELECT p.status
          FROM public.payments p
          WHERE p.sale_id = s.id
            AND p.status <> 'CANCELLED'
          ORDER BY
            CASE WHEN p.status = 'APPROVED' THEN 0 ELSE 1 END,
            p.created_at DESC
          LIMIT 1
        ),
        'items', COALESCE((
          SELECT string_agg(si.product_name || ' x' || si.quantity::text, ', ' ORDER BY si.created_at)
          FROM public.sale_items si
          WHERE si.sale_id = s.id
        ), 'Venda PDV')
      )
      ORDER BY s.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_history
  FROM public.sales s
  WHERE s.store_id = p_store_id
    AND s.customer_id = p_customer_id
    AND s.status = 'COMPLETED';

  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'type', m.type,
          'amount', m.amount,
          'description', m.description,
          'created_at', m.created_at,
          'reference_id', m.reference_id
        )
        ORDER BY m.created_at DESC
      ),
      '[]'::jsonb
    ),
    GREATEST(
      0,
      COALESCE(sum(CASE WHEN m.type = 'CREDIT' THEN m.amount ELSE -m.amount END), 0)
    )
  INTO v_credit_movements, v_credit_balance
  FROM public.customer_credit_movements m
  WHERE m.store_id = p_store_id
    AND m.customer_id = p_customer_id;

  RETURN jsonb_build_object(
    'id', v_customer.id,
    'name', v_customer.name,
    'cpf', v_customer.cpf,
    'rg', v_customer.rg,
    'phone', v_customer.phone,
    'email', v_customer.email,
    'address', v_customer.address,
    'birth_date', v_customer.birth_date,
    'credit_balance', v_credit_balance,
    'history', v_history,
    'credit_movements', v_credit_movements
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_finance_page(
  p_store_id uuid,
  p_start_date timestamptz DEFAULT NULL,
  p_type text DEFAULT 'ALL',
  p_status text DEFAULT 'ALL',
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 15,
  p_offset integer DEFAULT 0
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
  v_total bigint := 0;
  v_rows jsonb := '[]'::jsonb;
  v_summary jsonb := '{}'::jsonb;
BEGIN
  SELECT is_active INTO v_active FROM public.profiles WHERE id = v_uid;
  IF v_uid IS NULL OR COALESCE(v_active, false) = false THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;
  IF p_store_id IS NULL OR NOT public.has_store_access(p_store_id) THEN
    RAISE EXCEPTION 'Acesso negado à loja.';
  END IF;
  v_role := public.get_user_store_role(p_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN', 'MANAGER') THEN
    RAISE EXCEPTION 'Permissão negada para o financeiro desta loja.';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'Paginação inválida.';
  END IF;
  IF p_type NOT IN ('ALL', 'INCOME', 'EXPENSE') THEN
    RAISE EXCEPTION 'Tipo financeiro inválido.';
  END IF;
  IF p_status NOT IN ('ALL', 'PENDING', 'PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'Status financeiro inválido.';
  END IF;

  WITH filtered AS (
    SELECT ft.*
    FROM public.financial_transactions ft
    WHERE ft.store_id = p_store_id
      AND (p_start_date IS NULL OR ft.created_at >= p_start_date)
      AND (p_type = 'ALL' OR ft.type = p_type)
      AND (p_status = 'ALL' OR ft.status = p_status)
      AND (
        NULLIF(btrim(COALESCE(p_search, '')), '') IS NULL
        OR ft.description ILIKE '%' || btrim(p_search) || '%'
        OR COALESCE(ft.category, '') ILIKE '%' || btrim(p_search) || '%'
        OR COALESCE(ft.reference_type, '') ILIKE '%' || btrim(p_search) || '%'
        OR COALESCE(ft.reference_id::text, '') ILIKE '%' || btrim(p_search) || '%'
        OR ft.id::text ILIKE '%' || btrim(p_search) || '%'
      )
  )
  SELECT
    count(*)::bigint,
    jsonb_build_object(
      'income', COALESCE(sum(amount) FILTER (WHERE status = 'PAID' AND type = 'INCOME'), 0),
      'expense', COALESCE(sum(amount) FILTER (WHERE status = 'PAID' AND type = 'EXPENSE'), 0),
      'pending', COALESCE(sum(amount) FILTER (WHERE status = 'PENDING'), 0),
      'balance',
        COALESCE(sum(amount) FILTER (WHERE status = 'PAID' AND type = 'INCOME'), 0)
        - COALESCE(sum(amount) FILTER (WHERE status = 'PAID' AND type = 'EXPENSE'), 0)
    )
  INTO v_total, v_summary
  FROM filtered;

  WITH filtered AS (
    SELECT ft.*
    FROM public.financial_transactions ft
    WHERE ft.store_id = p_store_id
      AND (p_start_date IS NULL OR ft.created_at >= p_start_date)
      AND (p_type = 'ALL' OR ft.type = p_type)
      AND (p_status = 'ALL' OR ft.status = p_status)
      AND (
        NULLIF(btrim(COALESCE(p_search, '')), '') IS NULL
        OR ft.description ILIKE '%' || btrim(p_search) || '%'
        OR COALESCE(ft.category, '') ILIKE '%' || btrim(p_search) || '%'
        OR COALESCE(ft.reference_type, '') ILIKE '%' || btrim(p_search) || '%'
        OR COALESCE(ft.reference_id::text, '') ILIKE '%' || btrim(p_search) || '%'
        OR ft.id::text ILIKE '%' || btrim(p_search) || '%'
      )
  ),
  page_rows AS (
    SELECT *
    FROM filtered
    ORDER BY created_at DESC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(page_rows)), '[]'::jsonb)
  INTO v_rows
  FROM page_rows;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'summary', v_summary
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_returns_page(
  p_store_id uuid,
  p_search text DEFAULT NULL,
  p_resolution_type text DEFAULT 'all',
  p_limit integer DEFAULT 15,
  p_offset integer DEFAULT 0
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
  v_total bigint := 0;
  v_rows jsonb := '[]'::jsonb;
  v_summary jsonb := '{}'::jsonb;
BEGIN
  SELECT is_active INTO v_active FROM public.profiles WHERE id = v_uid;
  IF v_uid IS NULL OR COALESCE(v_active, false) = false THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;
  IF p_store_id IS NULL OR NOT public.has_store_access(p_store_id) THEN
    RAISE EXCEPTION 'Acesso negado à loja.';
  END IF;
  v_role := public.get_user_store_role(p_store_id);
  IF v_role IS NULL OR v_role NOT IN ('ADMIN', 'MANAGER') THEN
    RAISE EXCEPTION 'Permissão negada para devoluções desta loja.';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'Paginação inválida.';
  END IF;
  IF p_resolution_type NOT IN ('all', 'credito_cliente', 'vale_troca', 'estorno_dinheiro') THEN
    RAISE EXCEPTION 'Tipo de resolução inválido.';
  END IF;

  SELECT count(*)
  INTO v_total
  FROM public.returns r
  WHERE r.store_id = p_store_id
    AND (p_resolution_type = 'all' OR r.resolution_type = p_resolution_type)
    AND (
      NULLIF(btrim(COALESCE(p_search, '')), '') IS NULL
      OR r.return_number ILIKE '%' || btrim(p_search) || '%'
      OR r.customer_name ILIKE '%' || btrim(p_search) || '%'
      OR COALESCE(r.customer_cpf, '') ILIKE '%' || btrim(p_search) || '%'
      OR COALESCE(r.original_sale_id::text, '') ILIKE '%' || btrim(p_search) || '%'
    );

  WITH page_rows AS (
    SELECT r.*
    FROM public.returns r
    WHERE r.store_id = p_store_id
      AND (p_resolution_type = 'all' OR r.resolution_type = p_resolution_type)
      AND (
        NULLIF(btrim(COALESCE(p_search, '')), '') IS NULL
        OR r.return_number ILIKE '%' || btrim(p_search) || '%'
        OR r.customer_name ILIKE '%' || btrim(p_search) || '%'
        OR COALESCE(r.customer_cpf, '') ILIKE '%' || btrim(p_search) || '%'
        OR COALESCE(r.original_sale_id::text, '') ILIKE '%' || btrim(p_search) || '%'
      )
    ORDER BY r.created_at DESC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'return_number', r.return_number,
        'original_sale_id', r.original_sale_id,
        'customer_id', r.customer_id,
        'customer_name', r.customer_name,
        'customer_cpf', r.customer_cpf,
        'resolution_type', r.resolution_type,
        'status', r.status,
        'total_amount', r.total_amount,
        'observations', r.observations,
        'expires_at', r.expires_at,
        'created_at', r.created_at,
        'return_items', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'product_id', ri.product_id,
              'product_variant_id', ri.product_variant_id,
              'product_name', ri.product_name,
              'size', ri.size,
              'color', ri.color,
              'unit_price', ri.unit_price,
              'quantity', ri.quantity,
              'reason', ri.reason
            )
            ORDER BY ri.created_at
          )
          FROM public.return_items ri
          WHERE ri.return_id = r.id
        ), '[]'::jsonb)
      )
      ORDER BY r.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM page_rows r;

  WITH credit_by_customer AS (
    SELECT
      m.customer_id,
      GREATEST(
        0,
        COALESCE(sum(CASE WHEN m.type = 'CREDIT' THEN m.amount ELSE -m.amount END), 0)
      )::numeric AS balance
    FROM public.customer_credit_movements m
    WHERE m.store_id = p_store_id
    GROUP BY m.customer_id
  )
  SELECT jsonb_build_object(
    'occurrences', (SELECT count(*) FROM public.returns r WHERE r.store_id = p_store_id),
    'totalPieces', COALESCE((
      SELECT sum(ri.quantity)
      FROM public.return_items ri
      JOIN public.returns r ON r.id = ri.return_id
      WHERE r.store_id = p_store_id
    ), 0),
    'totalCredits', COALESCE((
      SELECT sum(r.total_amount)
      FROM public.returns r
      WHERE r.store_id = p_store_id
    ), 0),
    'customerCreditBalance', COALESCE((SELECT sum(balance) FROM credit_by_customer), 0),
    'customersWithCredit', COALESCE((SELECT count(*) FROM credit_by_customer WHERE balance > 0), 0)
  )
  INTO v_summary;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'summary', v_summary
  );
END;
$$;

-- Reconcile historical sales that already contain a CPF but were not linked by customer_id.
WITH customer_match AS (
  SELECT
    s.id AS sale_id,
    min(c.id::text)::uuid AS customer_id,
    count(*) AS matches
  FROM public.sales s
  JOIN public.customers c
    ON c.store_id = s.store_id
   AND c.is_active = true
   AND nullif(regexp_replace(coalesce(c.cpf, ''), '[^0-9]', '', 'g'), '') =
       nullif(regexp_replace(coalesce(s.customer_cpf, ''), '[^0-9]', '', 'g'), '')
  WHERE s.customer_id IS NULL
    AND nullif(regexp_replace(coalesce(s.customer_cpf, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
  GROUP BY s.id
)
UPDATE public.sales s
SET customer_id = cm.customer_id
FROM customer_match cm
WHERE s.id = cm.sale_id
  AND cm.matches = 1
  AND s.customer_id IS NULL;

-- Keep the relationship correct for every future sale path (PDV, PIX and other RPCs).
CREATE OR REPLACE FUNCTION public.resolve_sale_customer_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $resolve_sale_customer_link$
DECLARE
  v_customer_id uuid;
  v_matches integer := 0;
  v_cpf text;
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id = NEW.customer_id
        AND c.store_id = NEW.store_id
        AND c.is_active = true
    ) THEN
      RAISE EXCEPTION 'Cliente inválido para esta loja.';
    END IF;
    RETURN NEW;
  END IF;

  v_cpf := nullif(regexp_replace(coalesce(NEW.customer_cpf, ''), '[^0-9]', '', 'g'), '');
  IF v_cpf IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT min(c.id::text)::uuid, count(*)
    INTO v_customer_id, v_matches
  FROM public.customers c
  WHERE c.store_id = NEW.store_id
    AND c.is_active = true
    AND nullif(regexp_replace(coalesce(c.cpf, ''), '[^0-9]', '', 'g'), '') = v_cpf;

  IF v_matches = 1 THEN
    NEW.customer_id := v_customer_id;
  END IF;

  RETURN NEW;
END;
$resolve_sale_customer_link$;

DROP TRIGGER IF EXISTS trg_resolve_sale_customer_link ON public.sales;
CREATE TRIGGER trg_resolve_sale_customer_link
BEFORE INSERT OR UPDATE OF customer_id, customer_cpf, store_id
ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.resolve_sale_customer_link();

REVOKE ALL ON FUNCTION public.resolve_sale_customer_link() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_sale_customer_link() TO service_role;

REVOKE ALL ON FUNCTION public.get_customer_directory_page(uuid,text,text,text,integer,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_directory_page(uuid,text,text,text,integer,integer)
  TO authenticated;

REVOKE ALL ON FUNCTION public.get_customer_detail(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_detail(uuid,uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.get_finance_page(uuid,timestamptz,text,text,text,integer,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_finance_page(uuid,timestamptz,text,text,text,integer,integer)
  TO authenticated;

REVOKE ALL ON FUNCTION public.get_returns_page(uuid,text,text,integer,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_returns_page(uuid,text,text,integer,integer)
  TO authenticated;

COMMIT;
