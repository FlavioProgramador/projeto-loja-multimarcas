import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { ReturnsService } from '../../services/returns.service';
import { Product, ReturnItem, ReturnRecord } from '../../types';
import { hoje } from '../../lib/utils';
import type { RefreshDomains } from '../useStoreData';

type ReturnParams = {
  clienteNome: string;
  clienteCpf: string;
  vendaOriginalId?: string;
  itens: ReturnItem[];
  tipoResolucao: 'credito_cliente' | 'vale_troca' | 'estorno_dinheiro';
  observacoes?: string;
};

type ReturnsDomainArgs = {
  activeStoreId: string | null;
  isSupabaseConfigured: boolean;
  returns: ReturnRecord[];
  setReturns: Dispatch<SetStateAction<ReturnRecord[]>>;
  setProducts: Dispatch<SetStateAction<Product[]>>;
  refreshDomains: RefreshDomains;
};

export function useReturnsDomain({
  activeStoreId,
  isSupabaseConfigured,
  returns,
  setReturns,
  setProducts,
  refreshDomains,
}: ReturnsDomainArgs) {
  const processReturn = useCallback(async ({
    clienteNome, clienteCpf, vendaOriginalId, itens, tipoResolucao, observacoes,
  }: ReturnParams): Promise<{ success: boolean; message: string; returnRecord: ReturnRecord }> => {
    if (itens.length === 0) {
      return { success: false, message: 'Nenhum item informado.', returnRecord: {} as ReturnRecord };
    }
    const normalizedItems = itens.map(item => ({ ...item, qtd: Number(item.qtd), precoUnitario: Number(item.precoUnitario) }));
    if (normalizedItems.some(item => !Number.isInteger(item.qtd) || item.qtd <= 0)) {
      return { success: false, message: 'Quantidade de devolução inválida.', returnRecord: {} as ReturnRecord };
    }

    if (isSupabaseConfigured) {
      if (!activeStoreId) return { success: false, message: 'Nenhuma loja ativa selecionada.', returnRecord: {} as ReturnRecord };
      if (!vendaOriginalId || !/^[0-9a-f-]{36}$/i.test(vendaOriginalId)) {
        return { success: false, message: 'Em produção, a devolução deve estar vinculada ao UUID da venda original.', returnRecord: {} as ReturnRecord };
      }
      try {
        const result = await ReturnsService.processReturn({
          storeId: activeStoreId, originalSaleId: vendaOriginalId, customerName: clienteNome,
          customerCpf: clienteCpf, items: normalizedItems, resolutionType: tipoResolucao, observations: observacoes,
        });
        if (!result.success) return { success: false, message: result.message, returnRecord: {} as ReturnRecord };
        await refreshDomains('products', 'transactions');
        return { success: true, message: result.message, returnRecord: result.returnRecord };
      } catch (err) {
        return { success: false, message: err instanceof Error ? err.message : 'Erro ao processar devolução.', returnRecord: {} as ReturnRecord };
      }
    }

    const totalReturnAmount = normalizedItems.reduce((sum, item) => sum + item.precoUnitario * item.qtd, 0);
    const returnIdNum = returns.length + 1001;
    const returnCode = `DEV-${returnIdNum}`;
    const currentDate = hoje();
    const newReturnRecord: ReturnRecord = {
      id: returnIdNum, codigo: returnCode, data: currentDate, vendaOriginalId,
      clienteNome: clienteNome.trim() || 'Consumidor Final', clienteCpf: clienteCpf.trim() || 'Não informado',
      itens: normalizedItems, valorTotal: totalReturnAmount, tipoResolucao, status: 'CONCLUIDO',
      dataValidade: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), observacoes,
    };
    setReturns(prev => [newReturnRecord, ...prev]);
    setProducts(prev => prev.map(prod => {
      const items = normalizedItems.filter(i => i.produtoId === prod.id || (prod.uuid && i.productUuid === prod.uuid));
      if (!items.length) return prod;
      return {
        ...prod,
        skus: prod.skus.map(sku => {
          const match = items.find(i =>
            i.tamanho.trim().toLowerCase() === sku.tamanho.trim().toLowerCase() &&
            i.cor.trim().toLowerCase() === sku.cor.trim().toLowerCase()
          );
          return match ? { ...sku, qtd: sku.qtd + match.qtd } : sku;
        }),
      };
    }));
    return {
      success: true,
      message: `Troca/Devolução #${returnCode} processada com sucesso!`,
      returnRecord: newReturnRecord,
    };
  }, [activeStoreId, isSupabaseConfigured, returns, setReturns, setProducts, refreshDomains]);

  return { processReturn };
}
