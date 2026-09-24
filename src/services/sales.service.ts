import { supabase, isSupabaseConfigured } from '../lib/supabase/client';
import { CartItem, SaleMovement } from '../types';

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

export const SalesService = {
  async completeSale(params: {
    storeId: string;
    cartItems: CartItem[];
    buyerName: string;
    cpf: string;
    paymentMethod: string;
    installments: number;
    discountValue: number;
    discountPercent: number;
    idempotencyKey: string;
  }): Promise<{ success: boolean; message: string; totalFinal: number; saleNumber?: string; saleId?: string }> {
    if (!isSupabaseConfigured) {
      return { success: false, message: 'Supabase não configurado. Modo local ativo.', totalFinal: 0 };
    }

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
        return { success: false, message: 'Há item sem identificador de variação válido.', totalFinal: 0 };
      }

      const { data, error } = await supabase.rpc('complete_sale', {
        p_store_id: params.storeId,
        p_customer_name: params.buyerName.trim() || 'Cliente não identificado',
        p_customer_cpf: params.cpf.trim() || 'Não informado',
        p_items: rpcItems,
        p_payment_method: params.paymentMethod,
        p_installments: params.installments || 1,
        p_discount_value: params.discountValue || 0,
        p_discount_percent: params.discountPercent || 0,
        p_idempotency_key: params.idempotencyKey
      });

      if (error) {
        console.error('Erro na RPC complete_sale:', error);
        return { success: false, message: error.message || 'Falha ao processar venda no banco de dados.', totalFinal: 0 };
      }

      const result = data as CompleteSaleRpcResult;
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

  async getMovements(storeId?: string): Promise<SaleMovement[]> {
    if (!isSupabaseConfigured) return [];

    let query = supabase
      .from('sales')
      .select(`
        id,
        sale_number,
        customer_name,
        customer_cpf,
        total,
        created_at,
        payments ( method, installments ),
        sale_items ( product_name, variant_description, quantity )
      `)
      .eq('status', 'COMPLETED')
      .order('created_at', { ascending: false });

    if (storeId) {
      query = query.eq('store_id', storeId);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Erro ao buscar histórico de vendas:', error);
      return [];
    }

    return ((data || []) as unknown as SaleListRow[]).map((s, index) => {
      const payment = s.payments?.[0];
      const paymentStr = payment
        ? `${payment.method}${payment.installments > 1 ? ` ${payment.installments}x` : ''}`
        : 'PIX';

      const itemsStr = (s.sale_items || [])
        .map(i => `${i.product_name} (${i.variant_description}) x${i.quantity}`)
        .join(', ');

      return {
        id: index + 1,
        uuid: s.id,
        tipo: 'INCOME',
        valor: Number(s.total) || 0,
        formaPagamento: paymentStr,
        comprador: s.customer_name || 'Consumidor Final',
        cpf: s.customer_cpf || 'Não informado',
        produtos: itemsStr || 'Venda PDV',
        data: (s.created_at || '').slice(0, 10),
        vendaId: s.sale_number
      };
    });
  }
};
