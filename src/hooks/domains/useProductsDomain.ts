import React, { useCallback } from 'react';
import { ProductsService, InventoryService } from '../../services';
import { Product } from '../../types';

type ProductActions = Pick<{ refreshData: () => Promise<void> }, 'refreshData'>;

export function useProductsDomain(products: Product[], setProducts: React.Dispatch<React.SetStateAction<Product[]>>, activeStoreId: string | null, refreshData: ProductActions['refreshData']) {
  const addProduct = useCallback(async (prodData: Omit<Product, 'id'>) => {
    const newId = products.reduce((max, p) => Math.max(max, p.id), 0) + 1;
    const snapshot = products;
    setProducts(prev => [...prev, { id: newId, ...prodData }]);
    if (!activeStoreId) { setProducts(snapshot); throw new Error('Nenhuma loja ativa selecionada.'); }
    try {
      const created = await ProductsService.create(prodData);
      if (!created?.id) throw new Error('O produto não retornou um identificador válido.');
      for (const sku of prodData.skus) {
        const quantity = Math.max(0, Number(sku.qtd) || 0);
        if (!quantity) continue;
        const variant = await ProductsService.getVariantByAttributes(created.id, sku.tamanho.trim() || 'Único', sku.cor.trim() || 'Padrão', sku.sku);
        if (!variant) throw new Error('Não foi possível localizar a variação recém-criada.');
        await InventoryService.registerStockEntry({ storeId: activeStoreId, productName: prodData.nome, brand: prodData.marca, category: prodData.categoria, price: prodData.preco, skuIndex: -1, qtd: quantity, custoUnitario: prodData.custo ?? 0, newSize: sku.tamanho, newColor: sku.cor, variantId: variant.id });
      }
      await refreshData();
    } catch (error) {
      setProducts(snapshot);
      throw error;
    }
  }, [activeStoreId, products, refreshData, setProducts]);

  const updateProduct = useCallback(async (id: number, updated: Partial<Product>) => {
    const target = products.find(p => p.id === id);
    if (!target) return;
    const snapshot = products;
    setProducts(prev => prev.map(p => p.id === id ? { ...p, ...updated } : p));
    if (!target.uuid) return;
    try { await ProductsService.update(target.uuid, updated); await refreshData(); }
    catch (error) { setProducts(snapshot); throw error; }
  }, [products, refreshData, setProducts]);

  const deleteProduct = useCallback(async (id: number) => {
    const target = products.find(p => p.id === id);
    if (!target) return;
    const snapshot = products;
    setProducts(prev => prev.filter(p => p.id !== id));
    if (!target.uuid) return;
    try { await ProductsService.remove(target.uuid); await refreshData(); }
    catch (error) { setProducts(snapshot); throw error; }
  }, [products, refreshData, setProducts]);

  const registerStockEntry = useCallback(async (params: Parameters<typeof InventoryService.registerStockEntry>[0]) => {
    if (!activeStoreId) throw new Error('Nenhuma loja ativa selecionada.');
    await InventoryService.registerStockEntry({ ...params, storeId: activeStoreId });
    await refreshData();
  }, [activeStoreId, refreshData]);

  return { addProduct, updateProduct, deleteProduct, registerStockEntry };
}

