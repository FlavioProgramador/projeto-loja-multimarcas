import { renderHook, act } from '@testing-library/react';
import { useSalesDomain } from './useSalesDomain';
import { CartItem, SaleMovement, FinancialTransaction } from '../../types';

describe('useSalesDomain - Discount and Payment Validation', () => {
  const mockCartItems: CartItem[] = [
    {
      produtoId: 1,
      skuIndex: 0,
      nome: 'Camiseta Basica',
      tamanho: 'M',
      cor: 'Preto',
      preco: 100,
      qtd: 2,
    },
  ]; // Subtotal = R$ 200

  const mockSetProducts = vi.fn();
  const mockSetMovements = vi.fn();
  const mockSetCustomers = vi.fn();
  const mockSetTransactions = vi.fn();
  const mockCheckAlerts = vi.fn();
  const mockRefreshDomains = vi.fn().mockResolvedValue(undefined);

  const defaultArgs = {
    activeStoreId: 'store-123',
    isSupabaseConfigured: false,
    movements: [] as SaleMovement[],
    transactions: [] as FinancialTransaction[],
    setProducts: mockSetProducts,
    setMovements: mockSetMovements,
    setCustomers: mockSetCustomers,
    setTransactions: mockSetTransactions,
    checkAlerts: mockCheckAlerts,
    refreshDomains: mockRefreshDomains,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calcula o total correto para uma venda sem descontos', async () => {
    const { result } = renderHook(() => useSalesDomain(defaultArgs));

    let saleResult;
    await act(async () => {
      saleResult = await result.current.processSale({
        cartItems: mockCartItems,
        buyerName: 'Cliente Teste',
        cpf: '12345678901',
        paymentMethod: 'Dinheiro',
        installments: 1,
        discountValue: 0,
        discountPercent: 0,
      });
    });

    expect(saleResult).toEqual({
      success: true,
      message: 'Venda realizada com sucesso!',
      totalFinal: 200,
    });
  });

  it('normaliza desconto em valor negativo para 0 (não aumenta o total da venda)', async () => {
    const { result } = renderHook(() => useSalesDomain(defaultArgs));

    let saleResult;
    await act(async () => {
      saleResult = await result.current.processSale({
        cartItems: mockCartItems,
        buyerName: 'Cliente Teste',
        cpf: '12345678901',
        paymentMethod: 'Dinheiro',
        installments: 1,
        discountValue: -50, // Inválido
        discountPercent: -10, // Inválido
      });
    });

    expect(saleResult).toEqual({
      success: true,
      message: 'Venda realizada com sucesso!',
      totalFinal: 200, // Não deve inflar para 250 ou 270
    });
  });

  it('limita desconto percentual maior que 100% para 100%', async () => {
    const { result } = renderHook(() => useSalesDomain(defaultArgs));

    let saleResult;
    await act(async () => {
      saleResult = await result.current.processSale({
        cartItems: mockCartItems,
        buyerName: 'Cliente Teste',
        cpf: '12345678901',
        paymentMethod: 'Dinheiro',
        installments: 1,
        discountValue: 0,
        discountPercent: 150, // Inválido (> 100%)
      });
    });

    expect(saleResult).toEqual({
      success: true,
      message: 'Venda realizada com sucesso!',
      totalFinal: 0,
    });
  });

  it('limita desconto em valor fixo maior que o subtotal para o valor do subtotal', async () => {
    const { result } = renderHook(() => useSalesDomain(defaultArgs));

    let saleResult;
    await act(async () => {
      saleResult = await result.current.processSale({
        cartItems: mockCartItems,
        buyerName: 'Cliente Teste',
        cpf: '12345678901',
        paymentMethod: 'Dinheiro',
        installments: 1,
        discountValue: 500, // Maior que subtotal (200)
        discountPercent: 0,
      });
    });

    expect(saleResult).toEqual({
      success: true,
      message: 'Venda realizada com sucesso!',
      totalFinal: 0,
    });
  });
});
