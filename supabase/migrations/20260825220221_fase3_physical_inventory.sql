CREATE TABLE IF NOT EXISTS public.physical_inventories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_id UUID NOT NULL REFERENCES public.stores(id),
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    notes TEXT,
    created_by UUID NOT NULL REFERENCES auth.users(id),
    approved_by UUID REFERENCES auth.users(id),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.physical_inventory_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    inventory_id UUID NOT NULL REFERENCES public.physical_inventories(id) ON DELETE CASCADE,
    product_variant_id UUID NOT NULL REFERENCES public.product_variants(id),
    expected_quantity INTEGER NOT NULL DEFAULT 0,
    counted_quantity INTEGER,
    divergence INTEGER,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(inventory_id, product_variant_id)
);

-- Trigger para updated_at
CREATE TRIGGER handle_updated_at_physical_inventories
    BEFORE UPDATE ON public.physical_inventories
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER handle_updated_at_physical_inventory_items
    BEFORE UPDATE ON public.physical_inventory_items
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- RLS
ALTER TABLE public.physical_inventories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.physical_inventory_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated full access to physical_inventories" 
ON public.physical_inventories FOR ALL TO authenticated USING (true);

CREATE POLICY "Allow authenticated full access to physical_inventory_items" 
ON public.physical_inventory_items FOR ALL TO authenticated USING (true);
