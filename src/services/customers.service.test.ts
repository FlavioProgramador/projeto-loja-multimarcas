import { describe, it, expect, beforeEach, vi } from 'vitest';

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

  describe('getDirectoryPage', () => {
    it('uses get_customer_directory_page RPC when available', async () => {
      rpcMock.mockResolvedValueOnce({
        data: {
          rows: [
            {
              id: 'cust-1',
              name: 'Maria Silva',
              cpf: '12345678901',
              rg: '123456',
              phone: '11999999999',
              email: 'maria@example.com',
              address: 'Rua A, 123',
              birth_date: '1990-01-01',
              total_purchases: 2,
              total_spent: 350.0,
              last_purchase_at: '2026-10-01T12:00:00Z',
              credit_balance: 50.0,
            },
          ],
          total: 1,
          stats: {
            totalCustomers: 1,
            activeCustomers: 1,
            customersWithCredit: 1,
            totalPurchases: 2,
            totalRevenue: 350.0,
            creditBalance: 50.0,
          },
        },
        error: null,
      });

      const result = await CustomersService.getDirectoryPage({
        storeId: 'store-1',
        page: 1,
        pageSize: 20,
        search: 'Maria',
        creditFilter: 'with-credit',
        sort: 'spending',
      });

      expect(rpcMock).toHaveBeenCalledWith('get_customer_directory_page', {
        p_store_id: 'store-1',
        p_search: 'Maria',
        p_credit_filter: 'with-credit',
        p_sort: 'spending',
        p_limit: 20,
        p_offset: 0,
      });
      expect(result.total).toBe(1);
      expect(result.rows[0].nome).toBe('Maria Silva');
      expect(result.rows[0].saldoCredito).toBe(50);
      expect(result.stats.totalRevenue).toBe(350);
    });

    it('falls back to getLegacyAll when RPC function is missing', async () => {
      rpcMock.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST202', message: 'Could not find the function get_customer_directory_page' },
      });

      const selectCustomersMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'cust-1',
                  name: 'João Souza',
                  cpf: '98765432100',
                  rg: '',
                  phone: '11888888888',
                  email: 'joao@example.com',
                  address: 'Rua B',
                  birth_date: '1985-05-05',
                },
              ],
              error: null,
            }),
          }),
        }),
      });

      const selectSalesMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      });

      const selectCreditMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [],
            error: null,
          }),
        }),
      });

      const selectReturnsMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [],
            error: null,
          }),
        }),
      });

      fromMock.mockImplementation((table: string) => {
        if (table === 'customers') return { select: selectCustomersMock };
        if (table === 'sales') return { select: selectSalesMock };
        if (table === 'customer_credit_movements') return { select: selectCreditMock };
        if (table === 'returns') return { select: selectReturnsMock };
        return { select: vi.fn() };
      });

      const result = await CustomersService.getDirectoryPage({
        storeId: 'store-1',
      });

      expect(result.total).toBe(1);
      expect(result.rows[0].nome).toBe('João Souza');
    });
  });

  describe('search', () => {
    it('searches active customers by name/cpf/phone within store_id', async () => {
      const limitMock = vi.fn().mockResolvedValue({
        data: [
          {
            id: 'cust-1',
            name: 'Ana Lima',
            cpf: '11122233344',
            rg: null,
            phone: '11977777777',
            email: 'ana@example.com',
            address: null,
            birth_date: null,
            customer_credit_movements: [{ type: 'CREDIT', amount: 100 }],
          },
        ],
        error: null,
      });

      const orderMock = vi.fn().mockReturnValue({ limit: limitMock });
      const orMock = vi.fn().mockReturnValue({ order: orderMock });
      const eqActiveMock = vi.fn().mockReturnValue({ or: orMock });
      const eqStoreMock = vi.fn().mockReturnValue({ eq: eqActiveMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqStoreMock });

      fromMock.mockReturnValue({ select: selectMock });

      const customers = await CustomersService.search('store-1', 'Ana', 5);

      expect(fromMock).toHaveBeenCalledWith('customers');
      expect(eqStoreMock).toHaveBeenCalledWith('store_id', 'store-1');
      expect(eqActiveMock).toHaveBeenCalledWith('is_active', true);
      expect(customers).toHaveLength(1);
      expect(customers[0].nome).toBe('Ana Lima');
      expect(customers[0].saldoCredito).toBe(100);
    });
  });

  describe('getDetail', () => {
    it('calls get_customer_detail RPC and formats response', async () => {
      rpcMock.mockResolvedValueOnce({
        data: {
          id: 'cust-1',
          name: 'Carlos Oliveira',
          cpf: '55566677788',
          credit_balance: '120.00',
          history: [
            {
              sale_id: 'sale-1',
              sale_number: 'PDV #1001',
              total: '250.00',
              created_at: '2026-10-02T10:00:00Z',
              status: 'COMPLETED',
              payment_method: 'PIX',
              payment_installments: 1,
              payment_status: 'APPROVED',
              items: 'Camiseta x2',
            },
          ],
          credit_movements: [
            {
              id: 'mov-1',
              type: 'CREDIT',
              amount: '120.00',
              description: 'Devolução de produto',
              created_at: '2026-10-02T10:05:00Z',
            },
          ],
        },
        error: null,
      });

      const detail = await CustomersService.getDetail('store-1', 'cust-1');

      expect(rpcMock).toHaveBeenCalledWith('get_customer_detail', {
        p_store_id: 'store-1',
        p_customer_id: 'cust-1',
      });
      expect(detail.nome).toBe('Carlos Oliveira');
      expect(detail.saldoCredito).toBe(120);
      expect(detail.historico).toHaveLength(1);
      expect(detail.historico[0].vendaId).toBe('PDV #1001');
      expect(detail.movimentacoesCredito).toHaveLength(1);
    });
  });

  describe('create, update, remove', () => {
    it('creates customer with store_id and trimmed fields', async () => {
      const singleMock = vi.fn().mockResolvedValue({
        data: { id: 'cust-new', name: 'Novo Cliente' },
        error: null,
      });
      const selectMock = vi.fn().mockReturnValue({ single: singleMock });
      const insertMock = vi.fn().mockReturnValue({ select: selectMock });

      fromMock.mockReturnValue({ insert: insertMock });

      const result = await CustomersService.create(
        { nome: '  Novo Cliente  ', cpf: '123.456.789-00' },
        'store-1',
      );

      expect(fromMock).toHaveBeenCalledWith('customers');
      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          store_id: 'store-1',
          name: 'Novo Cliente',
          cpf: '123.456.789-00',
        }),
      );
      expect(result).toEqual({ id: 'cust-new', name: 'Novo Cliente' });
    });

    it('updates customer by id', async () => {
      const eqMock = vi.fn().mockResolvedValue({ error: null });
      const updateMock = vi.fn().mockReturnValue({ eq: eqMock });

      fromMock.mockReturnValue({ update: updateMock });

      await CustomersService.update('cust-1', { nome: 'Nome Atualizado' });

      expect(fromMock).toHaveBeenCalledWith('customers');
      expect(updateMock).toHaveBeenCalledWith({ name: 'Nome Atualizado' });
      expect(eqMock).toHaveBeenCalledWith('id', 'cust-1');
    });

    it('soft deletes customer by setting is_active = false', async () => {
      const eqMock = vi.fn().mockResolvedValue({ error: null });
      const updateMock = vi.fn().mockReturnValue({ eq: eqMock });

      fromMock.mockReturnValue({ update: updateMock });

      await CustomersService.remove('cust-1');

      expect(fromMock).toHaveBeenCalledWith('customers');
      expect(updateMock).toHaveBeenCalledWith({ is_active: false });
      expect(eqMock).toHaveBeenCalledWith('id', 'cust-1');
    });
  });
});
