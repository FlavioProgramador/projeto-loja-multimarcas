import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CustomersService } from './customers.service';
import { supabase } from '../lib/supabase/client';

vi.mock('../lib/supabase/client', () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

describe('CustomersService', () => {
  const storeId = 'store-123';
  const customerId = 'cust-456';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getDirectoryPage', () => {
    it('returns empty directory page when storeId is empty', async () => {
      const result = await CustomersService.getDirectoryPage({ storeId: '' });
      expect(result.rows).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('uses RPC get_customer_directory_page and formats response', async () => {
      const mockRpcResponse = {
        data: {
          rows: [
            {
              id: customerId,
              name: 'Maria Silva',
              cpf: '123.456.789-00',
              rg: '1234567',
              phone: '(11) 99999-9999',
              email: 'maria@example.com',
              address: 'Rua A, 123',
              birth_date: '1990-01-15',
              total_purchases: '5',
              total_spent: '500.50',
              last_purchase_at: '2026-03-01T10:00:00Z',
              credit_balance: '50.00',
            },
          ],
          total: 1,
          stats: {
            totalCustomers: 1,
            activeCustomers: 1,
            customersWithCredit: 1,
            totalPurchases: 5,
            totalRevenue: 500.5,
            creditBalance: 50,
          },
        },
        error: null,
      };

      vi.mocked(supabase.rpc).mockResolvedValueOnce(mockRpcResponse as any);

      const result = await CustomersService.getDirectoryPage({
        storeId,
        page: 1,
        pageSize: 10,
        search: 'Maria',
      });

      expect(supabase.rpc).toHaveBeenCalledWith('get_customer_directory_page', {
        p_store_id: storeId,
        p_search: 'Maria',
        p_credit_filter: 'all',
        p_sort: 'name',
        p_limit: 10,
        p_offset: 0,
      });

      expect(result.total).toBe(1);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].nome).toBe('Maria Silva');
      expect(result.rows[0].saldoCredito).toBe(50);
      expect(result.stats.totalCustomers).toBe(1);
    });
  });

  describe('create', () => {

    it('inserts a new customer with trimmed data', async () => {
      const mockSingle = vi.fn().mockResolvedValue({
        data: { id: customerId, name: 'João Santos' },
        error: null,
      });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });

      vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as any);

      const result = await CustomersService.create(
        {
          nome: '  João Santos  ',
          cpf: '  98765432100  ',
        },
        storeId
      );

      expect(supabase.from).toHaveBeenCalledWith('customers');
      expect(mockInsert).toHaveBeenCalledWith({
        store_id: storeId,
        name: 'João Santos',
        cpf: '98765432100',
        rg: null,
        phone: null,
        email: null,
        address: null,
        birth_date: null,
      });
      expect(result).toEqual({ id: customerId, name: 'João Santos' });
    });
  });

  describe('update', () => {
    it('updates customer by id', async () => {
      const mockEq = vi.fn().mockResolvedValue({ error: null });
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });

      vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as any);

      await CustomersService.update(customerId, {
        nome: '  João Santos Atualizado  ',
      });

      expect(supabase.from).toHaveBeenCalledWith('customers');
      expect(mockUpdate).toHaveBeenCalledWith({
        name: 'João Santos Atualizado',
      });
      expect(mockEq).toHaveBeenCalledWith('id', customerId);
    });
  });

  describe('remove', () => {
    it('soft-deletes customer by setting is_active to false', async () => {
      const mockEq = vi.fn().mockResolvedValue({ error: null });
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });

      vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as any);

      await CustomersService.remove(customerId);

      expect(supabase.from).toHaveBeenCalledWith('customers');
      expect(mockUpdate).toHaveBeenCalledWith({ is_active: false });
      expect(mockEq).toHaveBeenCalledWith('id', customerId);
    });
  });
});
