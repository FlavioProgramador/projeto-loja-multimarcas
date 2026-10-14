import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReturnsService } from './returns.service';
import { supabase } from '../lib/supabase/client';

vi.mock('../lib/supabase/client', () => {
  return {
    isSupabaseConfigured: true,
    supabase: {
      rpc: vi.fn(),
      from: vi.fn(),
    },
  };
});

describe('ReturnsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('processReturn', () => {
    it('invokes process_return RPC with store_id and parameters', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: {
          success: true,
          return_id: 'ret-123',
          return_number: 'DEV #101',
          total: 80,
          message: 'Devolução processada com sucesso.',
        },
        error: null,
      } as any);

      const result = await ReturnsService.processReturn({
        storeId: 'store-123',
        originalSaleId: 'sale-999',
        customerName: 'Carlos Santos',
        customerCpf: '999.888.777-66',
        items: [
          {
            produtoId: 1,
            productUuid: 'prod-1',
            variantId: 'var-1',
            nome: 'Camisa Polo',
            tamanho: 'G',
            cor: 'Preto',
            precoUnitario: 80,
            qtd: 1,
            motivo: 'Tamanho incorreto',
          },
        ],
        resolutionType: 'credito_cliente',
        observations: 'Troca solicitada em loja',
      });

      expect(result.success).toBe(true);
      expect(result.returnRecord.uuid).toBe('ret-123');
      expect(result.returnRecord.codigo).toBe('DEV #101');
      expect(supabase.rpc).toHaveBeenCalledWith(
        'process_return',
        expect.objectContaining({
          p_store_id: 'store-123',
          p_original_sale_id: 'sale-999',
          p_customer_name: 'Carlos Santos',
          p_resolution_type: 'credito_cliente',
        })
      );
    });
  });

  describe('getAll', () => {
    it('queries returns with store_id filter', async () => {
      const mockOrder = vi.fn().mockResolvedValueOnce({
        data: [
          {
            id: 'ret-1',
            return_number: 'DEV #101',
            original_sale_id: 'sale-10',
            customer_id: null,
            customer_name: 'Carlos Santos',
            customer_cpf: '999.888.777-66',
            resolution_type: 'credito_cliente',
            status: 'CONCLUIDO',
            total_amount: 80,
            observations: 'Troca',
            expires_at: null,
            created_at: '2026-10-02T10:00:00Z',
            return_items: [
              {
                product_id: 'prod-1',
                product_variant_id: 'var-1',
                product_name: 'Camisa Polo',
                size: 'G',
                color: 'Preto',
                unit_price: 80,
                quantity: 1,
                reason: 'Tamanho incorreto',
              },
            ],
          },
        ],
        error: null,
      });

      const mockEq = vi.fn().mockReturnValue({ order: mockOrder });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });

      vi.mocked(supabase.from).mockReturnValue({
        select: mockSelect,
      } as any);

      const returnsList = await ReturnsService.getAll('store-123');

      expect(supabase.from).toHaveBeenCalledWith('returns');
      expect(mockEq).toHaveBeenCalledWith('store_id', 'store-123');
      expect(returnsList).toHaveLength(1);
      expect(returnsList[0].clienteNome).toBe('Carlos Santos');
      expect(returnsList[0].valorTotal).toBe(80);
    });
  });
});
