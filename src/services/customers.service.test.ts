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

  describe('getDirectoryPage', () => {
    it('chama RPC get_customer_directory_page com parâmetros corretos', async () => {
      rpcMock.mockResolvedValue({
        data: {
          rows: [
            {
              id: 'cust-uuid-1',
              name: 'Maria Silva',
              cpf: '123.456.789-00',
              rg: '12.345.678-9',
              phone: '11999998888',
              email: 'maria@email.com',
              address: 'Rua A, 100',
              birth_date: '1990-01-01',
              total_purchases: '5',
              total_spent: '750.00',
              last_purchase_at: '2026-09-20T10:00:00Z',
              credit_balance: '50.00',
            },
          ],
          total: '1',
          stats: {
            totalCustomers: '1',
            activeCustomers: '1',
            customersWithCredit: '1',
            totalPurchases: '5',
            totalRevenue: '750.00',
            creditBalance: '50.00',
          },
        },
        error: null,
      });

      const result = await CustomersService.getDirectoryPage({
        storeId: 'store-uuid-123',
        page: 1,
        pageSize: 20,
        search: 'Maria',
        creditFilter: 'with-credit',
        sort: 'name',
      });

      expect(rpcMock).toHaveBeenCalledWith('get_customer_directory_page', {
        p_store_id: 'store-uuid-123',
        p_search: 'Maria',
        p_credit_filter: 'with-credit',
        p_sort: 'name',
        p_limit: 20,
        p_offset: 0,
      });

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].uuid).toBe('cust-uuid-1');
      expect(result.rows[0].nome).toBe('Maria Silva');
      expect(result.rows[0].saldoCredito).toBe(50);
      expect(result.total).toBe(1);
      expect(result.stats.totalRevenue).toBe(750);
    });

    it('retorna estrutura vazia quando storeId não é fornecido', async () => {
      const result = await CustomersService.getDirectoryPage({
        storeId: '',
      });

      expect(rpcMock).not.toHaveBeenCalled();
      expect(result.rows).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('create', () => {
    it('insere cliente com os dados formatados e vinculados à loja', async () => {
      const singleMock = vi.fn().mockResolvedValue({
        data: { id: 'cust-uuid-new', name: 'João Santos' },
        error: null,
      });
      const selectMock = vi.fn().mockReturnValue({ single: singleMock });
      const insertMock = vi.fn().mockReturnValue({ select: selectMock });
      fromMock.mockReturnValue({ insert: insertMock });

      const newCustomer = {
        nome: ' João Santos ',
        cpf: ' 987.654.321-11 ',
        rg: ' 11.222.333-4 ',
        telefone: ' 11988887777 ',
        email: ' joao@email.com ',
        endereco: ' Av B, 200 ',
        dataNascimento: '1985-05-15',
      };

      const result = await CustomersService.create(newCustomer, 'store-uuid-123');

      expect(fromMock).toHaveBeenCalledWith('customers');
      expect(insertMock).toHaveBeenCalledWith({
        store_id: 'store-uuid-123',
        name: 'João Santos',
        cpf: '987.654.321-11',
        rg: '11.222.333-4',
        phone: '11988887777',
        email: 'joao@email.com',
        address: 'Av B, 200',
        birth_date: '1985-05-15',
      });
      expect(result).toEqual({ id: 'cust-uuid-new', name: 'João Santos' });
    });
  });

  describe('update', () => {
    it('atualiza campos parciais do cliente filtrando por id', async () => {
      const eqMock = vi.fn().mockResolvedValue({ error: null });
      const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
      fromMock.mockReturnValue({ update: updateMock });

      await CustomersService.update('cust-uuid-1', {
        nome: 'Maria Silva Santos',
        telefone: '11977776666',
      });

      expect(fromMock).toHaveBeenCalledWith('customers');
      expect(updateMock).toHaveBeenCalledWith({
        name: 'Maria Silva Santos',
        phone: '11977776666',
      });
      expect(eqMock).toHaveBeenCalledWith('id', 'cust-uuid-1');
    });
  });

  describe('remove', () => {
    it('executa exclusão lógica alterando is_active para false', async () => {
      const eqMock = vi.fn().mockResolvedValue({ error: null });
      const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
      fromMock.mockReturnValue({ update: updateMock });

      await CustomersService.remove('cust-uuid-1');

      expect(fromMock).toHaveBeenCalledWith('customers');
      expect(updateMock).toHaveBeenCalledWith({ is_active: false });
      expect(eqMock).toHaveBeenCalledWith('id', 'cust-uuid-1');
    });
  });
});
