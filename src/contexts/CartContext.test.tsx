import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { CartProvider, useCart } from './CartContext';
import type { Product } from '../types';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <CartProvider>{children}</CartProvider>
);

const produto = (qtd: number): Product => ({
  id: 1,
  uuid: 'uuid-1',
  nome: 'Camiseta',
  marca: 'Marca',
  categoria: 'Roupas',
  preco: 50,
  skus: [{ id: 'var-1', tamanho: 'M', cor: 'Azul', qtd }],
});

describe('CartContext', () => {
  it('adiciona item ao carrinho e calcula subtotal', () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      const r = result.current.addItem(produto(5), 0);
      expect(r.success).toBe(true);
    });

    expect(result.current.cart).toHaveLength(1);
    expect(result.current.cart[0]).toMatchObject({ produtoId: 1, qtd: 1, preco: 50 });
    expect(result.current.subtotal).toBe(50);
  });

  it('incrementa quantidade ao adicionar o mesmo SKU até o limite do estoque', () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem(produto(2), 0);
      result.current.addItem(produto(2), 0);
      result.current.addItem(produto(2), 0); // além do estoque
    });

    expect(result.current.cart[0].qtd).toBe(2);
    expect(result.current.subtotal).toBe(100);
  });

  it('rejeita item sem estoque', () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    let r!: ReturnType<typeof result.current.addItem>;
    act(() => {
      r = result.current.addItem(produto(0), 0);
    });

    expect(r.success).toBe(false);
    expect(r.message).toMatch(/estoque/i);
    expect(result.current.cart).toHaveLength(0);
  });

  it('updateQuantity altera, trava no estoque e remove ao chegar a zero', () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem(produto(2), 0);
    });

    act(() => result.current.updateQuantity(0, 1));
    expect(result.current.cart[0].qtd).toBe(2);

    act(() => result.current.updateQuantity(0, 1)); // acima do maxStock
    expect(result.current.cart[0].qtd).toBe(2);

    act(() => result.current.updateQuantity(0, -2)); // zera -> remove
    expect(result.current.cart).toHaveLength(0);
  });

  it('removeItem e clearCart esvaziam o carrinho', () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem(produto(5), 0);
      result.current.addItem({ ...produto(5), id: 2, uuid: 'uuid-2' }, 0);
    });
    expect(result.current.cart).toHaveLength(2);

    act(() => result.current.removeItem(0));
    expect(result.current.cart).toHaveLength(1);
    expect(result.current.cart[0].produtoId).toBe(2);

    act(() => result.current.clearCart());
    expect(result.current.cart).toHaveLength(0);
    expect(result.current.subtotal).toBe(0);
  });

  it('lança erro quando usado fora do provider', () => {
    expect(() => renderHook(() => useCart())).toThrow(/CartProvider/);
  });
});
