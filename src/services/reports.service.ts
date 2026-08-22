import { supabase, isSupabaseConfigured } from '../lib/supabase/client';

export const ReportsService = {
  async getMonthlyComparison() {
    if (!isSupabaseConfigured) return null;

    const currentMonth = new Date().toISOString().slice(0, 7);
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    const prevMonth = d.toISOString().slice(0, 7);

    const { data: sales } = await supabase
      .from('sales')
      .select('id, total, created_at, sale_items(product_name, quantity)');

    const { data: transactions } = await supabase
      .from('financial_transactions')
      .select('id, type, amount, created_at');

    const allSales = sales || [];
    const allTrans = transactions || [];

    const currentSales = allSales.filter(s => (s.created_at || '').startsWith(currentMonth));
    const prevSales = allSales.filter(s => (s.created_at || '').startsWith(prevMonth));

    const totalVendasMes = currentSales.reduce((acc, s) => acc + (Number(s.total) || 0), 0);
    const totalVendasAnt = prevSales.reduce((acc, s) => acc + (Number(s.total) || 0), 0);

    const currentExpenses = allTrans
      .filter(t => (t.created_at || '').startsWith(currentMonth) && (t.type === 'saida' || t.type === 'EXPENSE'))
      .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

    const prevExpenses = allTrans
      .filter(t => (t.created_at || '').startsWith(prevMonth) && (t.type === 'saida' || t.type === 'EXPENSE'))
      .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

    return {
      currentMonth,
      prevMonth,
      totalVendasMes,
      totalVendasAnt,
      lucroMes: totalVendasMes - currentExpenses,
      lucroAnt: totalVendasAnt - prevExpenses,
      qtdVendasMes: currentSales.length,
      qtdVendasAnt: prevSales.length
    };
  }
};
