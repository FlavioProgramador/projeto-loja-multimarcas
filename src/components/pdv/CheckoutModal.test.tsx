import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CheckoutModal } from './CheckoutModal';
import { CartItem } from '../../types';

describe('CheckoutModal', () => {
  const defaultCartItems: CartItem[] = [
    {
      produtoId: 1,
      skuIndex: 0,
      nome: 'Camiseta Basica',
      tamanho: 'M',
      cor: 'Preta',
      preco: 100,
      qtd: 2,
      maxStock: 10
    }
  ];

  it('renders customer info, cart items, total and payment info correctly', () => {
    render(
      <CheckoutModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        buyerName="João Silva"
        cpf="12345678901"
        paymentMethod="Dinheiro"
        installments={1}
        cartItems={defaultCartItems}
        subtotal={200}
        totalFinal={200}
        discountSummary=""
        amountPaid=""
        setAmountPaid={vi.fn()}
      />
    );

    expect(screen.getByText('Confirmar Venda')).toBeTruthy();
    expect(screen.getByText('João Silva')).toBeTruthy();
    expect(screen.getByText('Camiseta Basica')).toBeTruthy();
    expect(screen.getByText('Valor Recebido (R$):')).toBeTruthy();
  });

  it('triggers setAmountPaid when clicking quick cash buttons', () => {
    const setAmountPaidMock = vi.fn();

    render(
      <CheckoutModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        buyerName="Maria Souza"
        cpf=""
        paymentMethod="Dinheiro"
        installments={1}
        cartItems={defaultCartItems}
        subtotal={200}
        totalFinal={200}
        discountSummary=""
        amountPaid=""
        setAmountPaid={setAmountPaidMock}
      />
    );

    const exactBtn = screen.getByRole('button', { name: /Exato/i });
    fireEvent.click(exactBtn);
    expect(setAmountPaidMock).toHaveBeenCalledWith('200.00');

    const FiftyBtn = screen.getByRole('button', { name: 'R$ 50' });
    fireEvent.click(FiftyBtn);
    expect(setAmountPaidMock).toHaveBeenCalledWith('50.00');
  });

  it('calculates and displays change correctly when amount paid exceeds total', () => {
    render(
      <CheckoutModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        buyerName="Maria Souza"
        cpf=""
        paymentMethod="Dinheiro"
        installments={1}
        cartItems={defaultCartItems}
        subtotal={200}
        totalFinal={150}
        discountSummary=""
        amountPaid="200"
        setAmountPaid={vi.fn()}
      />
    );

    expect(screen.getByText('Troco a devolver:')).toBeTruthy();
  });

  it('calls onConfirm when clicking confirm button', () => {
    const onConfirmMock = vi.fn();

    render(
      <CheckoutModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={onConfirmMock}
        buyerName="João Silva"
        cpf=""
        paymentMethod="Dinheiro"
        installments={1}
        cartItems={defaultCartItems}
        subtotal={200}
        totalFinal={200}
        discountSummary=""
        amountPaid="200"
        setAmountPaid={vi.fn()}
      />
    );

    const confirmBtn = screen.getByRole('button', { name: /Confirmar & Imprimir/i });
    fireEvent.click(confirmBtn);
    expect(onConfirmMock).toHaveBeenCalledTimes(1);
  });
});
