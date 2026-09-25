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
        rg,
        phone,
        email,
        address,
        birth_date,
        sales (
          id,
          sale_number,
          total,
          created_at,
          sale_items (
            product_name,
            quantity
          )
        ),
        customer_credit_movements (
          id,
          type,
          amount,
          description,
          created_at,
          reference_id
        )
      `)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      throw error;
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

      const creditMovements = (c.customer_credit_movements || []).map((m: any) => ({
        id: index + 1,
        tipo: m.type === 'CREDIT' ? 'entrada' as const : 'saida' as const,
        valor: Number(m.amount) || 0,
        descricao: m.description,
        data: (m.created_at || '').slice(0, 10),
        referenciaId: m.reference_id || undefined
      }));
      const saldoCredito = creditMovements.reduce(
        (total: number, m: any) => total + (m.tipo === 'entrada' ? m.valor : -m.valor),
        0
      );

      return {
        id: index + 1,
        uuid: c.id,
        nome: c.name,
        cpf: c.cpf || 'Não informado',
        rg: c.rg || '',
        telefone: c.phone || '',
        email: c.email || '',
        endereco: c.address || '',
        dataNascimento: c.birth_date || '',
        saldoCredito: Math.max(0, saldoCredito),
        movimentacoesCredito: creditMovements,
        historico
      };
    });
  },

  async create(customer: {
    nome: string;
    cpf?: string;
    rg?: string;
    telefone?: string;
    email?: string;
    endereco?: string;
    dataNascimento?: string;
  }): Promise<any> {
    if (!isSupabaseConfigured) return null;

    const { data, error } = await supabase
      .from('customers')
      .insert({
        name: customer.nome.trim(),
        cpf: customer.cpf?.trim() || null,
        rg: customer.rg?.trim() || null,
        phone: customer.telefone?.trim() || null,
        email: customer.email?.trim() || null,
        address: customer.endereco?.trim() || null,
        birth_date: customer.dataNascimento || null
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async update(uuid: string, customer: Partial<{
    nome: string;
    cpf: string;
    rg: string;
    telefone: string;
    email: string;
    endereco: string;
    dataNascimento: string;
  }>): Promise<void> {
    if (!isSupabaseConfigured) return;

    const payload = {
      ...(customer.nome !== undefined && { name: customer.nome.trim() }),
      ...(customer.cpf !== undefined && { cpf: customer.cpf.trim() || null }),
      ...(customer.rg !== undefined && { rg: customer.rg.trim() || null }),
      ...(customer.telefone !== undefined && { phone: customer.telefone.trim() || null }),
      ...(customer.email !== undefined && { email: customer.email.trim() || null }),
      ...(customer.endereco !== undefined && { address: customer.endereco.trim() || null }),
      ...(customer.dataNascimento !== undefined && { birth_date: customer.dataNascimento || null })
    };

    const { error } = await supabase.from('customers').update(payload).eq('id', uuid);
    if (error) throw error;
  },

  async remove(uuid: string): Promise<void> {
    if (!isSupabaseConfigured) return;

    const { error } = await supabase
      .from('customers')
      .update({ is_active: false })
      .eq('id', uuid);

    if (error) throw error;
  }
};
