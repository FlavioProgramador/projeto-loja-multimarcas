import React, { useCallback } from 'react';
import { ReturnsService } from '../../services/returns.service';
import { ReturnItem, ReturnRecord } from '../../types';
export function useReturnsDomain(activeStoreId: string | null, refreshData: () => Promise<void>) {
  const processReturn = useCallback(async (params: { clienteNome:string; clienteCpf:string; vendaOriginalId?:string; itens:ReturnItem[]; tipoResolucao:'credito_cliente'|'vale_troca'|'estorno_dinheiro'; observacoes?:string; }): Promise<{success:boolean;message:string;returnRecord:ReturnRecord}> => {
    if (!activeStoreId) return { success:false, message:'Nenhuma loja ativa selecionada.', returnRecord:{} as ReturnRecord };
    if (!params.vendaOriginalId || !/^[0-9a-f-]{36}$/i.test(params.vendaOriginalId)) return { success:false, message:'UUID da venda original é obrigatório.', returnRecord:{} as ReturnRecord };
    const result = await ReturnsService.processReturn({ storeId: activeStoreId, originalSaleId: params.vendaOriginalId, customerName: params.clienteNome, customerCpf: params.clienteCpf, items: params.itens, resolutionType: params.tipoResolucao, observations: params.observacoes });
    if (!result.success) return result;
    await refreshData();
    return result;
  }, [activeStoreId, refreshData]);
  return { processReturn };
}

