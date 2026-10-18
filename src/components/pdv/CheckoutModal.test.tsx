import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CheckoutModal } from './CheckoutModal';
import type { CartItem } from '../../types';

describe('CheckoutModal - Cash Payment Validation and Presets', () => {
  const mockCartItems: CartItem[] = [
    {
      produtoId: 1,
      skuIndex: 0,
      nome: 'Camiseta Basica',
      tamanho: 'M',
      cor: 'Preto',
      preco: 50,
      qtd: 2,
    },
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
    setAmountPaid: vi.fn(),
  };

  it('disables confirm button and shows missing balance when cash paid is less than total final', () => {
    render(<CheckoutModal {...defaultProps} amountPaid="50" />);

    expect(screen.getByText(/Falta:/i)).toBeDefined();

    const confirmButton = screen.getByRole('button', { name: /Confirmar & Imprimir/i }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
  });

  it('enables confirm button when cash paid is equal to or greater than total final', () => {
    render(<CheckoutModal {...defaultProps} amountPaid="100" />);

    expect(screen.getByText(/Troco a devolver:/i)).toBeDefined();

    const confirmButton = screen.getByRole('button', { name: /Confirmar & Imprimir/i }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(false);
  });

  it('triggers setAmountPaid when clicking quick preset buttons', () => {
    const setAmountPaidMock = vi.fn();
    render(<CheckoutModal {...defaultProps} amountPaid="0" setAmountPaid={setAmountPaidMock} />);

    const exactButton = screen.getByRole('button', { name: /Exato/i });
    fireEvent.click(exactButton);
    expect(setAmountPaidMock).toHaveBeenCalledWith('100');

    const preset200Button = screen.getByRole('button', { name: /R\$ 200/i });
    fireEvent.click(preset200Button);
    expect(setAmountPaidMock).toHaveBeenCalledWith('200');
  });

  it('enables confirm button for non-cash payment methods regardless of amountPaid input', () => {
    render(<CheckoutModal {...defaultProps} paymentMethod="PIX" amountPaid="" />);

    const confirmButton = screen.getByRole('button', { name: /Gerar PIX/i }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(false);
  });
});
