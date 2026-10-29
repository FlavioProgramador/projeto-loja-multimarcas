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

import { ReturnsService } from './returns.service';

describe('ReturnsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPage', () => {
    it('retorna dados paginados e resumo ao chamar a RPC get_returns_page com sucesso', async () => {
      rpcMock.mockResolvedValue({
        data: {
          rows: [
            {
              id: 'ret-1',
              return_number: 'DEV-001',
              original_sale_id: 'sale-1',
              customer_id: 'cust-1',
              customer_name: 'João Silva',
              customer_cpf: '12345678900',
              resolution_type: 'credito_cliente',
              status: 'CONCLUIDO',
              total_amount: '150.00',
              observations: 'Tamanho incorreto',
              expires_at: null,
              created_at: '2026-10-01T10:00:00Z',
              return_items: [
                {
                  product_id: 'prod-1',
                  product_variant_id: 'var-1',
                  product_name: 'Camiseta',
                  size: 'M',
                  color: 'Azul',
                  unit_price: '75.00',
                  quantity: '2',
                  reason: 'Tamanho incorreto',
                },
              ],
            },
          ],
          total: '1',
          summary: {
            occurrences: '1',
            totalPieces: '2',
            totalCredits: '150.00',
            customerCreditBalance: '150.00',
            customersWithCredit: '1',
          },
        },
        error: null,
      });

      const result = await ReturnsService.getPage({
        storeId: 'store-123',
        page: 1,
        pageSize: 15,
        search: 'João',
        resolutionType: 'credito_cliente',
      });

      expect(rpcMock).toHaveBeenCalledWith('get_returns_page', {
        p_store_id: 'store-123',
        p_search: 'João',
        p_resolution_type: 'credito_cliente',
        p_limit: 15,
        p_offset: 0,
      });

      expect(result.total).toBe(1);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toEqual({
        id: 1,
        uuid: 'ret-1',
        codigo: 'DEV-001',
        data: '2026-10-01',
        vendaOriginalId: 'sale-1',
        clienteNome: 'João Silva',
        clienteCpf: '12345678900',
        itens: [
          {
            produtoId: 0,
            productUuid: 'prod-1',
            variantId: 'var-1',
            nome: 'Camiseta',
            tamanho: 'M',
            cor: 'Azul',
            precoUnitario: 75,
            qtd: 2,
            motivo: 'Tamanho incorreto',
          },
        ],
        valorTotal: 150,
        tipoResolucao: 'credito_cliente',
        status: 'CONCLUIDO',
        dataValidade: undefined,
        observacoes: 'Tamanho incorreto',
      });
      expect(result.summary).toEqual({
        occurrences: 1,
        totalPieces: 2,
        totalCredits: 150,
        customerCreditBalance: 150,
        customersWithCredit: 1,
      });
    });

    it('utiliza fallback via consultas diretas quando a RPC get_returns_page não existe (PGRST202)', async () => {
      rpcMock.mockResolvedValue({
        data: null,
        error: { code: 'PGRST202', message: 'Could not find the function' },
      });

      const mockReturnsSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'ret-1',
                return_number: 'DEV-001',
                original_sale_id: 'sale-1',
                customer_id: 'cust-1',
                customer_name: 'Maria Oliveira',
                customer_cpf: '98765432100',
                resolution_type: 'credito_cliente',
                status: 'CONCLUIDO',
                total_amount: 100,
                observations: null,
                expires_at: null,
                created_at: '2026-10-02T12:00:00Z',
                return_items: [],
              },
            ],
            error: null,
          }),
        }),
      });

      const mockCreditSelect = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [
              { customer_id: 'cust-1', type: 'CREDIT', amount: 100 },
            ],
            error: null,
          }),
        }),
      });

      fromMock.mockImplementation((table: string) => {
        if (table === 'returns') {
          return { select: mockReturnsSelect };
        }
        if (table === 'customer_credit_movements') {
          return mockCreditSelect();
        }
        return {};
      });

      const result = await ReturnsService.getPage({
        storeId: 'store-123',
        page: 1,
        pageSize: 10,
      });

      expect(result.total).toBe(1);
      expect(result.rows[0].clienteNome).toBe('Maria Oliveira');
      expect(result.summary.customerCreditBalance).toBe(100);
      expect(result.summary.customersWithCredit).toBe(1);
    });
  });

  describe('processReturn', () => {
    it('chama RPC process_return e retorna o registro de devolução em caso de sucesso', async () => {
      rpcMock.mockResolvedValue({
        data: {
          success: true,
          message: 'Devolução processada com sucesso.',
          return_id: 'ret-100',
          return_number: 'DEV-100',
          total: 200,
        },
        error: null,
      });

      const result = await ReturnsService.processReturn({
        storeId: 'store-123',
        originalSaleId: 'sale-99',
        customerName: 'Carlos Lima',
        customerCpf: '11122233344',
        items: [
          {
            produtoId: 1,
            variantId: 'var-10',
            nome: 'Jaqueta',
            tamanho: 'G',
            cor: 'Preto',
            precoUnitario: 200,
            qtd: 1,
            motivo: 'Defeito',
          },
        ],
        resolutionType: 'credito_cliente',
        observations: 'Troca de produto com defeito',
      });

      expect(rpcMock).toHaveBeenCalledWith('process_return', {
        p_store_id: 'store-123',
        p_original_sale_id: 'sale-99',
        p_customer_id: null,
        p_customer_name: 'Carlos Lima',
        p_customer_cpf: '11122233344',
        p_items: [
          {
            variant_id: 'var-10',
            quantity: 1,
            product_name: 'Jaqueta',
            size: 'G',
            color: 'Preto',
            reason: 'Defeito',
          },
        ],
        p_resolution_type: 'credito_cliente',
        p_observations: 'Troca de produto com defeito',
      });

      expect(result.success).toBe(true);
      expect(result.returnRecord.uuid).toBe('ret-100');
      expect(result.returnRecord.codigo).toBe('DEV-100');
      expect(result.returnRecord.valorTotal).toBe(200);
    });

    it('trata falha quando a RPC retorna success = false', async () => {
      rpcMock.mockResolvedValue({
        data: {
          success: false,
          message: 'Quantidade devolvida excede a quantidade disponível.',
        },
        error: null,
      });

      const result = await ReturnsService.processReturn({
        storeId: 'store-123',
        originalSaleId: 'sale-99',
        items: [],
        resolutionType: 'estorno_dinheiro',
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Quantidade devolvida excede a quantidade disponível.');
    });
  });
});
