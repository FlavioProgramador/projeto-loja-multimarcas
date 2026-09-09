import { supabase, isSupabaseConfigured } from '../lib/supabase/client';

export interface DashboardMetrics {
  totalVendasMes: number;
  totalVendasHoje: number;
  ticketMedio: number;
  lowStockCount: number;
  recentSales: any[];
}

export const DashboardService = {
  async getMetrics(): Promise<DashboardMetrics | null> {
    if (!isSupabaseConfigured) return null;

    try {
      const todayStr = new Date().toISOString().slice(0, 10);
      const currentMonthStr = new Date().toISOString().slice(0, 7);

      // 1. Buscar vendas
      const { data: sales, error: salesError } = await supabase
        .from('sales')
        .select('id, sale_number, total, created_at, customer_name, payments(method, installments), sale_items(product_name, quantity)')
        .eq('status', 'COMPLETED')
        .order('created_at', { ascending: false });

      if (salesError) throw salesError;

      const allSales = sales || [];
      const mesSales = allSales.filter(s => (s.created_at || '').startsWith(currentMonthStr));
      const hojeSales = allSales.filter(s => (s.created_at || '').startsWith(todayStr));

      const totalVendasMes = mesSales.reduce((acc, s) => acc + (Number(s.total) || 0), 0);
      const totalVendas = allSales.reduce((acc, s) => acc + (Number(s.total) || 0), 0);
      const ticketMedio = allSales.length > 0 ? totalVendas / allSales.length : 0;

      // 2. Buscar itens em baixo estoque
      const { data: lowStockVariants } = await supabase
        .from('product_variants')
        .select('id, stock_quantity')
        .lte('stock_quantity', 2);

      const lowStockCount = (lowStockVariants || []).length;

      // 3. Vendas recentes formatadas
      const recentSales = allSales.slice(0, 5).map((s: any, idx: number) => {
        const itemNames = (s.sale_items || [])
          .map((i: any) => `${i.product_name} x${i.quantity}`)
          .join(', ');
        const payment = s.payments?.[0];

        return {
          id: idx + 1,
          produtos: itemNames || 'Venda PDV',
          vendaId: s.sale_number,
          formaPagamento: payment ? `${payment.method}` : 'PIX',
          comprador: s.customer_name || 'Consumidor Final',
          valor: Number(s.total) || 0,
          data: (s.created_at || '').slice(0, 10)
        };
      });

      return {
        totalVendasMes: totalVendasMes || totalVendas,
        totalVendasHoje: hojeSales.length,
        ticketMedio,
        lowStockCount,
        recentSales
      };
    } catch (err) {
      console.error('Erro ao calcular métricas do dashboard:', err);
      return null;
    }
  }
};
