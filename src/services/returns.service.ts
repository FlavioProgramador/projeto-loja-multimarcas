import { supabase, isSupabaseConfigured } from '../lib/supabase/client';
import { ReturnItem, ReturnRecord } from '../types';

interface ReturnRpcResult {
  success?: boolean;
  message?: string;
  return_id?: string;
  return_number?: string;
  total?: number | string;
}

export const ReturnsService = {
  async getAll(storeId?: string): Promise<ReturnRecord[]> {
    if (!isSupabaseConfigured || !storeId) return [];

    const { data, error } = await supabase
      .from('returns')
      .select(`
        id,
        return_number,
        original_sale_id,
        customer_id,
        customer_name,
        customer_cpf,
        resolution_type,
        status,
        total_amount,
        observations,
        expires_at,
        created_at,
        return_items (
          product_id,
          product_variant_id,
          product_name,
          size,
          color,
          unit_price,
          quantity,
          reason
        )
      `)
      .eq('store_id', storeId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return (data || []).map((row: any, index: number) => ({
      id: index + 1,
      uuid: row.id,
      codigo: row.return_number,
      data: (row.created_at || '').slice(0, 10),
      vendaOriginalId: row.original_sale_id,
      clienteNome: row.customer_name,
      clienteCpf: row.customer_cpf || 'Não informado',
      itens: (row.return_items || []).map((item: any) => ({
        produtoId: 0,
        productUuid: item.product_id || undefined,
        variantId: item.product_variant_id,
        nome: item.product_name,
        tamanho: item.size,
        cor: item.color,
        precoUnitario: Number(item.unit_price) || 0,
        qtd: Number(item.quantity) || 0,
        motivo: item.reason
      })),
      valorTotal: Number(row.total_amount) || 0,
      tipoResolucao: row.resolution_type,
      status: row.status,
      dataValidade: row.expires_at || undefined,
      observacoes: row.observations || undefined
    }));
  },

  async processReturn(params: {
    storeId: string;
    originalSaleId: string;
    customerId?: string;
    customerName?: string;
    customerCpf?: string;
    items: ReturnItem[];
    resolutionType: 'credito_cliente' | 'vale_troca' | 'estorno_dinheiro';
    observations?: string;
  }): Promise<{ success: boolean; message: string; returnRecord: ReturnRecord }> {
    if (!isSupabaseConfigured) {
      return { success: false, message: 'Supabase não configurado.', returnRecord: {} as ReturnRecord };
    }

    const { data, error } = await supabase.rpc('process_return', {
      p_store_id: params.storeId,
      p_original_sale_id: params.originalSaleId,
      p_customer_id: params.customerId || null,
      p_customer_name: params.customerName || null,
      p_customer_cpf: params.customerCpf || null,
      p_items: params.items.map(item => ({
        variant_id: item.variantId || null,
        quantity: item.qtd,
        product_name: item.nome,
        size: item.tamanho,
        color: item.cor,
        reason: item.motivo
      })),
      p_resolution_type: params.resolutionType,
      p_observations: params.observations || null
    });

    if (error) throw error;

    const result = data as ReturnRpcResult;
    if (result.success !== true || !result.return_id) {
      return {
        success: false,
        message: result.message || 'A devolução não foi confirmada pelo servidor.',
        returnRecord: {} as ReturnRecord
      };
    }

    const returnRecord = {
      id: 0,
      uuid: result.return_id,
      codigo: result.return_number || 'DEV',
      data: new Date().toISOString().slice(0, 10),
      vendaOriginalId: params.originalSaleId,
      clienteNome: params.customerName || 'Consumidor Final',
      clienteCpf: params.customerCpf || 'Não informado',
      itens: params.items,
      valorTotal: Number(result.total) || 0,
      tipoResolucao: params.resolutionType,
      status: 'CONCLUIDO' as const,
      observacoes: params.observations
    };

    return {
      success: true,
      message: result.message || 'Devolução processada com sucesso.',
      returnRecord
    };
  }
};
