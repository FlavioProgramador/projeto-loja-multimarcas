import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CheckoutModal } from './CheckoutModal';
import { CartItem } from '../../types';

describe('CheckoutModal', () => {
  const mockCartItems: CartItem[] = [
    {
      produtoId: 1,
      skuIndex: 0,
      nome: 'Camiseta Oversized',
      preco: 100,
      qtd: 1,
      tamanho: 'M',
      cor: 'Preta'
    }
  ];

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    buyerName: 'João Silva',
    cpf: '12345678901',
    paymentMethod: 'Dinheiro',
    installments: 1,
    cartItems: mockCartItems,
    subtotal: 100,
    totalFinal: 100,
    discountSummary: '',
    creditUsed: 0,
    amountPaid: '50',
    setAmountPaid: vi.fn()
  };

  it('renders customer info and total final correctly', () => {
    render(<CheckoutModal {...defaultProps} />);

    expect(screen.getByText('Confirmar Venda')).toBeTruthy();
    expect(screen.getByText('João Silva')).toBeTruthy();
    expect(screen.getByText('Camiseta Oversized')).toBeTruthy();
  });

  it('disables confirmation button when cash paid is less than total', () => {
    render(<CheckoutModal {...defaultProps} amountPaid="50" />);

    const confirmButton = screen.getByRole('button', { name: /Confirmar & Imprimir/i });
    expect(confirmButton.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Falta:')).toBeTruthy();
  });

  it('enables confirmation button when cash paid is sufficient', () => {
    render(<CheckoutModal {...defaultProps} amountPaid="120" />);

    const confirmButton = screen.getByRole('button', { name: /Confirmar & Imprimir/i });
    expect(confirmButton.hasAttribute('disabled')).toBe(false);
    expect(screen.getByText('Troco a devolver:')).toBeTruthy();
  });

  it('calls setAmountPaid when quick cash preset buttons are clicked', () => {
    const setAmountPaidMock = vi.fn();
    render(<CheckoutModal {...defaultProps} setAmountPaid={setAmountPaidMock} />);

    const exatoButton = screen.getByRole('button', { name: /Exato/i });
    fireEvent.click(exatoButton);
    expect(setAmountPaidMock).toHaveBeenCalledWith('100.00');

    const note100Button = screen.getByRole('button', { name: 'R$ 100' });
    fireEvent.click(note100Button);
    expect(setAmountPaidMock).toHaveBeenCalledWith('100');
  });
});
