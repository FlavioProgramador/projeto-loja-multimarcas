import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SalesService } from './sales.service';

vi.mock('../lib/supabase/client', () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: vi.fn()
  }
}));

import { supabase } from '../lib/supabase/client';

describe('SalesService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve retornar erro se houver item sem variantId no carrinho', async () => {
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
          maxStock: 10
        }
      ],
      buyerName: 'João Silva',
      cpf: '123.456.789-00',
      paymentMethod: 'PIX',
      installments: 1,
      discountValue: 0,
      discountPercent: 0,
      idempotencyKey: 'idem-1'
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('sem identificador de variação válido');
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('deve chamar complete_sale RPC com parâmetros corretos', async () => {
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: {
        success: true,
        sale_id: 'sale-001',
        sale_number: 'PDV #1001',
        total: 100
      },
      error: null
    });

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
          qtd: 2,
          maxStock: 10
        }
      ],
      buyerName: 'João Silva',
      cpf: '12345678900',
      paymentMethod: 'PIX',
      installments: 1,
      discountValue: 0,
      discountPercent: 0,
      idempotencyKey: 'idem-test-123'
    });

    expect(result.success).toBe(true);
    expect(result.saleId).toBe('sale-001');
    expect(result.saleNumber).toBe('PDV #1001');
    expect(result.totalFinal).toBe(100);

    expect(supabase.rpc).toHaveBeenCalledWith('complete_sale', {
      p_store_id: 'store-123',
      p_customer_name: 'João Silva',
      p_customer_cpf: '12345678900',
      p_items: [
        {
          variant_id: 'var-1',
          product_id: 'prod-1',
          product_name: 'Camiseta',
          variant_description: 'M / Azul',
          quantity: 2,
          unit_price: 50
        }
      ],
      p_payment_method: 'PIX',
      p_installments: 1,
      p_discount_value: 0,
      p_discount_percent: 0,
      p_idempotency_key: expect.any(String)
    });
  });
});
