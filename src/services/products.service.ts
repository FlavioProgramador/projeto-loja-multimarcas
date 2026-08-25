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
        product_variants ( id, sku, barcode, size, color, stock_quantity )
      `)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      console.error('Erro ao buscar produtos:', error);
      return [];
    }

    // Mapear para a interface de domínio do frontend
    return (data || []).map((p: any, index: number) => {
      const skus: ProductSku[] = (p.product_variants || []).map((v: any) => ({
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

    // 1. Obter ou criar Brand
    let brandId: string | null = null;
    if (productData.marca) {
      const { data: brand } = await supabase
        .from('brands')
        .select('id')
        .ilike('name', productData.marca.trim())
        .maybeSingle();

      if (brand) {
        brandId = brand.id;
      } else {
        const { data: newBrand } = await supabase
          .from('brands')
          .insert({ name: productData.marca.trim() })
          .select('id')
          .single();
        if (newBrand) brandId = newBrand.id;
      }
    }

    // 2. Obter ou criar Categoria
    let categoryId: string | null = null;
    if (productData.categoria) {
      const { data: cat } = await supabase
        .from('categories')
        .select('id')
        .ilike('name', productData.categoria.trim())
        .maybeSingle();

      if (cat) {
        categoryId = cat.id;
      } else {
        const { data: newCat } = await supabase
          .from('categories')
          .insert({ name: productData.categoria.trim() })
          .select('id')
          .single();
        if (newCat) categoryId = newCat.id;
      }
    }

    // 3. Inserir Produto
    const { data: product, error: prodError } = await supabase
      .from('products')
      .insert({
        name: productData.nome.trim(),
        brand_id: brandId,
        category_id: categoryId,
        sale_price: productData.preco,
        cost_price: productData.custo || 0
      })
      .select()
      .single();

    if (prodError) throw prodError;

    // 4. Inserir Variantes (SKUs)
    if (productData.skus && productData.skus.length > 0) {
      const variantsToInsert = productData.skus.map((s, idx) => {
        const generatedSku =
          s.sku ||
          `${productData.nome.substring(0, 3).toUpperCase()}-${s.tamanho.toUpperCase()}-${s.cor.substring(0, 3).toUpperCase()}-${Date.now().toString().slice(-4)}${idx}`;

        return {
          product_id: product.id,
          sku: generatedSku,
          size: s.tamanho || 'Único',
          color: s.cor || 'Padrão',
          stock_quantity: Math.max(0, Number(s.qtd) || 0)
        };
      });

      const { error: varError } = await supabase
        .from('product_variants')
        .insert(variantsToInsert);

      if (varError) {
        console.error('Erro ao inserir variantes do produto:', varError);
      }
    }

    return product;
  },

  async update(uuid: string, updates: Partial<{
    nome: string;
    marca: string;
    categoria: string;
    preco: number;
    skus: { id?: string; sku?: string; tamanho: string; cor: string; qtd: number }[];
  }>): Promise<void> {
    if (!isSupabaseConfigured || !uuid) return;

    const fieldsToUpdate: any = {};
    if (updates.nome !== undefined) fieldsToUpdate.name = updates.nome;
    if (updates.preco !== undefined) fieldsToUpdate.sale_price = updates.preco;

    if (Object.keys(fieldsToUpdate).length > 0) {
      await supabase.from('products').update(fieldsToUpdate).eq('id', uuid);
    }

    // Se foram enviadas variações, atualizar as existentes e inserir as novas usando UPSERT
    if (updates.skus && updates.skus.length > 0) {
      const variantsToUpsert = updates.skus.map((s, idx) => {
        const payload: any = {
          product_id: uuid,
          size: s.tamanho || 'Único',
          color: s.cor || 'Padrão',
          stock_quantity: Math.max(0, Number(s.qtd) || 0)
        };
        
        if (s.id) {
          payload.id = s.id;
        }
        
        if (s.sku) {
          payload.sku = s.sku;
        } else if (!s.id) {
          payload.sku = `${(updates.nome || 'PROD').substring(0, 3).toUpperCase()}-${s.tamanho.toUpperCase()}-${s.cor.substring(0, 3).toUpperCase()}-${Date.now().toString().slice(-4)}${idx}`;
        }
        
        return payload;
      });

      const { error } = await supabase.from('product_variants').upsert(variantsToUpsert, {
        onConflict: 'id'
      });
      
      if (error) {
        console.error('Erro ao fazer upsert em product_variants:', error);
      }
    }
  },

  async remove(uuid: string): Promise<void> {
    if (!isSupabaseConfigured || !uuid) return;
    const { error } = await supabase.from('products').update({ is_active: false }).eq('id', uuid);
    if (error) throw error;
  }
};
