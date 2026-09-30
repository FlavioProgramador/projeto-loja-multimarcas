import { useCallback } from 'react';
import { ProductsService, InventoryService } from '../../services';
import { Product } from '../../types';

type RefreshData = () => Promise<void>;

type Params = {
  products: Product[];
  setProducts: import('react').Dispatch<import('react').SetStateAction<Product[]>>;
  activeStoreId: string | null;
  refreshData: RefreshData;
  isSupabaseConfigured: boolean;
};

export function useProductsDomain({
  products,
  setProducts,
  activeStoreId,
  refreshData,
  isSupabaseConfigured,
}: Params) {
  const addProduct = useCallback(async (prodData: Omit<Product, 'id'>) => {
    const newId = products.reduce((max, p) => Math.max(max, p.id), 0) + 1;
    const newProd: Product = { id: newId, ...prodData };
    setProducts(prev => [...prev, newProd]);

    if (!isSupabaseConfigured) return;
    if (!activeStoreId) {
      setProducts(prev => prev.filter(product => product.id !== newId));
      throw new Error('Nenhuma loja ativa selecionada.');
    }

    try {
      const created = await ProductsService.create(prodData);
      if (!created?.id) throw new Error('O produto não retornou um identificador válido.');
      for (const sku of prodData.skus) {
        const quantity = Math.max(0, Number(sku.qtd) || 0);
        if (!quantity) continue;
        const variant = await ProductsService.getVariantByAttributes(
          created.id, sku.tamanho.trim() || 'Único', sku.cor.trim() || 'Padrão', sku.sku
        );
        if (!variant) throw new Error('Não foi possível localizar a variação recém-criada.');
        await InventoryService.registerStockEntry({
          storeId: activeStoreId,
          productName: prodData.nome,
          brand: prodData.marca,
          category: prodData.categoria,
          price: prodData.preco,
          skuIndex: -1,
          qtd: quantity,
          custoUnitario: prodData.custo ?? 0,          newSize: sku.tamanho,
          newColor: sku.cor,
          variantId: variant.id,
        });
      }
      await refreshData();
    } catch (error) {
      setProducts(prev => prev.filter(product => product.id !== newId));
      throw error;
    }
  }, [activeStoreId, isSupabaseConfigured, products, refreshData, setProducts]);

  const updateProduct = useCallback(async (id: number, updated: Partial<Product>) => {
    const target = products.find(p => p.id === id);
    if (!target) return;
    const snapshot = products;
    setProducts(prev => prev.map(p => p.id === id ? { ...p, ...updated } : p));
    if (!isSupabaseConfigured || !target.uuid) return;
    try {
      await ProductsService.update(target.uuid, updated);
      await refreshData();
    } catch (error) {
      setProducts(snapshot);
      throw error;
    }
  }, [isSupabaseConfigured, products, refreshData, setProducts]);

  const deleteProduct = useCallback(async (id: number) => {
    const target = products.find(p => p.id === id);
    if (!target) return;
    const snapshot = products;
    setProducts(prev => prev.filter(p => p.id !== id));
    if (!isSupabaseConfigured || !target.uuid) return;
    try {
      await ProductsService.remove(target.uuid);
      await refreshData();
    } catch (error) {
      setProducts(snapshot);
      throw error;
    }
  }, [isSupabaseConfigured, products, refreshData, setProducts]);

  return { addProduct, updateProduct, deleteProduct };
}
