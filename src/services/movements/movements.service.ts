import { supabase, isSupabaseConfigured } from '../../lib/supabase/client';
import { InventoryMovementRow } from '../../types/database';

export interface MovementRecord extends InventoryMovementRow {
  product_variant?: {
    id: string;
    sku: string;
    size: string;
    color: string;
    products?: { id: string; name: string } | null;
  } | null;
  user?: { id: string; full_name: string; email: string } | null;
  sale?: {
    id: string;
    store_id: string;
    sale_number: string;
    customer_name: string | null;
    customer_cpf: string | null;
    subtotal: number;
    discount: number;
    total: number;
    status: string;
    created_at: string;
    completed_at: string | null;
    sale_items?: Array<{
      product_name: string;
      variant_description: string;
      quantity: number;
      unit_price: number;
      discount: number;
      total: number;
    }>;
    payments?: Array<{
      method: string;
      amount: number;
      status: string;
      installments: number;
      provider: string | null;
    }>;
  } | null;
}

export const MovementsService = {
  async getAll(storeId: string): Promise<MovementRecord[]> {
    if (!isSupabaseConfigured || !storeId) return [];

    const { data, error } = await supabase
      .from('inventory_movements')
      .select(`
        id, product_variant_id, type, quantity, quantity_before, quantity_after,
        reference_type, reference_id, user_id, notes, created_at, store_id, reason,
        product_variant:product_variants (
          id, sku, size, color,
          products ( id, name )
        ),
        user:profiles ( id, full_name, email )
      `)
      .eq('store_id', storeId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erro ao buscar movimentações:', error);
      return [];
    }

    const movements = (data || []) as unknown as MovementRecord[];
    const saleIds = [...new Set(
      movements
        .filter(item => item.reference_type === 'SALE' && item.reference_id)
        .map(item => item.reference_id as string)
    )];

    if (!saleIds.length) return movements;

    const { data: sales, error: salesError } = await supabase
      .from('sales')
      .select(`
        id, store_id, sale_number, customer_name, customer_cpf, subtotal, discount,
        total, status, created_at, completed_at,
        sale_items ( product_name, variant_description, quantity, unit_price, discount, total ),
        payments ( method, amount, status, installments, provider )
      `)
      .eq('store_id', storeId)
      .in('id', saleIds);

    if (salesError) {
      console.error('Erro ao correlacionar vendas:', salesError);
      return movements;
    }

    const saleMap = new Map((sales || []).map(sale => [sale.id, sale]));
    return movements.map(item => ({
      ...item,
      sale: item.reference_id ? (saleMap.get(item.reference_id) as MovementRecord['sale']) || null : null,
    }));
  },
};
