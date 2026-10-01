import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CheckoutModal } from './CheckoutModal';
import { CartItem } from '../../types';

describe('CheckoutModal', () => {
  const mockCartItems: CartItem[] = [
    {
      produtoId: 1,
      skuIndex: 0,
      nome: 'Camisa Polo Classic',
      tamanho: 'M',
      cor: 'Azul',
      preco: 100.0,
      qtd: 1,
      maxStock: 5
    }
  ];

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    buyerName: 'João Silva',
    cpf: '123.456.789-00',
    paymentMethod: 'Dinheiro',
    installments: 1,
    cartItems: mockCartItems,
    subtotal: 100.0,
    totalFinal: 100.0,
    discountSummary: '',
    creditUsed: 0,
    amountPaid: '',
    setAmountPaid: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders modal header, customer info and total amount', () => {
    render(<CheckoutModal {...defaultProps} />);

    expect(screen.getByText('Confirmar Venda')).toBeTruthy();
    expect(screen.getByText('João Silva')).toBeTruthy();
    expect(screen.getByText('Camisa Polo Classic')).toBeTruthy();
    expect(screen.getByText('Total Final:')).toBeTruthy();
  });

  it('auto-fills exact cash amount when opening in cash mode with empty amount', () => {
    const setAmountPaidMock = vi.fn();
    render(<CheckoutModal {...defaultProps} setAmountPaid={setAmountPaidMock} />);

    expect(setAmountPaidMock).toHaveBeenCalledWith('100.00');
  });

  it('applies quick preset when preset button is clicked', () => {
    const setAmountPaidMock = vi.fn();
    render(<CheckoutModal {...defaultProps} amountPaid="100.00" setAmountPaid={setAmountPaidMock} />);

    const presetBtn = screen.getByText('R$ 200');
    fireEvent.click(presetBtn);

    expect(setAmountPaidMock).toHaveBeenCalledWith('200.00');
  });

  it('displays error and blocks confirm when cash paid is insufficient', () => {
    const onConfirmMock = vi.fn();
    render(
      <CheckoutModal
        {...defaultProps}
        amountPaid="50.00"
        onConfirm={onConfirmMock}
      />
    );

    const confirmBtn = screen.getByText('Confirmar & Imprimir');
    fireEvent.click(confirmBtn);

    expect(onConfirmMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Valor recebido insuficiente/i)).toBeTruthy();
    expect(screen.getByText(/Falta R\$\s*50,00/i)).toBeTruthy();
  });

  it('calls onConfirm when cash paid is sufficient', () => {
    const onConfirmMock = vi.fn();
    render(
      <CheckoutModal
        {...defaultProps}
        amountPaid="120.00"
        onConfirm={onConfirmMock}
      />
    );

    const confirmBtn = screen.getByText('Confirmar & Imprimir');
    fireEvent.click(confirmBtn);

    expect(onConfirmMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Troco a devolver:')).toBeTruthy();
  });
});
