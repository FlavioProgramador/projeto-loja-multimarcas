import { supabase, isSupabaseConfigured } from '../lib/supabase/client';
import { Customer } from '../types';

export const CustomersService = {
  async getAll(): Promise<Customer[]> {
    if (!isSupabaseConfigured) return [];
    
    const { data, error } = await supabase
      .from('customers')
      .select(`
        id,
        name,
        cpf,
        phone,
        email,
        address,
        sales (
          id,
          sale_number,
          total,
          created_at,
          sale_items (
            product_name,
            quantity
          )
        )
      `)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      console.error('Erro ao buscar clientes:', error);
      return [];
    }

    return (data || []).map((c: any, index: number) => {
      const sales = c.sales || [];
      const historico = sales.map((s: any) => {
        const itemNames = (s.sale_items || [])
          .map((i: any) => `${i.product_name} x${i.quantity}`)
          .join(', ');

        return {
          vendaId: s.sale_number,
          valor: Number(s.total) || 0,
          data: (s.created_at || '').slice(0, 10),
          itens: itemNames || 'Venda PDV'
        };
      });

      return {
        id: c.id,
        nome: c.name,
        cpf: c.cpf || 'Não informado',
        telefone: c.phone || '',
        email: c.email || '',
        endereco: c.address || '',
        historico
      };
    });
  },

  async create(customer: {
    nome: string;
    cpf?: string;
    telefone?: string;
    email?: string;
    endereco?: string;
  }): Promise<any> {
    if (!isSupabaseConfigured) return null;

    const { data, error } = await supabase
      .from('customers')
      .insert({
        name: customer.nome.trim(),
        cpf: customer.cpf?.trim() || null,
        phone: customer.telefone?.trim() || null,
        email: customer.email?.trim() || null,
        address: customer.endereco?.trim() || null
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }
};
