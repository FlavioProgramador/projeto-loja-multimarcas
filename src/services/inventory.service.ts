import { supabase, isSupabaseConfigured } from '../lib/supabase/client';
import { InventoryMovementRow } from '../types/database';

interface ExistingVariant {
  id: string;
  size: string;
  color: string;
  is_active: boolean;
  store_inventory?: Array<{ store_id: string; quantity: number }>;
}

interface ExistingProduct {
  id: string;
  product_variants: ExistingVariant[] | null;
}

export const InventoryService = {
  async getMovements(storeId?: string): Promise<InventoryMovementRow[]> {
    if (!isSupabaseConfigured || !storeId) return [];

    const { data, error } = await supabase
      .from('inventory_movements')
      .select(`
        *,
        product_variants (
          id,
          sku,
          size,
          color,
          products ( id, name )
        )
      `)
      .eq('store_id', storeId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erro ao buscar movimentações de estoque:', error);
      return [];
    }
    return (data || []) as InventoryMovementRow[];
  },

  async registerStockEntry(params: {
    storeId: string;
    productName: string;
    brand?: string;
    category?: string;
    price?: number;
    skuIndex: number;
    qtd: number;
    custoUnitario: number;
    newSize?: string;
    newColor?: string;
  }): Promise<boolean> {
    if (!isSupabaseConfigured) return false;

    try {
      const quantidade = Number(params.qtd);
      const custoUnitario = Number(params.custoUnitario);
      if (!Number.isInteger(quantidade) || quantidade <= 0) {
        throw new Error('A quantidade de entrada deve ser um número inteiro maior que zero.');
      }
      if (!Number.isFinite(custoUnitario) || custoUnitario < 0) {
        throw new Error('O custo unitário deve ser um valor válido e não negativo.');
      }

      const { data: existingProduct, error: productLookupError } = await supabase
        .from('products')
        .select(`
          id,
          name,
          product_variants!inner (
            id,
            size,
            color,
            is_active,
            store_inventory!inner ( store_id, quantity )
          )
        `)
        .ilike('name', params.productName.trim())
        .eq('product_variants.is_active', true)
        .eq('product_variants.store_inventory.store_id', params.storeId)
        .maybeSingle();

      if (productLookupError) throw productLookupError;

      let targetVariantId: string;
      if (existingProduct) {
        const variants = ((existingProduct as unknown as ExistingProduct).product_variants || [])
          .filter(variant => variant.is_active && variant.store_inventory?.some(item => item.store_id === params.storeId));

        if (params.skuIndex >= 0 && params.skuIndex < variants.length) {
          targetVariantId = variants[params.skuIndex].id;
        } else {
          const newSize = params.newSize || 'Único';
          const newColor = params.newColor || 'Padrão';
          const generatedSku = `${params.productName.substring(0, 3).toUpperCase()}-${newSize.toUpperCase()}-${newColor.substring(0, 3).toUpperCase()}-${Date.now().toString().slice(-4)}`;
          const { data: newVariant, error: varError } = await supabase
            .from('product_variants')
            .insert({ product_id: existingProduct.id, sku: generatedSku, size: newSize, color: newColor, is_active: true })
            .select()
            .single();
          if (varError) throw varError;
          targetVariantId = newVariant.id;
        }
      } else {
        let brandId: string | null = null;
        if (params.brand) {
          const { data: b } = await supabase.from('brands').select('id').ilike('name', params.brand.trim()).maybeSingle();
          if (b) brandId = b.id;
          else {
            const { data: nb, error: brandError } = await supabase.from('brands').insert({ name: params.brand.trim() }).select().single();
            if (brandError) throw brandError;
            brandId = nb.id;
          }
        }

        let categoryId: string | null = null;
        if (params.category) {
          const { data: c } = await supabase.from('categories').select('id').ilike('name', params.category.trim()).maybeSingle();
          if (c) categoryId = c.id;
          else {
            const { data: nc, error: categoryError } = await supabase.from('categories').insert({ name: params.category.trim() }).select().single();
            if (categoryError) throw categoryError;
            categoryId = nc.id;
          }
        }

        const { data: newProd, error: prodErr } = await supabase
          .from('products')
          .insert({ name: params.productName.trim(), brand_id: brandId, category_id: categoryId, sale_price: Math.max(0, Number(params.price) || 0), cost_price: custoUnitario, is_active: true })
          .select()
          .single();
        if (prodErr) throw prodErr;

        const newSize = params.newSize || 'Único';
        const newColor = params.newColor || 'Padrão';
        const generatedSku = `${params.productName.substring(0, 3).toUpperCase()}-${newSize.toUpperCase()}-${newColor.substring(0, 3).toUpperCase()}-${Date.now().toString().slice(-4)}`;
        const { data: newVariant, error: varErr } = await supabase
          .from('product_variants')
          .insert({ product_id: newProd.id, sku: generatedSku, size: newSize, color: newColor, is_active: true })
          .select()
          .single();
        if (varErr) throw varErr;
        targetVariantId = newVariant.id;
      }

      const { data: rpcResult, error: updateError } = await supabase.rpc('register_stock_entry', {
        p_store_id: params.storeId,
        p_variant_id: targetVariantId,
        p_quantity: quantidade,
        p_unit_cost: custoUnitario,
        p_product_name: params.productName
      });
      if (updateError) throw updateError;
      if (!rpcResult || rpcResult.success !== true) throw new Error('A RPC de entrada de estoque não confirmou a operação.');
      return true;
    } catch (err) {
      console.error('Erro ao registrar entrada de estoque:', err);
      throw err;
    }
  }
};
