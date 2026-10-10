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
      nome: 'Camiseta Minimalista',
      preco: 100,
      tamanho: 'M',
      cor: 'Preta',
      qtd: 2,
    },
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
    subtotal: 200,
    totalFinal: 180,
    discountSummary: 'R$ 20,00',
    creditUsed: 0,
    amountPaid: '200',
    setAmountPaid: vi.fn(),
  };

  it('renderiza os dados do cliente, itens do carrinho e o resumo dos descontos aplicados', () => {
    render(<CheckoutModal {...defaultProps} />);

    expect(screen.getByText('Confirmar Venda')).toBeTruthy();
    expect(screen.getByText('João Silva')).toBeTruthy();
    expect(screen.getByText('Camiseta Minimalista')).toBeTruthy();
    expect(screen.getByText(/Descontos aplicados: R\$ 20,00/)).toBeTruthy();
  });

  it('exibe o crédito do cliente aplicado quando creditUsed é maior que zero', () => {
    render(<CheckoutModal {...defaultProps} creditUsed={15} />);

    expect(screen.getByText(/Crédito do Cliente Aplicado:/)).toBeTruthy();
  });

  it('calcula o troco corretamente no pagamento em Dinheiro', () => {
    render(<CheckoutModal {...defaultProps} totalFinal={180} amountPaid="200" />);

    expect(screen.getByText('Troco a devolver:')).toBeTruthy();
  });

  it('chama onConfirm e onClose nos cliques dos respectivos botões', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(<CheckoutModal {...defaultProps} onConfirm={onConfirm} onClose={onClose} />);

    const confirmButton = screen.getByRole('button', { name: /Confirmar & Imprimir/i });
    fireEvent.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledTimes(1);

    const cancelButton = screen.getByRole('button', { name: /Voltar/i });
    fireEvent.click(cancelButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
