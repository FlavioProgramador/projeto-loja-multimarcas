import { supabase, isSupabaseConfigured } from '../lib/supabase/client';
import { BrandRow } from '../types/database';

export const BrandsService = {
  async getAll(): Promise<BrandRow[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase
      .from('brands')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      console.error('Erro ao buscar marcas:', error);
      return [];
    }
    return (data || []) as BrandRow[];
  },

  async getById(id: string): Promise<BrandRow | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase
      .from('brands')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Erro ao buscar marca por ID:', error);
      return null;
    }
    return data as BrandRow;
  },

  async create(brand: { name: string; description?: string; logo_url?: string }): Promise<BrandRow | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase
      .from('brands')
      .insert({
        name: brand.name,
        description: brand.description || null,
        logo_url: brand.logo_url || null
      })
      .select()
      .single();

    if (error) throw error;
    return data as BrandRow;
  },

  async update(id: string, brand: Partial<BrandRow>): Promise<BrandRow | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase
      .from('brands')
      .update(brand)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data as BrandRow;
  },

  async remove(id: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase
      .from('brands')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }
};
