import { supabase, isSupabaseConfigured } from '../lib/supabase/client';
import { ProductRow } from '../types/database';
import { Product, ProductSku } from '../types';

interface StoreInventoryRow {
  store_id: string;
  quantity: number;
}

interface ProductVariantListRow {
  id: string;
  sku: string;
  barcode: string | null;
  size: string;
  color: string;
  is_active: boolean;
  store_inventory?: StoreInventoryRow[];
}

interface ProductListRow {
  id: string;
  name: string;
  sale_price: number | string;
  brands: { id: string; name: string } | null;
  categories: { id: string; name: string } | null;
  product_variants: ProductVariantListRow[];
}

export const ProductsService = {
  async getAll(storeId?: string): Promise<Product[]> {
    if (!isSupabaseConfigured || !storeId) return [];

    const { data, error } = await supabase
      .from('products')
      .select(`
        id,
        name,
        sale_price,
        brands ( id, name ),
        categories ( id, name ),
        product_variants (
          id,
          sku,
          barcode,
          size,
          color,
          is_active,
          store_inventory ( store_id, quantity )
        )
      `)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      console.error('Erro ao buscar produtos:', error);
      return [];
    }

    return ((data || []) as unknown as ProductListRow[])
      .filter(product => product.product_variants?.some(variant =>
        variant.is_active && variant.store_inventory?.some(inventory => inventory.store_id === storeId)
      ))
      .map((product, index) => {
        const variants = (product.product_variants || []).filter(variant => variant.is_active);
        const skus: ProductSku[] = variants.map(variant => ({
          id: variant.id,
          sku: variant.sku,
          tamanho: variant.size,
          cor: variant.color,
          qtd: Number(variant.store_inventory?.find(inventory => inventory.store_id === storeId)?.quantity ?? 0)
        }));

        return {
          id: index + 1,
          uuid: product.id,
          nome: product.name,
          marca: product.brands?.name || 'Genérica',
          categoria: product.categories?.name || 'Geral',
          preco: Number(product.sale_price) || 0,
          skus: skus.length > 0 ? skus : [{ tamanho: 'Único', cor: 'Padrão', qtd: 0 }]
        };
      });
  },

  async getById(id: string): Promise<ProductRow | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase
      .from('products')
      .select(`*, brands (*), categories (*), product_variants (*)`)
      .eq('id', id)
      .single();
    if (error) {
      console.error('Erro ao buscar produto por ID:', error);
      return null;
    }
    return data as ProductRow;
  },

  async create(productData: {
    nome: string;
    marca: string;
    categoria: string;
    preco: number;
    custo?: number;
    skus: { tamanho: string; cor: string; qtd: number; sku?: string }[];
  }): Promise<{ id: string } | null> {
    if (!isSupabaseConfigured) return null;

    const { data, error } = await supabase.rpc('manage_product', {
      p_product_id: null,
      p_name: productData.nome,
      p_brand_name: productData.marca,
      p_category_name: productData.categoria,
      p_sale_price: productData.preco,
      p_cost_price: productData.custo || 0,
      p_variants: (productData.skus || []).map(sku => ({
        size: sku.tamanho,
        color: sku.cor,
        stock_quantity: Math.max(0, Number(sku.qtd) || 0),
        sku: sku.sku || null
      }))
    });

    if (error) {
      console.error('Erro na RPC manage_product (create):', error);
      throw error;
    }
    const result = data as { product_id?: string };
    return result.product_id ? { id: result.product_id } : null;
  },

  async update(uuid: string, updates: Partial<{
    nome: string;
    marca: string;
    categoria: string;
    preco: number;
    skus: { id?: string; sku?: string; tamanho: string; cor: string }[];
  }>): Promise<void> {
    if (!isSupabaseConfigured || !uuid) return;

    const { error } = await supabase.rpc('manage_product', {
      p_product_id: uuid,
      p_name: updates.nome ?? null,
      p_brand_name: updates.marca ?? null,
      p_category_name: updates.categoria ?? null,
      p_sale_price: updates.preco ?? null,
      p_cost_price: null,
      p_variants: (updates.skus || []).map(sku => ({
        id: sku.id || null,
        size: sku.tamanho,
        color: sku.cor,
        sku: sku.sku || null
      }))
    });

    if (error) {
      console.error('Erro na RPC manage_product (update):', error);
      throw error;
    }
  },

  async remove(uuid: string): Promise<void> {
    if (!isSupabaseConfigured || !uuid) return;
    const { error } = await supabase.from('products').update({ is_active: false }).eq('id', uuid);
    if (error) throw error;
  }
};
