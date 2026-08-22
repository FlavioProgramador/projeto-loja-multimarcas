import { supabase, isSupabaseConfigured } from '../lib/supabase/client';
import { InventoryMovementRow } from '../types/database';

export const InventoryService = {
  async getMovements(): Promise<InventoryMovementRow[]> {
    if (!isSupabaseConfigured) return [];
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
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erro ao buscar movimentações de estoque:', error);
      return [];
    }
    return (data || []) as InventoryMovementRow[];
  },

  async registerStockEntry(params: {
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
      // 1. Procurar se o produto já existe
      const { data: existingProduct } = await supabase
        .from('products')
        .select(`
          id,
          name,
          product_variants ( id, size, color, stock_quantity )
        `)
        .ilike('name', params.productName.trim())
        .maybeSingle();

      let targetVariantId: string;
      let currentStock = 0;

      if (existingProduct) {
        const variants = (existingProduct as any).product_variants || [];
        
        if (params.skuIndex >= 0 && params.skuIndex < variants.length) {
          const matchedVariant = variants[params.skuIndex];
          targetVariantId = matchedVariant.id;
          currentStock = matchedVariant.stock_quantity;
        } else {
          // Criar nova variante no produto existente
          const newSize = params.newSize || 'Único';
          const newColor = params.newColor || 'Padrão';
          const generatedSku = `${params.productName.substring(0, 3).toUpperCase()}-${newSize.toUpperCase()}-${newColor.substring(0, 3).toUpperCase()}-${Date.now().toString().slice(-4)}`;

          const { data: newVariant, error: varError } = await supabase
            .from('product_variants')
            .insert({
              product_id: existingProduct.id,
              sku: generatedSku,
              size: newSize,
              color: newColor,
              stock_quantity: 0
            })
            .select()
            .single();

          if (varError) throw varError;
          targetVariantId = newVariant.id;
          currentStock = 0;
        }
      } else {
        // Criar novo produto com Brand e Categoria
        let brandId = null;
        if (params.brand) {
          const { data: b } = await supabase
            .from('brands')
            .select('id')
            .ilike('name', params.brand.trim())
            .maybeSingle();
          if (b) brandId = b.id;
          else {
            const { data: nb } = await supabase.from('brands').insert({ name: params.brand.trim() }).select().single();
            if (nb) brandId = nb.id;
          }
        }

        let categoryId = null;
        if (params.category) {
          const { data: c } = await supabase
            .from('categories')
            .select('id')
            .ilike('name', params.category.trim())
            .maybeSingle();
          if (c) categoryId = c.id;
          else {
            const { data: nc } = await supabase.from('categories').insert({ name: params.category.trim() }).select().single();
            if (nc) categoryId = nc.id;
          }
        }

        const { data: newProd, error: prodErr } = await supabase
          .from('products')
          .insert({
            name: params.productName.trim(),
            brand_id: brandId,
            category_id: categoryId,
            sale_price: params.price || 0,
            cost_price: params.custoUnitario || 0
          })
          .select()
          .single();

        if (prodErr) throw prodErr;

        const newSize = params.newSize || 'Único';
        const newColor = params.newColor || 'Padrão';
        const generatedSku = `${params.productName.substring(0, 3).toUpperCase()}-${newSize.toUpperCase()}-${newColor.substring(0, 3).toUpperCase()}-${Date.now().toString().slice(-4)}`;

        const { data: newVariant, error: varErr } = await supabase
          .from('product_variants')
          .insert({
            product_id: newProd.id,
            sku: generatedSku,
            size: newSize,
            color: newColor,
            stock_quantity: 0
          })
          .select()
          .single();

        if (varErr) throw varErr;
        targetVariantId = newVariant.id;
        currentStock = 0;
      }

      // 2. Incrementar estoque de forma ATÔMICA via RPC (evita race condition)
      const { error: updateErr } = await supabase.rpc('increment_variant_stock', {
        p_variant_id: targetVariantId,
        p_amount: params.qtd
      });

      if (updateErr) throw updateErr;

      const newStock = currentStock + params.qtd;

      // 3. Registrar movimentação de estoque (ENTRY)
      await supabase.from('inventory_movements').insert({
        product_variant_id: targetVariantId,
        type: 'ENTRY',
        quantity: params.qtd,
        quantity_before: currentStock,
        quantity_after: newStock,
        notes: `Entrada de estoque: ${params.productName}`
      });

      // 4. Registrar transação financeira de despesa (EXPENSE / saida)
      const totalExpense = params.custoUnitario * params.qtd;
      if (totalExpense > 0) {
        await supabase.from('financial_transactions').insert({
          type: 'EXPENSE',
          category: 'Estoque / Compras',
          description: `Entrada de estoque: ${params.productName} (${params.qtd} un)`,
          amount: totalExpense,
          status: 'PAID',
          paid_at: new Date().toISOString()
        });
      }

      return true;
    } catch (err) {
      console.error('Erro ao registrar entrada de estoque:', err);
      return false;
    }
  }
};
