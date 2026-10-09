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

import { ProductsService } from './products.service';

describe('ProductsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna lista vazia quando storeId não é fornecido', async () => {
    const products = await ProductsService.getAll();
    expect(products).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('filtra produtos e calcula quantidade por loja no getAll', async () => {
    const mockQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'prod-1',
            name: 'Camiseta Nike',
            sale_price: 120,
            brands: { id: 'b1', name: 'Nike' },
            categories: { id: 'c1', name: 'Roupas' },
            product_variants: [
              {
                id: 'var-1',
                sku: 'NIKE-P',
                size: 'P',
                color: 'Preto',
                is_active: true,
                store_inventory: [{ store_id: 'store-a', quantity: 15 }],
              },
              {
                id: 'var-2',
                sku: 'NIKE-M',
                size: 'M',
                color: 'Preto',
                is_active: true,
                store_inventory: [{ store_id: 'store-b', quantity: 8 }],
              },
            ],
          },
        ],
        error: null,
      }),
    };

    fromMock.mockReturnValue(mockQueryBuilder);

    const result = await ProductsService.getAll('store-a');

    expect(fromMock).toHaveBeenCalledWith('products');
    expect(result).toHaveLength(1);
    expect(result[0].nome).toBe('Camiseta Nike');
    expect(result[0].skus).toHaveLength(2);
    expect(result[0].skus[0]).toEqual({
      id: 'var-1',
      sku: 'NIKE-P',
      tamanho: 'P',
      cor: 'Preto',
      qtd: 15,
    });
    expect(result[0].skus[1]).toEqual({
      id: 'var-2',
      sku: 'NIKE-M',
      tamanho: 'M',
      cor: 'Preto',
      qtd: 0,
    });
  });

  it('chama RPC manage_product na criação do produto', async () => {
    rpcMock.mockResolvedValue({
      data: { product_id: 'prod-new-1' },
      error: null,
    });

    const created = await ProductsService.create({
      nome: 'Bermuda Tactel',
      marca: 'Cyclone',
      categoria: 'Bermudas',
      preco: 89.9,
      custo: 35.0,
      skus: [{ tamanho: 'G', cor: 'Azul', qtd: 10, sku: 'CYC-BERM-G' }],
    });

    expect(rpcMock).toHaveBeenCalledWith('manage_product', {
      p_product_id: null,
      p_name: 'Bermuda Tactel',
      p_brand_name: 'Cyclone',
      p_category_name: 'Bermudas',
      p_sale_price: 89.9,
      p_cost_price: 35.0,
      p_variants: [
        { size: 'G', color: 'Azul', sku: 'CYC-BERM-G' },
      ],
    });
    expect(created).toEqual({ id: 'prod-new-1' });
  });

  it('executa exclusão lógica (soft delete) no método remove', async () => {
    const mockUpdate = {
      eq: vi.fn().mockResolvedValue({ error: null }),
    };
    const mockFrom = {
      update: vi.fn().mockReturnValue(mockUpdate),
    };
    fromMock.mockReturnValue(mockFrom);

    await ProductsService.remove('prod-uuid-123');

    expect(fromMock).toHaveBeenCalledWith('products');
    expect(mockFrom.update).toHaveBeenCalledWith({ is_active: false });
    expect(mockUpdate.eq).toHaveBeenCalledWith('id', 'prod-uuid-123');
  });
});
