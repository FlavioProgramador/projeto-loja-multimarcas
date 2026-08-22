import React, { createContext, useContext, useState } from 'react';
import { CartItem, Product } from '../types';

interface CartContextType {
  cart: CartItem[];
  addItem: (product: Product, skuIndex: number) => { success: boolean; message?: string };
  updateQuantity: (index: number, delta: number) => void;
  removeItem: (index: number) => void;
  clearCart: () => void;
  subtotal: number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [cart, setCart] = useState<CartItem[]>([]);

  const addItem = (product: Product, skuIndex: number): { success: boolean; message?: string } => {
    const sku = product.skus[skuIndex];
    if (!sku || sku.qtd <= 0) {
      return { success: false, message: 'Estoque insuficiente para este item.' };
    }

    setCart(prev => {
      const existingIdx = prev.findIndex(
        item => item.produtoId === product.id && item.skuIndex === skuIndex
      );

      if (existingIdx >= 0) {
        const currentQty = prev[existingIdx].qtd;
        if (currentQty + 1 > sku.qtd) {
          return prev;
        }
        const copy = [...prev];
        copy[existingIdx] = { ...copy[existingIdx], qtd: copy[existingIdx].qtd + 1 };
        return copy;
      }

      return [
        ...prev,
        {
          produtoId: product.id,
          skuIndex,
          nome: product.nome,
          tamanho: sku.tamanho,
          cor: sku.cor,
          preco: product.preco,
          qtd: 1,
          variantId: sku.id,
          productUuid: product.uuid
        }
      ];
    });

    return { success: true };
  };

  const updateQuantity = (index: number, delta: number) => {
    setCart(prev => {
      if (!prev[index]) return prev;
      const newQtd = prev[index].qtd + delta;
      if (newQtd <= 0) {
        return prev.filter((_, idx) => idx !== index);
      }
      const copy = [...prev];
      copy[index] = { ...copy[index], qtd: newQtd };
      return copy;
    });
  };

  const removeItem = (index: number) => {
    setCart(prev => prev.filter((_, idx) => idx !== index));
  };

  const clearCart = () => {
    setCart([]);
  };

  const subtotal = cart.reduce((acc, item) => acc + item.preco * item.qtd, 0);

  return (
    <CartContext.Provider
      value={{
        cart,
        addItem,
        updateQuantity,
        removeItem,
        clearCart,
        subtotal
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used within CartProvider');
  return context;
};
