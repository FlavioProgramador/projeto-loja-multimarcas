import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { CheckoutModal } from './CheckoutModal';
import { CartItem } from '../../types';

describe('CheckoutModal', () => {
  const mockCartItems: CartItem[] = [
    {
      produtoId: 1,
      skuIndex: 0,
      nome: 'Camiseta Oversized',
      tamanho: 'G',
      cor: 'Preta',
      preco: 100,
      qtd: 1,
      variantId: 'SKU-001'
    }
  ];

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    buyerName: 'João Silva',
    cpf: '12345678900',
    paymentMethod: 'Dinheiro',
    installments: 1,
    cartItems: mockCartItems,
    subtotal: 100,
    totalFinal: 100,
    discountSummary: '',
    creditUsed: 0,
    amountPaid: '100.00',
    setAmountPaid: vi.fn()
  };

  it('renderiza os detalhes do cliente, total final e itens do carrinho', () => {
    render(<CheckoutModal {...defaultProps} />);

    expect(screen.getByText('Confirmar Venda')).toBeTruthy();
    expect(screen.getByText('João Silva')).toBeTruthy();
    expect(screen.getByText('Camiseta Oversized')).toBeTruthy();
    expect(screen.getAllByText('R$ 100,00').length).toBeGreaterThan(0);
  });

  it('desabilita o botão de confirmação e exibe aviso quando valor em dinheiro é insuficiente', () => {
    render(<CheckoutModal {...defaultProps} paymentMethod="Dinheiro" amountPaid="50.00" totalFinal={100} />);

    const confirmButton = screen.getByRole('button', { name: /Confirmar & Imprimir/i }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
    expect(screen.getByText(/O valor recebido deve ser igual ou superior ao total final/i)).toBeTruthy();
    expect(screen.getByText(/Falta:/i)).toBeTruthy();
  });

  it('habilita o botão de confirmação e exibe troco quando valor em dinheiro é suficiente', () => {
    const onConfirm = vi.fn();
    render(<CheckoutModal {...defaultProps} paymentMethod="Dinheiro" amountPaid="120.00" totalFinal={100} onConfirm={onConfirm} />);

    const confirmButton = screen.getByRole('button', { name: /Confirmar & Imprimir/i }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(false);
    expect(screen.getByText('Troco a devolver:')).toBeTruthy();
    expect(screen.getByText('R$ 20,00')).toBeTruthy();

    fireEvent.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('exibe o resumo de desconto quando fornecido', () => {
    render(<CheckoutModal {...defaultProps} discountSummary="R$ 10,00 + 10%" />);

    expect(screen.getByText('Descontos aplicados: R$ 10,00 + 10%')).toBeTruthy();
  });
});
