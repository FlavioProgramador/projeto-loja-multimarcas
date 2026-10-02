import { supabase, isSupabaseConfigured } from '../lib/supabase/client';
import { CartItem, SaleMovement } from '../types';
import { generateIdempotencyKey } from '../lib/idempotency';

interface CompleteSaleRpcResult {
  success?: boolean;
  message?: string;
  total?: number;
  sale_number?: string;
  sale_id?: string;
}

interface SaleListRow {
  id: string;
  sale_number: string;
  customer_name: string | null;
  customer_cpf: string | null;
  total: number | string;
  created_at: string;
  payments?: Array<{ method: string; installments: number }>;
  sale_items?: Array<{ product_name: string; variant_description: string; quantity: number }>;
}

const pendingCheckoutKeys = new Map<string, string>();

function getCheckoutSignature(params: {
  storeId: string;
  cartItems: CartItem[];
  buyerName: string;
  cpf: string;
  customerId?: string;
  paymentMethod: string;
  installments: number;
  discountValue: number;
  discountPercent: number;
}): string {
  return JSON.stringify({
    storeId: params.storeId,
    buyerName: params.buyerName.trim(),
    cpf: params.cpf.trim(),
    customerId: params.customerId || null,
    paymentMethod: params.paymentMethod,
    installments: params.installments || 1,
    discountValue: params.discountValue || 0,
    discountPercent: params.discountPercent || 0,
    cartItems: params.cartItems.map(item => ({
      variantId: item.variantId,
      qtd: item.qtd,
      preco: item.preco
    }))
  });
}

function mapSales(rows: SaleListRow[]): SaleMovement[] {
  return rows.map((sale, index) => {
    const payment = sale.payments?.[0];
    const paymentStr = payment
      ? `${payment.method}${payment.installments > 1 ? ` ${payment.installments}x` : ''}`
      : 'PIX';
    const itemsStr = (sale.sale_items || [])
      .map(item => `${item.product_name} (${item.variant_description}) x${item.quantity}`)
      .join(', ');

    return {
      id: index + 1,
      uuid: sale.id,
      tipo: 'INCOME',
      valor: Number(sale.total) || 0,
      formaPagamento: paymentStr,
      comprador: sale.customer_name || 'Consumidor Final',
      cpf: sale.customer_cpf || 'Não informado',
      produtos: itemsStr || 'Venda PDV',
      data: (sale.created_at || '').slice(0, 10),
      vendaId: sale.sale_number
    };
  });
}

const SALE_SELECT = `
  id,
  sale_number,
  customer_name,
  customer_cpf,
  total,
  created_at,
  payments ( method, installments ),
  sale_items ( product_name, variant_description, quantity )
`;

export const SalesService = {
  async completeSale(params: {
    storeId: string;
    cartItems: CartItem[];
    buyerName: string;
    cpf: string;
    customerId?: string;
    paymentMethod: string;
    installments: number;
    discountValue: number;
    discountPercent: number;
    idempotencyKey: string;
  }): Promise<{ success: boolean; message: string; totalFinal: number; saleNumber?: string; saleId?: string }> {
    if (!isSupabaseConfigured) {
      return { success: false, message: 'Supabase não configurado. Modo local ativo.', totalFinal: 0 };
    }

    const signature = getCheckoutSignature(params);
    const effectiveIdempotencyKey = pendingCheckoutKeys.get(signature) || params.idempotencyKey || generateIdempotencyKey();
    pendingCheckoutKeys.set(signature, effectiveIdempotencyKey);

    try {
      const rpcItems = params.cartItems.map(item => ({
        variant_id: item.variantId || '',
        product_id: item.productUuid || null,
        product_name: item.nome,
        variant_description: `${item.tamanho} / ${item.cor}`,
        quantity: item.qtd,
        unit_price: item.preco
      }));

      if (rpcItems.some(item => !item.variant_id)) {
        pendingCheckoutKeys.delete(signature);
        return { success: false, message: 'Há item sem identificador de variação válido.', totalFinal: 0 };
      }

      const { data, error } = await supabase.rpc('complete_sale', {
        p_store_id: params.storeId,
        p_customer_id: params.customerId || null,
        p_customer_name: params.buyerName.trim() || 'Cliente não identificado',
        p_customer_cpf: params.cpf.trim() || 'Não informado',
        p_items: rpcItems,
        p_payment_method: params.paymentMethod,
        p_installments: params.installments || 1,
        p_discount_value: params.discountValue || 0,
        p_discount_percent: params.discountPercent || 0,
        p_idempotency_key: effectiveIdempotencyKey
      });

      if (error) {
        console.error('Erro na RPC complete_sale:', error);
        return { success: false, message: error.message || 'Falha ao processar venda no banco de dados.', totalFinal: 0 };
      }

      const result = data as CompleteSaleRpcResult;
      if (result.success !== false) pendingCheckoutKeys.delete(signature);
      return {
        success: result.success !== false,
        message: result.message || 'Venda realizada com sucesso!',
        totalFinal: Number(result.total) || 0,
        saleNumber: result.sale_number,
        saleId: result.sale_id
      };
    } catch (err: unknown) {
      console.error('Exceção ao finalizar venda:', err);
      return {
        success: false,
        message: err instanceof Error ? err.message : 'Erro inesperado ao finalizar venda.',
        totalFinal: 0
      };
    }
  },

  async getMovements(
    storeId?: string,
    period?: { startDate?: string; endDate?: string }
  ): Promise<SaleMovement[]> {
    if (!isSupabaseConfigured) return [];

    let query = supabase
      .from('sales')
      .select(SALE_SELECT)
      .eq('status', 'COMPLETED')
      .order('created_at', { ascending: false });

    if (storeId) query = query.eq('store_id', storeId);
    if (period?.startDate) query = query.gte('created_at', period.startDate + 'T00:00:00.000Z');
    if (period?.endDate) query = query.lte('created_at', period.endDate + 'T23:59:59.999Z');

    const { data, error } = await query;
    if (error) {
      console.error('Erro ao buscar histórico de vendas:', error);
      throw error;
    }

    return mapSales((data || []) as unknown as SaleListRow[]);
  },

  async searchMovements(storeId: string, search = '', limit = 20): Promise<SaleMovement[]> {
    if (!isSupabaseConfigured || !storeId) return [];

    let query = supabase
      .from('sales')
      .select(SALE_SELECT)
      .eq('store_id', storeId)
      .eq('status', 'COMPLETED')
      .order('created_at', { ascending: false })
      .limit(Math.min(50, Math.max(1, limit)));

    const normalizedSearch = search.trim().replace(/[(),]/g, ' ');
    if (normalizedSearch) {
      const pattern = `%${normalizedSearch}%`;
      query = query.or(
        `sale_number.ilike.${pattern},customer_name.ilike.${pattern},customer_cpf.ilike.${pattern}`
      );
    }

    const { data, error } = await query;
    if (error) {
      console.error('Erro ao buscar vendas para devolução:', error);
      throw error;
    }

    return mapSales((data || []) as unknown as SaleListRow[]);
  }
};
