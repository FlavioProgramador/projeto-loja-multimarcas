import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CheckoutModal } from './CheckoutModal';
import type { CartItem } from '../../types';

describe('CheckoutModal', () => {
  const mockCartItems: CartItem[] = [
    {
      produtoId: 1,
      skuIndex: 0,
      nome: 'Camiseta Básica',
      preco: 45.0,
      tamanho: 'M',
      cor: 'Preto',
      qtd: 1,
      maxStock: 10
    }
  ];

  it('renderiza os botões de sugestão rápida para pagamento em dinheiro e calcula o troco', () => {
    const handleSetAmountPaid = vi.fn();
    const handleConfirm = vi.fn();
    const handleClose = vi.fn();

    render(
      <CheckoutModal
        isOpen={true}
        onClose={handleClose}
        onConfirm={handleConfirm}
        buyerName="João Silva"
        cpf="12345678901"
        paymentMethod="Dinheiro"
        installments={1}
        cartItems={mockCartItems}
        subtotal={45.0}
        totalFinal={45.0}
        discountSummary=""
        creditUsed={0}
        amountPaid=""
        setAmountPaid={handleSetAmountPaid}
      />
    );

    // Verifica rótulo e atalhos rápidos
    expect(screen.getByText('Valor Recebido (R$):')).toBeTruthy();
    expect(screen.getByText('Sugestões:')).toBeTruthy();

    const btnExato = screen.getByText(/Exato/i);
    expect(btnExato).toBeTruthy();

    fireEvent.click(btnExato);
    expect(handleSetAmountPaid).toHaveBeenCalledWith('45');

    const btn50 = screen.getByRole('button', { name: 'R$ 50' });
    fireEvent.click(btn50);
    expect(handleSetAmountPaid).toHaveBeenCalledWith('50');
  });

  it('exibe o troco correto quando o valor pago for maior que o total final', () => {
    render(
      <CheckoutModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        buyerName="Maria"
        cpf=""
        paymentMethod="Dinheiro"
        installments={1}
        cartItems={mockCartItems}
        subtotal={45.0}
        totalFinal={45.0}
        discountSummary=""
        creditUsed={0}
        amountPaid="50"
        setAmountPaid={vi.fn()}
      />
    );

    expect(screen.getByText('Troco a devolver:')).toBeTruthy();
    expect(screen.getByText('R$ 5,00')).toBeTruthy();
  });
});
