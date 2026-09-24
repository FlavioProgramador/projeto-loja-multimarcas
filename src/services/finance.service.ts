import { supabase, isSupabaseConfigured } from '../lib/supabase/client';
import { FinancialTransaction, FixedExpense } from '../types';

interface FinancialTransactionRow {
  id: string;
  type: 'INCOME' | 'EXPENSE';
  description: string;
  amount: number | string;
  created_at: string | null;
  paid_at: string | null;
}

interface FixedExpenseRow {
  id: string;
  description: string;
  amount: number | string;
  due_date: string;
  category: string | null;
  paid: boolean;
}

export const FinanceService = {
  async getTransactions(storeId?: string): Promise<FinancialTransaction[]> {
    if (!isSupabaseConfigured || !storeId) return [];

    const { data, error } = await supabase
      .from('financial_transactions')
      .select('id, type, description, amount, created_at, paid_at')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erro ao buscar transações financeiras:', error);
      return [];
    }

    return ((data || []) as FinancialTransactionRow[]).map((t, index) => ({
      id: index + 1,
      uuid: t.id,
      tipo: t.type,
      descricao: t.description,
      valor: Number(t.amount) || 0,
      data: (t.created_at || t.paid_at || new Date().toISOString()).slice(0, 10)
    }));
  },

  async getFixedExpenses(storeId?: string): Promise<FixedExpense[]> {
    if (!isSupabaseConfigured || !storeId) return [];

    const { data, error } = await supabase
      .from('fixed_expenses')
      .select('id, description, amount, due_date, category, paid')
      .eq('store_id', storeId)
      .order('due_date', { ascending: true });

    if (error) {
      console.error('Erro ao buscar despesas fixas:', error);
      return [];
    }

    return ((data || []) as FixedExpenseRow[]).map((e, index) => ({
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
