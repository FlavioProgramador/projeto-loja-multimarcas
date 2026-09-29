import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { CartProvider, useCart } from './CartContext';
import { Product } from '../types';

const mockProduct: Product = {
  id: 101,
  uuid: 'prod-uuid-101',
  nome: 'Camiseta Teste',
  marca: 'Marca Teste',
  categoria: 'Camisetas',
  preco: 99.9,
  skus: [
    { id: 'sku-1', tamanho: 'M', cor: 'Preto', qtd: 2 },
    { id: 'sku-2', tamanho: 'G', cor: 'Branco', qtd: 0 }
  ]
};

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <CartProvider>{children}</CartProvider>
);

describe('CartContext - Stock Validation and Management', () => {
  it('adiciona um item ao carrinho com sucesso dentro do limite de estoque', () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      const res = result.current.addItem(mockProduct, 0);
      expect(res.success).toBe(true);
    });

    expect(result.current.cart).toHaveLength(1);
    expect(result.current.cart[0]).toMatchObject({
      produtoId: 101,
      skuIndex: 0,
      nome: 'Camiseta Teste',
      tamanho: 'M',
      cor: 'Preto',
      preco: 99.9,
      qtd: 1,
      maxStock: 2
    });
    expect(result.current.subtotal).toBe(99.9);
  });

  it('impede a adição de item sem estoque disponível', () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      const res = result.current.addItem(mockProduct, 1);
      expect(res.success).toBe(false);
      expect(res.message).toBe('Estoque insuficiente para este item.');
    });

    expect(result.current.cart).toHaveLength(0);
  });

  it('retorna erro ao tentar adicionar item além do limite de estoque disponível', () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    // Adiciona 1x (estoque máximo = 2)
    act(() => {
      const res = result.current.addItem(mockProduct, 0);
      expect(res.success).toBe(true);
    });

    // Adiciona 2x
    act(() => {
      const res = result.current.addItem(mockProduct, 0);
      expect(res.success).toBe(true);
    });

    expect(result.current.cart[0].qtd).toBe(2);

    // Tenta adicionar 3x (superando estoque 2)
    act(() => {
      const res = result.current.addItem(mockProduct, 0);
      expect(res.success).toBe(false);
      expect(res.message).toBe('Estoque máximo atingido para este item (2 un).');
    });

    expect(result.current.cart[0].qtd).toBe(2);
  });

  it('trava atualização de quantidade no limite máximo via updateQuantity', () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem(mockProduct, 0);
    });

    // Incrementa até 2
    act(() => {
      result.current.updateQuantity(0, 1);
    });
    expect(result.current.cart[0].qtd).toBe(2);

    // Tenta incrementar além de 2 (máximo de estoque)
    act(() => {
      result.current.updateQuantity(0, 1);
    });
    expect(result.current.cart[0].qtd).toBe(2);
  });

  it('permite remover item e limpar carrinho', () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem(mockProduct, 0);
    });
    expect(result.current.cart).toHaveLength(1);

    act(() => {
      result.current.removeItem(0);
    });
    expect(result.current.cart).toHaveLength(0);

    act(() => {
      result.current.addItem(mockProduct, 0);
    });
    expect(result.current.cart).toHaveLength(1);

    act(() => {
      result.current.clearCart();
    });
    expect(result.current.cart).toHaveLength(0);
  });
});
