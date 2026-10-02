const { rpcMock, fromMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock('../lib/supabase/client', () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: rpcMock,
    from: fromMock,
  },
}));

import { ReportsService } from './reports.service';

describe('ReportsService.getCommercialSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('usa uma única RPC e normaliza números do resumo comercial', async () => {
    rpcMock.mockResolvedValue({
      data: {
        overview: {
          salesCount: '3',
          revenue: '450.50',
          discounts: '10.50',
          expenses: '100',
          operatingResult: '350.50',
          averageTicket: '150.166666',
          inventoryUnits: '42',
          inventoryValue: '0',
        },
        payments: [
          { method: 'PIX', amount: '300.50' },
          { method: 'CASH', amount: '150' },
        ],
        series: [
          { label: '2026-10', revenue: '450.50', orders: '3' },
        ],
      },
      error: null,
    });

    const result = await ReportsService.getCommercialSummary(
      'store-a',
      '2026-10-01',
      '2026-10-31',
    );

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('report_commercial_summary', {
      p_store_id: 'store-a',
      p_start_date: '2026-10-01',
      p_end_date: '2026-10-31',
    });
    expect(fromMock).not.toHaveBeenCalled();
    expect(result.overview.salesCount).toBe(3);
    expect(result.overview.revenue).toBe(450.5);
    expect(result.payments).toEqual([
      { method: 'PIX', amount: 300.5 },
      { method: 'CASH', amount: 150 },
    ]);
    expect(result.series).toEqual([
      { label: '2026-10', revenue: 450.5, orders: 3 },
    ]);
  });

  it('não mascara erros da RPC que não sejam ausência da função', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: '42501',
        message: 'Permissão negada para relatórios desta loja.',
      },
    });

    await expect(
      ReportsService.getCommercialSummary('store-a', '2026-10-01', '2026-10-31'),
    ).rejects.toMatchObject({ code: '42501' });

    expect(fromMock).not.toHaveBeenCalled();
  });
});
