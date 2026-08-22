import { supabase, isSupabaseConfigured } from '../lib/supabase/client';
import { FinancialTransaction, FixedExpense } from '../types';

export const FinanceService = {
  async getTransactions(): Promise<FinancialTransaction[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase
      .from('financial_transactions')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erro ao buscar transações financeiras:', error);
      return [];
    }

    return (data || []).map((t: any, index: number) => ({
      id: index + 1,
      uuid: t.id,
      tipo: (t.type === 'INCOME' || t.type === 'entrada') ? 'entrada' : 'saida',
      descricao: t.description,
      valor: Number(t.amount) || 0,
      data: (t.created_at || t.paid_at || new Date().toISOString()).slice(0, 10)
    }));
  },

  async getFixedExpenses(): Promise<FixedExpense[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase
      .from('fixed_expenses')
      .select('*')
      .order('due_date', { ascending: true });

    if (error) {
      console.error('Erro ao buscar despesas fixas:', error);
      return [];
    }

    return (data || []).map((e: any, index: number) => ({
      id: index + 1,
      uuid: e.id,
      descricao: e.description,
      valor: Number(e.amount) || 0,
      dataVencimento: e.due_date || '',
      categoria: e.category || 'Geral',
      pago: Boolean(e.paid)
    }));
  },

  async toggleExpensePaid(uuid: string, currentPaidState: boolean): Promise<boolean> {
    if (!isSupabaseConfigured || !uuid) return false;
    const { error } = await supabase
      .from('fixed_expenses')
      .update({ paid: !currentPaidState })
      .eq('id', uuid);

    if (error) {
      console.error('Erro ao alterar status de pagamento da despesa fixa:', error);
      return false;
    }
    return true;
  }
};
