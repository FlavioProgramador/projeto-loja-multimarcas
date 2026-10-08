import React from 'react';
import { render, screen } from '@testing-library/react';
import { CheckoutModal } from './CheckoutModal';
import { CartItem } from '../../types';

describe('CheckoutModal', () => {
  const mockCartItems: CartItem[] = [
    {
      produtoId: 1,
      skuIndex: 0,
      nome: 'Camiseta Basica',
      tamanho: 'M',
      cor: 'Preto',
      preco: 100,
      qtd: 1,
    },
  ];

  it('exibe o sumario de descontos quando fornecido', () => {
    render(
      <CheckoutModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        buyerName="João Silva"
        cpf="123.456.789-00"
        paymentMethod="Cartão"
        installments={1}
        cartItems={mockCartItems}
        subtotal={100}
        totalFinal={90}
        discountSummary="10% (R$ 10,00)"
        amountPaid=""
        setAmountPaid={vi.fn()}
      />
    );

    expect(screen.getByText('Descontos aplicados: 10% (R$ 10,00)')).toBeTruthy();
  });

  it('calcula e exibe o troco corretamente em pagamentos em dinheiro', () => {
    render(
      <CheckoutModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        buyerName="Maria Souza"
        cpf=""
        paymentMethod="Dinheiro"
        installments={1}
        cartItems={mockCartItems}
        subtotal={100}
        totalFinal={100}
        discountSummary=""
        amountPaid="150"
        setAmountPaid={vi.fn()}
      />
    );

    expect(screen.getByText('Troco a devolver:')).toBeTruthy();
    expect(screen.getByText('R$ 50,00')).toBeTruthy();
  });

  it('exibe mensagem de valor restante quando pago a menor em dinheiro', () => {
    render(
      <CheckoutModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        buyerName="Maria Souza"
        cpf=""
        paymentMethod="Dinheiro"
        installments={1}
        cartItems={mockCartItems}
        subtotal={100}
        totalFinal={100}
        discountSummary=""
        amountPaid="80"
        setAmountPaid={vi.fn()}
      />
    );

    expect(screen.getByText('Falta:')).toBeTruthy();
    expect(screen.getByText('R$ 20,00')).toBeTruthy();
  });
});
