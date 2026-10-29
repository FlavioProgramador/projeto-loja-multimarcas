import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CheckoutModal } from './CheckoutModal';
import { CartItem } from '../../types';

const mockCartItems: CartItem[] = [
  {
    produtoId: 1,
    skuIndex: 0,
    variantId: 'v1',
    nome: 'Camisa Polo',
    tamanho: 'M',
    cor: 'Azul',
    preco: 100.0,
    qtd: 1,
    maxStock: 5
  }
];

describe('CheckoutModal', () => {
  it('desabilita o botão de confirmação quando o valor pago em dinheiro é insuficiente', () => {
    const handleConfirm = vi.fn();
    const handleSetAmountPaid = vi.fn();

    render(
      <CheckoutModal
        isOpen={true}
        onClose={() => {}}
        onConfirm={handleConfirm}
        buyerName="João Silva"
        cpf="12345678900"
        paymentMethod="Dinheiro"
        installments={1}
        cartItems={mockCartItems}
        subtotal={100}
        totalFinal={100}
        discountSummary=""
        amountPaid="50"
        setAmountPaid={handleSetAmountPaid}
      />
    );

    expect(screen.getByText(/⚠️ Falta para o total:/i)).toBeInTheDocument();
    const confirmBtn = screen.getByRole('button', { name: /Confirmar & Imprimir/i });
    expect(confirmBtn).toBeDisabled();
  });

  it('habilita o botão de confirmação quando o valor pago em dinheiro é suficiente e exibe o troco', () => {
    const handleConfirm = vi.fn();
    const handleSetAmountPaid = vi.fn();

    render(
      <CheckoutModal
        isOpen={true}
        onClose={() => {}}
        onConfirm={handleConfirm}
        buyerName="João Silva"
        cpf="12345678900"
        paymentMethod="Dinheiro"
        installments={1}
        cartItems={mockCartItems}
        subtotal={100}
        totalFinal={100}
        discountSummary=""
        amountPaid="150"
        setAmountPaid={handleSetAmountPaid}
      />
    );

    expect(screen.getByText(/Troco a devolver:/i)).toBeInTheDocument();
    expect(screen.getByText('R$ 50,00')).toBeInTheDocument();
    const confirmBtn = screen.getByRole('button', { name: /Confirmar & Imprimir/i });
    expect(confirmBtn).not.toBeDisabled();
  });

  it('aciona setAmountPaid ao clicar nos atalhos de valores em dinheiro', () => {
    const handleSetAmountPaid = vi.fn();

    render(
      <CheckoutModal
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        buyerName="João Silva"
        cpf="12345678900"
        paymentMethod="Dinheiro"
        installments={1}
        cartItems={mockCartItems}
        subtotal={100}
        totalFinal={100}
        discountSummary=""
        amountPaid="0"
        setAmountPaid={handleSetAmountPaid}
      />
    );

    const exactBtn = screen.getByRole('button', { name: /Exato \(R\$ 100,00\)/i });
    fireEvent.click(exactBtn);
    expect(handleSetAmountPaid).toHaveBeenCalledWith('100.00');

    const hundredBtn = screen.getByRole('button', { name: 'R$ 100' });
    fireEvent.click(hundredBtn);
    expect(handleSetAmountPaid).toHaveBeenCalledWith('100');
  });

  it('permite confirmação direta para formas de pagamento não em dinheiro (ex: Cartão)', () => {
    const handleConfirm = vi.fn();

    render(
      <CheckoutModal
        isOpen={true}
        onClose={() => {}}
        onConfirm={handleConfirm}
        buyerName="João Silva"
        cpf="12345678900"
        paymentMethod="Cartão"
        installments={1}
        cartItems={mockCartItems}
        subtotal={100}
        totalFinal={100}
        discountSummary=""
        amountPaid=""
        setAmountPaid={() => {}}
      />
    );

    const confirmBtn = screen.getByRole('button', { name: /Confirmar & Imprimir/i });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);
    expect(handleConfirm).toHaveBeenCalledTimes(1);
  });
});
