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

export interface ReportPaymentBreakdown {
  method: string;
  amount: number;
}

export interface ReportMonthlySeries {
  label: string;
  revenue: number;
  orders: number;
}

export interface ReportCommercialSummary {
  overview: ReportOverview;
  payments: ReportPaymentBreakdown[];
  series: ReportMonthlySeries[];
}

const toDateStart = (date: string) => date + 'T00:00:00.000Z';
const toDateEnd = (date: string) => date + 'T23:59:59.999Z';

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

async function rpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
  if (!isSupabaseConfigured) throw new Error('Supabase não está configurado.');
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw error;
  return (data || []) as T;
}

function normalizeCommercialSummary(value: unknown): ReportCommercialSummary {
  const data = (value || {}) as {
    overview?: Partial<Record<keyof ReportOverview, unknown>>;
    payments?: Array<{ method?: unknown; amount?: unknown }>;
    series?: Array<{ label?: unknown; revenue?: unknown; orders?: unknown }>;
  };
  const overview = data.overview || {};

  return {
    overview: {
      salesCount: toNumber(overview.salesCount),
      revenue: toNumber(overview.revenue),
      discounts: toNumber(overview.discounts),
      expenses: toNumber(overview.expenses),
      operatingResult: toNumber(overview.operatingResult),
      averageTicket: toNumber(overview.averageTicket),
      inventoryUnits: toNumber(overview.inventoryUnits),
      inventoryValue: toNumber(overview.inventoryValue),
    },
    payments: (data.payments || []).map(row => ({
      method: String(row.method || 'OUTRO'),
      amount: toNumber(row.amount),
    })),
    series: (data.series || []).map(row => ({
      label: String(row.label || ''),
      revenue: toNumber(row.revenue),
      orders: toNumber(row.orders),
    })),
  };
}

function isMissingCommercialSummaryRpc(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST202'
    || error.message?.includes('report_commercial_summary') === true;
}

async function getLegacyCommercialSummary(
  storeId: string,
  startDate: string,
  endDate: string,
): Promise<ReportCommercialSummary> {
  const [salesResult, financeResult, inventoryResult, paymentsResult] = await Promise.all([
    supabase
      .from('sales')
      .select('id,total,discount,created_at')
      .eq('store_id', storeId)
      .eq('status', 'COMPLETED')
      .gte('created_at', toDateStart(startDate))
      .lte('created_at', toDateEnd(endDate))
      .order('created_at', { ascending: true }),
    supabase
      .from('financial_transactions')
      .select('type,amount,status,created_at')
      .eq('store_id', storeId)
      .gte('created_at', toDateStart(startDate))
      .lte('created_at', toDateEnd(endDate)),
    supabase
      .from('store_inventory')
      .select('quantity')
      .eq('store_id', storeId),
    supabase
      .from('payments')
      .select('method,amount,status,created_at,sales!inner(store_id,status)')
      .eq('sales.store_id', storeId)
      .eq('sales.status', 'COMPLETED')
      .neq('status', 'CANCELLED')
      .gte('created_at', toDateStart(startDate))
      .lte('created_at', toDateEnd(endDate)),
  ]);

  if (salesResult.error) throw salesResult.error;
  if (financeResult.error) throw financeResult.error;
  if (inventoryResult.error) throw inventoryResult.error;
  if (paymentsResult.error) throw paymentsResult.error;

  const sales = salesResult.data || [];
  const revenue = sales.reduce((sum, row) => sum + toNumber(row.total), 0);
  const discounts = sales.reduce((sum, row) => sum + toNumber(row.discount), 0);
  const expenses = (financeResult.data || [])
    .filter(row => row.type === 'EXPENSE' && row.status !== 'CANCELLED')
    .reduce((sum, row) => sum + toNumber(row.amount), 0);
  const inventoryUnits = (inventoryResult.data || [])
    .reduce((sum, row) => sum + toNumber(row.quantity), 0);

  const paymentBuckets: Record<string, number> = {};
  for (const row of paymentsResult.data || []) {
    const method = row.method || 'OUTRO';
    paymentBuckets[method] = (paymentBuckets[method] || 0) + toNumber(row.amount);
  }

  const seriesBuckets: Record<string, ReportMonthlySeries> = {};
  for (const row of sales) {
    const date = new Date(row.created_at);
    const key = date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0');
    if (!seriesBuckets[key]) {
      seriesBuckets[key] = { label: key, revenue: 0, orders: 0 };
    }
    seriesBuckets[key].revenue += toNumber(row.total);
    seriesBuckets[key].orders += 1;
  }

  return {
    overview: {
      salesCount: sales.length,
      revenue,
      discounts,
      expenses,
      operatingResult: revenue - expenses,
      averageTicket: sales.length ? revenue / sales.length : 0,
      inventoryUnits,
      inventoryValue: 0,
    },
    payments: Object.entries(paymentBuckets)
      .map(([method, amount]) => ({ method, amount }))
      .sort((a, b) => b.amount - a.amount),
    series: Object.values(seriesBuckets),
  };
}

export const ReportsService = {
  async getCommercialSummary(
    storeId: string,
    startDate: string,
    endDate: string,
  ): Promise<ReportCommercialSummary> {
    if (!isSupabaseConfigured) throw new Error('Supabase não está configurado.');

    const { data, error } = await supabase.rpc('report_commercial_summary', {
      p_store_id: storeId,
      p_start_date: startDate,
      p_end_date: endDate,
    });

    if (!error) {
      return normalizeCommercialSummary(data);
    }

    if (isMissingCommercialSummaryRpc(error)) {
      return getLegacyCommercialSummary(storeId, startDate, endDate);
    }

    throw error;
  },

  async getTopProducts(storeId: string, limit = 10): Promise<ReportTopProduct[]> {
    return rpc<ReportTopProduct[]>('report_top_selling_products', {
      p_limit: limit,
      p_store_id: storeId,
    });
  },

  async getProfitabilityByProduct(
    storeId: string,
    startDate: string,
    endDate: string,
  ): Promise<ReportProfitabilityProduct[]> {
    return rpc<ReportProfitabilityProduct[]>('get_profitability_by_product', {
      p_store_id: storeId,
      start_date: startDate,
      end_date: endDate,
    });
  },

  async getProfitabilityByCategory(
    storeId: string,
    startDate: string,
    endDate: string,
  ): Promise<ReportProfitabilityCategory[]> {
    return rpc<ReportProfitabilityCategory[]>('get_profitability_by_category', {
      p_store_id: storeId,
      start_date: startDate,
      end_date: endDate,
    });
  },

  async getStockStatus(storeId: string): Promise<ReportStockStatus[]> {
    return rpc<ReportStockStatus[]>('report_stock_status', { p_store_id: storeId });
  },

  async getMovementSummary(
    storeId: string,
    startDate: string,
    endDate: string,
  ): Promise<ReportMovementSummary[]> {
    return rpc<ReportMovementSummary[]>('report_inventory_movements_summary', {
      p_start_date: toDateStart(startDate),
      p_end_date: toDateEnd(endDate),
      p_store_id: storeId,
    });
  },
};
