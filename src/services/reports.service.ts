import { supabase, isSupabaseConfigured } from '../lib/supabase/client';

export interface ReportTopProduct {
  product_id: string;
  product_name: string;
  total_quantity_sold: number;
  total_revenue: number;
}

export interface ReportProfitabilityProduct {
  product_id: string;
  product_name: string;
  category_id: string | null;
  total_quantity: number;
  total_revenue: number;
  total_cost: number;
  margin_value: number;
  margin_percentage: number;
}

export interface ReportProfitabilityCategory {
  category_id: string | null;
  category_name: string;
  total_quantity: number;
  total_revenue: number;
  total_cost: number;
  margin_value: number;
  margin_percentage: number;
}

export interface ReportStockStatus {
  product_id: string;
  product_name: string;
  variant_id: string;
  variant_sku: string;
  stock_quantity: number;
  reserved_quantity: number;
  minimum_stock: number;
  status: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'OK' | string;
}

export interface ReportMovementSummary {
  movement_type: string;
  total_quantity: number;
}

export interface ReportOverview {
  salesCount: number;
  revenue: number;
  discounts: number;
  expenses: number;
  operatingResult: number;
  averageTicket: number;
  inventoryUnits: number;
  inventoryValue: number;
}

const toDateStart = (date: string) => date + 'T00:00:00.000Z';
const toDateEnd = (date: string) => date + 'T23:59:59.999Z';

async function rpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
  if (!isSupabaseConfigured) throw new Error('Supabase não está configurado.');
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw error;
  return (data || []) as T;
}

export const ReportsService = {
  async getOverview(storeId: string, startDate: string, endDate: string): Promise<ReportOverview> {
    if (!isSupabaseConfigured) throw new Error('Supabase não está configurado.');

    const [salesResult, financeResult, inventoryResult] = await Promise.all([
      supabase
        .from('sales')
        .select('id,total,discount,created_at')
        .eq('store_id', storeId)
        .eq('status', 'COMPLETED')
        .gte('created_at', toDateStart(startDate))
        .lte('created_at', toDateEnd(endDate)),
      supabase
        .from('financial_transactions')
        .select('type,amount,status,created_at')
        .eq('store_id', storeId)
        .gte('created_at', toDateStart(startDate))
        .lte('created_at', toDateEnd(endDate)),
      supabase
        .from('store_inventory')
        .select('quantity')
        .eq('store_id', storeId)
    ]);

    if (salesResult.error) throw salesResult.error;
    if (financeResult.error) throw financeResult.error;
    if (inventoryResult.error) throw inventoryResult.error;

    const sales = salesResult.data || [];
    const revenue = sales.reduce((sum, row) => sum + Number(row.total || 0), 0);
    const discounts = sales.reduce((sum, row) => sum + Number(row.discount || 0), 0);
    const expenses = (financeResult.data || [])
      .filter(row => row.type === 'EXPENSE' && row.status !== 'CANCELLED')
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const inventoryUnits = (inventoryResult.data || [])
      .reduce((sum, row) => sum + Number(row.quantity || 0), 0);

    return {
      salesCount: sales.length,
      revenue,
      discounts,
      expenses,
      operatingResult: revenue - expenses,
      averageTicket: sales.length ? revenue / sales.length : 0,
      inventoryUnits,
      inventoryValue: 0
    };
  },

  async getTopProducts(storeId: string, limit = 10): Promise<ReportTopProduct[]> {
    return rpc<ReportTopProduct[]>('report_top_selling_products', {
      p_limit: limit,
      p_store_id: storeId
    });
  },

  async getProfitabilityByProduct(storeId: string, startDate: string, endDate: string): Promise<ReportProfitabilityProduct[]> {
    return rpc<ReportProfitabilityProduct[]>('get_profitability_by_product', {
      p_store_id: storeId,
      start_date: startDate,
      end_date: endDate
    });
  },

  async getProfitabilityByCategory(storeId: string, startDate: string, endDate: string): Promise<ReportProfitabilityCategory[]> {
    return rpc<ReportProfitabilityCategory[]>('get_profitability_by_category', {
      p_store_id: storeId,
      start_date: startDate,
      end_date: endDate
    });
  },

  async getStockStatus(storeId: string): Promise<ReportStockStatus[]> {
    return rpc<ReportStockStatus[]>('report_stock_status', { p_store_id: storeId });
  },

  async getMovementSummary(storeId: string, startDate: string, endDate: string): Promise<ReportMovementSummary[]> {
    return rpc<ReportMovementSummary[]>('report_inventory_movements_summary', {
      p_start_date: toDateStart(startDate),
      p_end_date: toDateEnd(endDate),
      p_store_id: storeId
    });
  },

  async getPaymentBreakdown(storeId: string, startDate: string, endDate: string) {
    if (!isSupabaseConfigured) throw new Error('Supabase não está configurado.');
    const { data, error } = await supabase
      .from('payments')
      .select('method,amount,status,created_at,sales!inner(store_id,status)')
      .eq('sales.store_id', storeId)
      .eq('sales.status', 'COMPLETED')
      .neq('status', 'CANCELLED')
      .gte('created_at', toDateStart(startDate))
      .lte('created_at', toDateEnd(endDate));
    if (error) throw error;

    const grouped: Record<string, number> = {};
    for (const row of data || []) {
      const method = row.method || 'OUTRO';
      grouped[method] = (grouped[method] || 0) + Number(row.amount || 0);
    }
    return Object.entries(grouped)
      .map(([method, amount]) => ({ method, amount }))
      .sort((a, b) => b.amount - a.amount);
  },

  async getMonthlySeries(storeId: string, startDate: string, endDate: string) {
    if (!isSupabaseConfigured) throw new Error('Supabase não está configurado.');
    const { data, error } = await supabase
      .from('sales')
      .select('total,created_at')
      .eq('store_id', storeId)
      .eq('status', 'COMPLETED')
      .gte('created_at', toDateStart(startDate))
      .lte('created_at', toDateEnd(endDate))
      .order('created_at', { ascending: true });
    if (error) throw error;

    const buckets: Record<string, { label: string; revenue: number; orders: number }> = {};
    for (const row of data || []) {
      const date = new Date(row.created_at);
      const key = date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0');
      if (!buckets[key]) buckets[key] = { label: key, revenue: 0, orders: 0 };
      buckets[key].revenue += Number(row.total || 0);
      buckets[key].orders += 1;
    }
    return Object.values(buckets);
  }
};
