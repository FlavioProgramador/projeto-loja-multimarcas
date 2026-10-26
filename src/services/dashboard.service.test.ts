import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fromMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
}));

vi.mock('../lib/supabase/client', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: fromMock,
  },
}));

import { DashboardService } from './dashboard.service';

describe('DashboardService.getMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calcula métricas filtrando por store_id quando informado', async () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const mockSales = [
      {
        id: 'sale-1',
        sale_number: 'PDV #101',
        total: 150.00,
        created_at: `${todayStr}T10:00:00Z`,
        customer_name: 'João Silva',
        payments: [{ method: 'PIX', installments: 1 }],
        sale_items: [{ product_name: 'Camisa Polo', quantity: 1 }]
      },
      {
        id: 'sale-2',
        sale_number: 'PDV #102',
        total: 250.00,
        created_at: `${todayStr}T14:30:00Z`,
        customer_name: 'Maria Santos',
        payments: [{ method: 'CREDIT_CARD', installments: 2 }],
        sale_items: [{ product_name: 'Calça Jeans', quantity: 2 }]
      }
    ];

    const salesChain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    };
    salesChain.then = (resolve: any) => resolve({ data: mockSales, error: null });

    const storeInventoryChain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
    };
    storeInventoryChain.then = (resolve: any) => resolve({ data: [{ id: 'inv-1', quantity: 1 }], error: null });

    fromMock.mockImplementation((table: string) => {
      if (table === 'sales') return salesChain;
      if (table === 'store_inventory') return storeInventoryChain;
      throw new Error(`Tabela inesperada: ${table}`);
    });

    const metrics = await DashboardService.getMetrics('store-abc');

    expect(fromMock).toHaveBeenCalledWith('sales');
    expect(salesChain.eq).toHaveBeenCalledWith('status', 'COMPLETED');
    expect(salesChain.eq).toHaveBeenCalledWith('store_id', 'store-abc');

    expect(fromMock).toHaveBeenCalledWith('store_inventory');
    expect(storeInventoryChain.eq).toHaveBeenCalledWith('store_id', 'store-abc');
    expect(storeInventoryChain.lte).toHaveBeenCalledWith('quantity', 2);

    expect(metrics).not.toBeNull();
    expect(metrics?.totalVendasMes).toBe(400);
    expect(metrics?.totalVendasHoje).toBe(2);
    expect(metrics?.ticketMedio).toBe(200);
    expect(metrics?.lowStockCount).toBe(1);
    expect(metrics?.recentSales).toHaveLength(2);
  });

  it('calcula métricas globais sem store_id quando storeId não for fornecido', async () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const mockSales = [
      {
        id: 'sale-1',
        sale_number: 'PDV #101',
        total: 100.00,
        created_at: `${todayStr}T08:00:00Z`,
        customer_name: 'Consumidor',
        payments: [{ method: 'PIX', installments: 1 }],
        sale_items: [{ product_name: 'Boné', quantity: 1 }]
      }
    ];

    const salesChain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    };
    salesChain.then = (resolve: any) => resolve({ data: mockSales, error: null });

    const productVariantsChain: any = {
      select: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
    };
    productVariantsChain.then = (resolve: any) => resolve({ data: [{ id: 'var-1', stock_quantity: 0 }, { id: 'var-2', stock_quantity: 2 }], error: null });

    fromMock.mockImplementation((table: string) => {
      if (table === 'sales') return salesChain;
      if (table === 'product_variants') return productVariantsChain;
      throw new Error(`Tabela inesperada: ${table}`);
    });

    const metrics = await DashboardService.getMetrics();

    expect(fromMock).toHaveBeenCalledWith('sales');
    expect(salesChain.eq).toHaveBeenCalledWith('status', 'COMPLETED');
    expect(salesChain.eq).not.toHaveBeenCalledWith('store_id', expect.anything());

    expect(fromMock).toHaveBeenCalledWith('product_variants');
    expect(productVariantsChain.lte).toHaveBeenCalledWith('stock_quantity', 2);

    expect(metrics).not.toBeNull();
    expect(metrics?.totalVendasMes).toBe(100);
    expect(metrics?.totalVendasHoje).toBe(1);
    expect(metrics?.ticketMedio).toBe(100);
    expect(metrics?.lowStockCount).toBe(2);
  });
});
