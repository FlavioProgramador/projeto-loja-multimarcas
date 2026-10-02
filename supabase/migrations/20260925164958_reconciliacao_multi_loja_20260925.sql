
DO $$
DECLARE
  v_store_id UUID;
BEGIN
  CREATE TABLE IF NOT EXISTS public.stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    location TEXT,
    is_main BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
  );
  CREATE TABLE IF NOT EXISTS public.user_store_access (
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('ADMIN','MANAGER','CASHIER','EMPLOYEE')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    PRIMARY KEY (user_id, store_id)
  );
  CREATE TABLE IF NOT EXISTS public.store_inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    product_variant_id UUID NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    minimum_stock INTEGER NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0),
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    UNIQUE(store_id, product_variant_id)
  );
  CREATE TABLE IF NOT EXISTS public.sale_idempotency (
    idempotency_key TEXT PRIMARY KEY,
    sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
  );

  ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES public.stores(id) ON DELETE RESTRICT;
  ALTER TABLE public.inventory_movements ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES public.stores(id) ON DELETE RESTRICT;
  ALTER TABLE public.financial_transactions ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES public.stores(id) ON DELETE RESTRICT;
  ALTER TABLE public.fixed_expenses ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES public.stores(id) ON DELETE RESTRICT;

  SELECT id INTO v_store_id FROM public.stores WHERE is_main = true ORDER BY created_at LIMIT 1;
  IF v_store_id IS NULL THEN SELECT id INTO v_store_id FROM public.stores ORDER BY created_at LIMIT 1; END IF;
  IF v_store_id IS NULL THEN
    INSERT INTO public.stores(name,is_main) VALUES ('Loja Principal',true) RETURNING id INTO v_store_id;
  END IF;

  INSERT INTO public.user_store_access(user_id,store_id,role,is_active)
    SELECT p.id,v_store_id,p.role,true FROM public.profiles p
    ON CONFLICT (user_id,store_id) DO UPDATE SET is_active=true, role=EXCLUDED.role;

  UPDATE public.sales SET store_id=v_store_id WHERE store_id IS NULL;
  UPDATE public.financial_transactions SET store_id=v_store_id WHERE store_id IS NULL;
  UPDATE public.fixed_expenses SET store_id=v_store_id WHERE store_id IS NULL;

  IF NOT EXISTS (SELECT 1 FROM public.store_inventory) THEN
    INSERT INTO public.store_inventory(store_id,product_variant_id,quantity,minimum_stock)
      SELECT v_store_id,pv.id,pv.stock_quantity,COALESCE(pv.minimum_stock,0)
      FROM public.product_variants pv
      ON CONFLICT DO NOTHING;
  END IF;

  BEGIN
    UPDATE public.inventory_movements im
      SET reason=COALESCE(im.reason, 'Migração histórica'),
          notes=COALESCE(im.notes, 'Movimentação histórica — loja atribuída pela reconciliação')
    WHERE im.store_id IS NULL;
    EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.sales ALTER COLUMN store_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.financial_transactions ALTER COLUMN store_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.fixed_expenses ALTER COLUMN store_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

CREATE OR REPLACE FUNCTION public.has_store_access(p_store_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_store_access usa WHERE usa.user_id=(select auth.uid()) AND usa.store_id=p_store_id AND usa.is_active=true);
$$;

CREATE OR REPLACE FUNCTION public.get_user_store_role(p_store_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT usa.role FROM public.user_store_access usa WHERE usa.user_id=(select auth.uid()) AND usa.store_id=p_store_id AND usa.is_active=true LIMIT 1;
$$;

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_store_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_idempotency ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Stores viewable by accessed users" ON public.stores;
CREATE POLICY "Stores viewable by accessed users" ON public.stores FOR SELECT TO authenticated USING (public.has_store_access(id) OR public.current_user_role()='ADMIN');

DROP POLICY IF EXISTS "User store access viewable by self or admin" ON public.user_store_access;
CREATE POLICY "User store access viewable by self or admin" ON public.user_store_access FOR SELECT TO authenticated USING (user_id=(select auth.uid()) OR public.current_user_role()='ADMIN');

DROP POLICY IF EXISTS "Inventory viewable by accessed users" ON public.store_inventory;
CREATE POLICY "Inventory viewable by accessed users" ON public.store_inventory FOR SELECT TO authenticated USING (public.has_store_access(store_id));
DROP POLICY IF EXISTS "Inventory manageable by Admin and Manager" ON public.store_inventory;
CREATE POLICY "Inventory manageable by Admin and Manager" ON public.store_inventory FOR ALL TO authenticated
 USING (public.get_user_store_role(store_id) IN ('ADMIN','MANAGER'))
 WITH CHECK (public.get_user_store_role(store_id) IN ('ADMIN','MANAGER'));

DROP POLICY IF EXISTS "Sales viewable by store access" ON public.sales;
DROP POLICY IF EXISTS "Sales viewable by authenticated" ON public.sales;
CREATE POLICY "Sales viewable by store access" ON public.sales FOR SELECT TO authenticated USING (public.has_store_access(store_id) OR public.current_user_role()='ADMIN');

DROP POLICY IF EXISTS "Movements viewable by store access" ON public.inventory_movements;
DROP POLICY IF EXISTS "Movements viewable by authenticated" ON public.inventory_movements;
CREATE POLICY "Movements viewable by store access" ON public.inventory_movements FOR SELECT TO authenticated USING (public.has_store_access(store_id) OR public.current_user_role()='ADMIN');

DROP POLICY IF EXISTS "Finance viewable by Admin Manager Cashier" ON public.financial_transactions;
DROP POLICY IF EXISTS "Finance viewable by store access" ON public.financial_transactions;
CREATE POLICY "Finance viewable by store access" ON public.financial_transactions FOR SELECT TO authenticated USING (public.has_store_access(store_id) OR public.current_user_role()='ADMIN');
DROP POLICY IF EXISTS "Finance insertable by Cashier" ON public.financial_transactions;
DROP POLICY IF EXISTS "Finance insertable by store roles" ON public.financial_transactions;
CREATE POLICY "Finance insertable by store roles" ON public.financial_transactions FOR INSERT TO authenticated WITH CHECK (public.get_user_store_role(store_id) IN ('ADMIN','MANAGER','CASHIER'));
DROP POLICY IF EXISTS "Finance manageable by Admin and Manager" ON public.financial_transactions;
CREATE POLICY "Finance manageable by store roles" ON public.financial_transactions FOR UPDATE TO authenticated
 USING (public.get_user_store_role(store_id) IN ('ADMIN','MANAGER'))
 WITH CHECK (public.get_user_store_role(store_id) IN ('ADMIN','MANAGER'));
DROP POLICY IF EXISTS "Finance deletable by roles" ON public.financial_transactions;
CREATE POLICY "Finance deletable by store roles" ON public.financial_transactions FOR DELETE TO authenticated USING (public.get_user_store_role(store_id)='ADMIN');

DROP POLICY IF EXISTS "Fixed expenses viewable by authenticated" ON public.fixed_expenses;
DROP POLICY IF EXISTS "Fixed expenses viewable by store access" ON public.fixed_expenses;
CREATE POLICY "Fixed expenses viewable by store access" ON public.fixed_expenses FOR SELECT TO authenticated USING (public.has_store_access(store_id) OR public.current_user_role()='ADMIN');
DROP POLICY IF EXISTS "Fixed expenses manageable by Admin and Manager" ON public.fixed_expenses;
CREATE POLICY "Fixed expenses manageable by store roles" ON public.fixed_expenses FOR ALL TO authenticated
 USING (public.get_user_store_role(store_id) IN ('ADMIN','MANAGER'))
 WITH CHECK (public.get_user_store_role(store_id) IN ('ADMIN','MANAGER'));

CREATE INDEX IF NOT EXISTS idx_store_inventory_store_variant ON public.store_inventory(store_id,product_variant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_store_variant_created ON public.inventory_movements(store_id,product_variant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_store_created ON public.financial_transactions(store_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fixed_expenses_store_due ON public.fixed_expenses(store_id,due_date);
CREATE INDEX IF NOT EXISTS idx_sales_store_created ON public.sales(store_id,created_at DESC);
