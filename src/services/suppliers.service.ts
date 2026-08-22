import { supabase, isSupabaseConfigured } from '../lib/supabase/client';
import { Supplier } from '../types';

export const SuppliersService = {
  async getAll(): Promise<Supplier[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .order('company_name', { ascending: true });

    if (error) {
      console.error('Erro ao buscar fornecedores:', error);
      return [];
    }

    return (data || []).map((s: any, index: number) => ({
      id: index + 1,
      uuid: s.id,
      nome: s.company_name,
      cnpj: s.document || 'Não informado',
      contato: s.contact_name || '',
      email: s.email || '',
      endereco: s.address || '',
      produtos: []
    }));
  },

  async create(supplier: {
    nome: string;
    cnpj?: string;
    contato?: string;
    email?: string;
    endereco?: string;
  }): Promise<any> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase
      .from('suppliers')
      .insert({
        company_name: supplier.nome.trim(),
        document: supplier.cnpj?.trim() || null,
        contact_name: supplier.contato?.trim() || null,
        email: supplier.email?.trim() || null,
        address: supplier.endereco?.trim() || null
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }
};
