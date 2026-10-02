import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CheckoutModal } from './CheckoutModal';
import { CartItem } from '../../types';

describe('CheckoutModal', () => {
  const mockCartItems: CartItem[] = [
    {
      produtoId: 1,
      skuIndex: 0,
      variantId: '101',
      nome: 'Camisa Polo',
      tamanho: 'M',
      cor: 'Azul',
      preco: 100,
      qtd: 1
    }
  ];

  it('renders discount summary when discountSummary prop is provided', () => {
    render(
      <CheckoutModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        buyerName="João Silva"
        cpf="123.456.789-00"
        paymentMethod="Dinheiro"
        installments={1}
        cartItems={mockCartItems}
        subtotal={100}
        totalFinal={90}
        discountSummary="R$ 10,00 (10%)"
        amountPaid="90"
        setAmountPaid={vi.fn()}
      />
    );

    expect(screen.getByText(/Descontos aplicados: R\$ 10,00 \(10%\)/i)).toBeDefined();
  });

  it('disables confirm button and shows warning when cash payment is less than totalFinal', () => {
    render(
      <CheckoutModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        buyerName="João Silva"
        cpf=""
        paymentMethod="Dinheiro"
        installments={1}
        cartItems={mockCartItems}
        subtotal={100}
        totalFinal={100}
        discountSummary=""
        amountPaid="50"
        setAmountPaid={vi.fn()}
      />
    );

    expect(screen.getByText(/O valor recebido deve ser igual ou superior ao total/i)).toBeDefined();

    const confirmBtn = screen.getByRole('button', { name: /Confirmar & Imprimir/i }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
  });

  it('enables confirm button and shows change when cash payment is sufficient', () => {
    const handleConfirm = vi.fn();

    render(
      <CheckoutModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={handleConfirm}
        buyerName="João Silva"
        cpf=""
        paymentMethod="Dinheiro"
        installments={1}
        cartItems={mockCartItems}
        subtotal={100}
        totalFinal={100}
        discountSummary=""
        amountPaid="120"
        setAmountPaid={vi.fn()}
      />
    );

    expect(screen.getByText(/Troco a devolver:/i)).toBeDefined();
    expect(screen.getByText(/R\$ 20,00/i)).toBeDefined();

    const confirmBtn = screen.getByRole('button', { name: /Confirmar & Imprimir/i }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(false);

    fireEvent.click(confirmBtn);
    expect(handleConfirm).toHaveBeenCalledTimes(1);
  });
});
