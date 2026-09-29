import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock('../lib/supabase/client', () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: rpcMock },
}));

import { SalesService } from './sales.service';
import type { CartItem } from '../types';

const item = (over: Partial<CartItem> = {}): CartItem => ({
  produtoId: 1,
  skuIndex: 0,
  nome: 'Camiseta',
  tamanho: 'M',
  cor: 'Azul',
  preco: 50,
  qtd: 2,
  variantId: 'variant-1',
  productUuid: 'uuid-1',
  ...over,
});

const baseParams = {
  storeId: 'store-1',
  cartItems: [item()],
  buyerName: 'João',
  cpf: '123.456.789-09',
  paymentMethod: 'CREDIT',
  installments: 2,
  discountValue: 10,
  discountPercent: 0,
  idempotencyKey: 'key-123',
};

describe('SalesService.completeSale', () => {
  beforeEach(() => {
    rpcMock.mockResolvedValue({
      data: { success: true, total: '90.00', sale_number: 'V-0001', sale_id: 'sale-1' },
      error: null,
    });
  });

  it('envia itens e pagamento para a RPC complete_sale', async () => {
    const r = await SalesService.completeSale(baseParams);

    expect(r.success).toBe(true);
    expect(r.totalFinal).toBe(90);
    expect(r.saleNumber).toBe('V-0001');

    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [fnName, payload] = rpcMock.mock.calls[0];
    expect(fnName).toBe('complete_sale');
    expect(payload).toMatchObject({
      p_store_id: 'store-1',
      p_payment_method: 'CREDIT',
      p_installments: 2,
      p_discount_value: 10,
    });
    expect(payload.p_items).toEqual([
      {
        variant_id: 'variant-1',
        product_id: 'uuid-1',
        product_name: 'Camiseta',
        variant_description: 'M / Azul',
        quantity: 2,
        unit_price: 50,
      },
    ]);
  });

  it('rejeita item sem variant_id antes de chamar a RPC', async () => {
    const r = await SalesService.completeSale({ ...baseParams, cartItems: [item({ variantId: undefined })] });
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/varia/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('reutiliza a idempotency key para o mesmo payload', async () => {
    await SalesService.completeSale(baseParams);
    await SalesService.completeSale(baseParams);

    const keys = rpcMock.mock.calls.map(c => c[1].p_idempotency_key);
    expect(keys[0]).toBe(keys[1]);
  });

  it('retorna falha amigável quando a RPC retorna erro', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'Estoque insuficiente' } });

    const r = await SalesService.completeSale(baseParams);
    expect(r.success).toBe(false);
    expect(r.message).toBe('Estoque insuficiente');
  });

  it('normaliza campos opcionais do cliente', async () => {
    await SalesService.completeSale({ ...baseParams, buyerName: '  ', cpf: ' ' });

    const payload = rpcMock.mock.calls[0][1];
    expect(payload.p_customer_name).toBe('Cliente não identificado');
    expect(payload.p_customer_cpf).toBe('Não informado');
  });
});

describe('SalesService.getMovements', () => {
  it('mapeia vendas COMPLETED para SaleMovement', async () => {
    const result = {
      data: [
        {
          id: 's1',
          sale_number: 'V-0007',
          customer_name: 'Maria',
          customer_cpf: '12345678909',
          total: '199.90',
          created_at: '2026-09-20T10:00:00Z',
          payments: [{ method: 'CREDIT', installments: 3 }],
          sale_items: [{ product_name: 'Vestido', variant_description: 'P / Preto', quantity: 1 }],
        },
      ],
      error: null,
    };
    // Objeto encadeável e "thenable", como o query builder do supabase-js
    const query: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      then: (resolve: (v: typeof result) => unknown) => resolve(result),
    };
    const { supabase } = await import('../lib/supabase/client');
    (supabase as unknown as { from: unknown }).from = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(query) });

    const movements = await SalesService.getMovements('store-1');

    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      uuid: 's1',
      tipo: 'INCOME',
      valor: 199.9,
      formaPagamento: 'CREDIT 3x',
      comprador: 'Maria',
      data: '2026-09-20',
      vendaId: 'V-0007',
    });
    expect(query.eq).toHaveBeenCalledWith('status', 'COMPLETED');
    expect(query.eq).toHaveBeenCalledWith('store_id', 'store-1');
  });
});