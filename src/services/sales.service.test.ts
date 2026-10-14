import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SalesService } from './sales.service';
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

describe('SalesService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('completeSale', () => {
    it('returns error if cart item has missing variantId', async () => {
      const result = await SalesService.completeSale({
        storeId: 'store-123',
        cartItems: [
          {
            produtoId: 1,
            skuIndex: 0,
            productUuid: 'prod-1',
            variantId: '',
            nome: 'Camiseta',
            tamanho: 'M',
            cor: 'Azul',
            preco: 50,
            qtd: 1,
          },
        ],
        buyerName: 'João Silva',
        cpf: '123.456.789-00',
        paymentMethod: 'PIX',
        installments: 1,
        discountValue: 0,
        discountPercent: 0,
        idempotencyKey: 'key-123',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('identificador de variação válido');
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it('invokes complete_sale RPC with store_id and proper parameters', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: {
          success: true,
          sale_id: 'sale-999',
          sale_number: 'PDV #1001',
          total: 50,
          message: 'Venda realizada com sucesso!',
        },
        error: null,
      } as any);

      const result = await SalesService.completeSale({
        storeId: 'store-123',
        cartItems: [
          {
            produtoId: 1,
            skuIndex: 0,
            productUuid: 'prod-1',
            variantId: 'var-1',
            nome: 'Camiseta',
            tamanho: 'M',
            cor: 'Azul',
            preco: 50,
            qtd: 1,
          },
        ],
        buyerName: 'João Silva',
        cpf: '123.456.789-00',
        paymentMethod: 'PIX',
        installments: 1,
        discountValue: 0,
        discountPercent: 0,
        idempotencyKey: 'key-123',
      });

      expect(result.success).toBe(true);
      expect(result.saleId).toBe('sale-999');
      expect(result.saleNumber).toBe('PDV #1001');
      expect(supabase.rpc).toHaveBeenCalledWith(
        'complete_sale',
        expect.objectContaining({
          p_store_id: 'store-123',
          p_customer_name: 'João Silva',
          p_customer_cpf: '123.456.789-00',
          p_payment_method: 'PIX',
          p_idempotency_key: 'key-123',
        })
      );
    });
  });

  describe('getMovements', () => {
    it('queries sales with store_id and status COMPLETED', async () => {
      const mockResult = Promise.resolve({
        data: [
          {
            id: 'sale-1',
            sale_number: 'PDV #1001',
            customer_name: 'Maria',
            customer_cpf: '111.222.333-44',
            total: 100,
            created_at: '2026-10-01T12:00:00Z',
            payments: [{ method: 'PIX', installments: 1 }],
            sale_items: [{ product_name: 'Camisa', variant_description: 'M / Azul', quantity: 2 }],
          },
        ],
        error: null,
      });

      const mockQueryChain: any = {
        eq: vi.fn().mockImplementation(() => mockQueryChain),
        order: vi.fn().mockImplementation(() => mockQueryChain),
        then: (onfulfilled?: any, onrejected?: any) => mockResult.then(onfulfilled, onrejected),
      };

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue(mockQueryChain),
      } as any);

      const movements = await SalesService.getMovements('store-123');

      expect(supabase.from).toHaveBeenCalledWith('sales');
      expect(mockQueryChain.eq).toHaveBeenCalledWith('status', 'COMPLETED');
      expect(mockQueryChain.eq).toHaveBeenCalledWith('store_id', 'store-123');
      expect(movements).toHaveLength(1);
      expect(movements[0].comprador).toBe('Maria');
      expect(movements[0].valor).toBe(100);
    });
  });
});
