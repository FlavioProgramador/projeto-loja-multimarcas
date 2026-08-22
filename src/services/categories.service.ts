import { supabase, isSupabaseConfigured } from '../lib/supabase/client';
import { CategoryRow } from '../types/database';

export const CategoriesService = {
  async getAll(): Promise<CategoryRow[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      console.error('Erro ao buscar categorias:', error);
      return [];
    }
    return (data || []) as CategoryRow[];
  },

  async getById(id: string): Promise<CategoryRow | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Erro ao buscar categoria por ID:', error);
      return null;
    }
    return data as CategoryRow;
  },

  async create(category: { name: string; description?: string }): Promise<CategoryRow | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase
      .from('categories')
      .insert({
        name: category.name,
        description: category.description || null
      })
      .select()
      .single();

    if (error) throw error;
    return data as CategoryRow;
  },

  async update(id: string, category: Partial<CategoryRow>): Promise<CategoryRow | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase
      .from('categories')
      .update(category)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data as CategoryRow;
  },

  async remove(id: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase
      .from('categories')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }
};
