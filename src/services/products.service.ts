import { supabase, isSupabaseConfigured } from '../lib/supabase/client';
import { ProductRow, ProductVariantRow } from '../types/database';
import { Product, ProductSku } from '../types';

export const ProductsService = {
  async getAll(): Promise<Product[]> {
    if (!isSupabaseConfigured) return [];
    
    const { data, error } = await supabase
      .from('products')
      .select(`
        id,
        name,
        description,
        cost_price,
        sale_price,
        minimum_stock,
        is_active,
        image_url,
        brands ( id, name ),
        categories ( id, name ),
        product_variants ( id, sku, barcode, size, color, stock_quantity, is_active )
      `)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      console.error('Erro ao buscar produtos:', error);
      return [];
    }

    // Mapear para a interface de domínio do frontend
    return (data || []).map((p: any, index: number) => {
      const activeVariants = (p.product_variants || []).filter((v: any) => v.is_active !== false);
      const skus: ProductSku[] = activeVariants.map((v: any) => ({
        id: v.id,
        sku: v.sku,
        tamanho: v.size,
        cor: v.color,
        qtd: v.stock_quantity
      }));

      return {
        id: index + 1, // id numérico para compatibilidade com os componentes
        uuid: p.id,    // uuid real do banco de dados
        nome: p.name,
        marca: p.brands?.name || 'Genérica',
        categoria: p.categories?.name || 'Geral',
        preco: Number(p.sale_price) || 0,
        skus: skus.length > 0 ? skus : [{ tamanho: 'Único', cor: 'Padrão', qtd: 0 }]
      };
    });
  },

  async getById(id: string): Promise<ProductRow | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase
      .from('products')
      .select(`
        *,
        brands (*),
        categories (*),
        product_variants (*)
      `)
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
  }): Promise<any> {
    if (!isSupabaseConfigured) return null;

    const rpcPayload = {
      p_product_id: null,
      p_name: productData.nome,
      p_brand_name: productData.marca,
      p_category_name: productData.categoria,
      p_sale_price: productData.preco,
      p_cost_price: productData.custo || 0,
      p_variants: (productData.skus || []).map(s => ({
        size: s.tamanho,
        color: s.cor,
        stock_quantity: Math.max(0, Number(s.qtd) || 0),
        sku: s.sku || null
      }))
    };

    const { data, error } = await supabase.rpc('manage_product', rpcPayload);
    
    if (error) {
      console.error('Erro na RPC manage_product (create):', error);
      throw error;
    }

    return { id: data.product_id };
  },

  async update(uuid: string, updates: Partial<{
    nome: string;
    marca: string;
    categoria: string;
    preco: number;
    skus: { id?: string; sku?: string; tamanho: string; cor: string; qtd: number }[];
  }>): Promise<void> {
    if (!isSupabaseConfigured || !uuid) return;

    const rpcPayload = {
      p_product_id: uuid,
      p_name: updates.nome || null,
      p_brand_name: updates.marca || null,
      p_category_name: updates.categoria || null,
      p_sale_price: updates.preco || null,
      p_cost_price: null, // não alteramos custo na UI de edição rápida
      p_variants: (updates.skus || []).map(s => ({
        id: s.id || null,
        size: s.tamanho,
        color: s.cor,
        stock_quantity: Math.max(0, Number(s.qtd) || 0),
        sku: s.sku || null
      }))
    };

    const { error } = await supabase.rpc('manage_product', rpcPayload);
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
