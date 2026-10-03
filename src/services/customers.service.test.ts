import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CustomersService } from './customers.service';

vi.mock('../lib/supabase/client', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

import { supabase } from '../lib/supabase/client';

describe('CustomersService - Multi-tenant Isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve retornar paginação vazia caso storeId não seja fornecido', async () => {
    const result = await CustomersService.getDirectoryPage({ storeId: '' });
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('deve chamar rpc com o storeId fornecido', async () => {
    const mockRpc = vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: {
        rows: [
          {
            id: 'cust-uuid-1',
            name: 'Cliente Teste',
            cpf: '12345678900',
            rg: null,
            phone: '11999999999',
            email: 'cliente@teste.com',
            address: 'Rua A',
            birth_date: '1990-01-01',
            total_purchases: 2,
            total_spent: 150.0,
            last_purchase_at: '2026-09-25T10:00:00Z',
            credit_balance: 20.0,
          },
        ],
        total: 1,
        stats: {
          totalCustomers: 1,
          activeCustomers: 1,
          customersWithCredit: 1,
          totalPurchases: 2,
          totalRevenue: 150.0,
          creditBalance: 20.0,
        },
      },
      error: null,
    } as any);

    const result = await CustomersService.getDirectoryPage({ storeId: 'store-uuid-123' });

    expect(mockRpc).toHaveBeenCalledWith('get_customer_directory_page', {
      p_store_id: 'store-uuid-123',
      p_search: null,
      p_credit_filter: 'all',
      p_sort: 'name',
      p_limit: 20,
      p_offset: 0,
    });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].nome).toBe('Cliente Teste');
  });

  it('deve lançar erro ao tentar criar cliente sem store_id', async () => {
    await expect(
      CustomersService.create({ nome: 'Cliente Sem Loja' }, '')
    ).rejects.toThrow('store_id é obrigatório para cadastrar cliente no Supabase.');
  });
});
