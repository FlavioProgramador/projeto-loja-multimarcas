import React, { useCallback } from 'react';
import { InventoryService } from '../../services';
import { hoje } from '../../lib/utils';
import type { Product, FinancialTransaction } from '../../types';

interface RegisterStockEntryParams {
  productName: string;
  brand?: string;
  category?: string;
  price?: number;
  skuIndex: number;
  qtd: number;
  custoUnitario: number;
  newSize?: string;
  newColor?: string;
}

interface UseInventoryDomainParams {
  products: Product[];
  transactions: FinancialTransaction[];
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  setTransactions: React.Dispatch<React.SetStateAction<FinancialTransaction[]>>;
  activeStoreId: string | null;
  refreshData: () => Promise<void>;
  isSupabaseConfigured: boolean;
}

export const useInventoryDomain = ({
  products,
  transactions,
  setProducts,
  setTransactions,
  activeStoreId,
  refreshData,
  isSupabaseConfigured,
}: UseInventoryDomainParams) => {
  const registerStockEntry = useCallback(async (params: RegisterStockEntryParams) => {
    if (isSupabaseConfigured) {
      if (!activeStoreId) throw new Error('Nenhuma loja ativa selecionada.');
      await InventoryService.registerStockEntry({ ...params, storeId: activeStoreId });
      await refreshData();
      return;
    }

    const existing = products.find(product =>
      product.nome.toLowerCase() === params.productName.toLowerCase()
    );

    if (existing) {
      setProducts(prev => prev.map(product => {
        if (product.id !== existing.id) return product;
        const skus = [...product.skus];
        if (params.skuIndex >= 0 && params.skuIndex < skus.length) {
          skus[params.skuIndex] = { ...skus[params.skuIndex], qtd: skus[params.skuIndex].qtd + params.qtd };
        } else {
          skus.push({ tamanho: params.newSize || 'Único', cor: params.newColor || 'Padrão', qtd: params.qtd });
        }
        return { ...product, skus };
      }));
    } else {
      const newId = products.reduce((max, product) => Math.max(max, product.id), 0) + 1;
      setProducts(prev => [...prev, {
        id: newId,
        nome: params.productName,
        marca: params.brand || 'Genérica',
        categoria: params.category || 'Geral',
        preco: params.price || 0,
        skus: [{ tamanho: params.newSize || 'Único', cor: params.newColor || 'Padrão', qtd: params.qtd }],
      }]);
    }

    const newTransactionId = transactions.reduce((max, transaction) => Math.max(max, transaction.id), 0) + 1;
    setTransactions(prev => [...prev, {
      id: newTransactionId,
      tipo: 'EXPENSE',
      descricao: `Entrada ${params.productName}`,
      valor: params.custoUnitario * params.qtd,
      data: hoje(),
    }]);
  }, [activeStoreId, isSupabaseConfigured, products, refreshData, setProducts, setTransactions, transactions]);

  return { registerStockEntry };
};
