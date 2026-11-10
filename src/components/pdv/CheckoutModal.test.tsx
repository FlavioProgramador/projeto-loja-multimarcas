import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { CheckoutModal } from './CheckoutModal';
import { CartItem } from '../../types';

describe('CheckoutModal', () => {
  const mockCartItems: CartItem[] = [
    {
      produtoId: 1,
      variantId: 'var-1',
      skuIndex: 0,
      nome: 'Camisa Polo Básica',
      tamanho: 'M',
      cor: 'Azul',
      preco: 100,
      qtd: 2
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
    subtotal: 200,
    totalFinal: 180,
    discountSummary: 'R$ 20,00',
    creditUsed: 0,
    amountPaid: '200',
    setAmountPaid: vi.fn(),
    qrCodeBase64: null,
    isGeneratingPix: false,
    isProcessing: false
  };

  it('renders modal with customer info, cart items, discounts, and totals', () => {
    render(<CheckoutModal {...defaultProps} />);

    expect(screen.getByText('Confirmar Venda')).toBeInTheDocument();
    expect(screen.getByText('João Silva')).toBeInTheDocument();
    expect(screen.getByText('Camisa Polo Básica')).toBeInTheDocument();
    expect(screen.getByText('Descontos aplicados: R$ 20,00')).toBeInTheDocument();
    expect(screen.getByText('Troco a devolver:')).toBeInTheDocument();
    expect(screen.getByText('Confirmar & Imprimir')).toBeInTheDocument();
  });

  it('disables confirm button and shows "Processando..." when isProcessing is true', () => {
    const onConfirmMock = vi.fn();
    render(
      <CheckoutModal
        {...defaultProps}
        onConfirm={onConfirmMock}
        isProcessing={true}
      />
    );

    const confirmButton = screen.getByRole('button', { name: /Processando\.\.\./i });
    expect(confirmButton).toBeDisabled();

    fireEvent.click(confirmButton);
    expect(onConfirmMock).not.toHaveBeenCalled();
  });

  it('disables cancel/close button when isProcessing is true', () => {
    const onCloseMock = vi.fn();
    render(
      <CheckoutModal
        {...defaultProps}
        onClose={onCloseMock}
        isProcessing={true}
      />
    );

    const closeButton = screen.getByRole('button', { name: /Voltar/i });
    expect(closeButton).toBeDisabled();

    fireEvent.click(closeButton);
    expect(onCloseMock).not.toHaveBeenCalled();
  });

  it('calls onConfirm when confirm button is clicked in normal state', () => {
    const onConfirmMock = vi.fn();
    render(
      <CheckoutModal
        {...defaultProps}
        onConfirm={onConfirmMock}
        isProcessing={false}
      />
    );

    const confirmButton = screen.getByRole('button', { name: /Confirmar & Imprimir/i });
    expect(confirmButton).not.toBeDisabled();

    fireEvent.click(confirmButton);
    expect(onConfirmMock).toHaveBeenCalledTimes(1);
  });
});
