import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { CustomersService } from './customers.service';

describe('CustomersService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('chama RPC get_customer_directory_page com o store_id correto', async () => {
    rpcMock.mockResolvedValue({
      data: {
        rows: [
          {
            id: 'cust-1',
            name: 'João Silva',
            cpf: '123.456.789-00',
            rg: '1234567',
            phone: '11999998888',
            email: 'joao@example.com',
            address: 'Rua A, 123',
            birth_date: '1990-01-01',
            total_purchases: 3,
            total_spent: 450.0,
            last_purchase_at: '2026-10-01T12:00:00Z',
            credit_balance: 50.0,
          },
        ],
        total: 1,
        stats: {
          totalCustomers: 1,
          activeCustomers: 1,
          customersWithCredit: 1,
          totalPurchases: 3,
          totalRevenue: 450.0,
          creditBalance: 50.0,
        },
      },
      error: null,
    });

    const result = await CustomersService.getDirectoryPage({
      storeId: 'store-a',
      page: 1,
      pageSize: 20,
      search: 'João',
    });

    expect(rpcMock).toHaveBeenCalledWith('get_customer_directory_page', {
      p_store_id: 'store-a',
      p_search: 'João',
      p_credit_filter: 'all',
      p_sort: 'name',
      p_limit: 20,
      p_offset: 0,
    });
    expect(result.total).toBe(1);
    expect(result.rows[0].nome).toBe('João Silva');
    expect(result.rows[0].saldoCredito).toBe(50);
  });

  it('cria cliente associando o store_id fornecido', async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: { id: 'cust-2', name: 'Maria Souza', store_id: 'store-b' },
      error: null,
    });
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });

    fromMock.mockReturnValue({ insert: mockInsert });

    const created = await CustomersService.create(
      {
        nome: 'Maria Souza ',
        cpf: ' 98765432100 ',
        telefone: '11988887777',
      },
      'store-b',
    );

    expect(fromMock).toHaveBeenCalledWith('customers');
    expect(mockInsert).toHaveBeenCalledWith({
      store_id: 'store-b',
      name: 'Maria Souza',
      cpf: '98765432100',
      rg: null,
      phone: '11988887777',
      email: null,
      address: null,
      birth_date: null,
    });
    expect(created).toEqual({ id: 'cust-2', name: 'Maria Souza', store_id: 'store-b' });
  });

  it('remove cliente por exclusão lógica (is_active = false)', async () => {
    const mockUpdate = {
      eq: vi.fn().mockResolvedValue({ error: null }),
    };
    const mockFrom = {
      update: vi.fn().mockReturnValue(mockUpdate),
    };
    fromMock.mockReturnValue(mockFrom);

    await CustomersService.remove('cust-uuid-789');

    expect(fromMock).toHaveBeenCalledWith('customers');
    expect(mockFrom.update).toHaveBeenCalledWith({ is_active: false });
    expect(mockUpdate.eq).toHaveBeenCalledWith('id', 'cust-uuid-789');
  });
});
