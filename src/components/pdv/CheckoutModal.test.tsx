import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CheckoutModal } from './CheckoutModal';
import type { CartItem } from '../../types';

describe('CheckoutModal', () => {
  const mockCartItems: CartItem[] = [
    {
      produtoId: 1,
      skuIndex: 0,
      nome: 'Camiseta Básica',
      tamanho: 'M',
      cor: 'Preto',
      preco: 50.00,
      qtd: 1
    }
  ];

  it('exibe botões de atalho rápido e calcula troco para pagamento em dinheiro', () => {
    const setAmountPaidMock = vi.fn();

    render(
      <CheckoutModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        buyerName="João Silva"
        cpf="12345678900"
        paymentMethod="Dinheiro"
        installments={1}
        cartItems={mockCartItems}
        subtotal={50.00}
        totalFinal={45.00}
        discountSummary="R$ 5,00"
        creditUsed={0}
        amountPaid="50"
        setAmountPaid={setAmountPaidMock}
      />
    );

    // Verifica cliente
    expect(screen.getByText('João Silva')).toBeTruthy();

    // Verifica resumo do desconto
    expect(screen.getByText(/Descontos aplicados: R\$ 5,00/i)).toBeTruthy();

    // Verifica botão de atalho "Exato"
    const exactButton = screen.getByRole('button', { name: /Exato/i });
    expect(exactButton).toBeTruthy();
    fireEvent.click(exactButton);
    expect(setAmountPaidMock).toHaveBeenCalledWith('45.00');

    // Verifica botão de atalho R$ 50
    const fiftyButton = screen.getByRole('button', { name: /R\$ 50/i });
    expect(fiftyButton).toBeTruthy();
    fireEvent.click(fiftyButton);
    expect(setAmountPaidMock).toHaveBeenCalledWith('50');

    // Verifica exibição do troco calculando R$ 50 - R$ 45 = R$ 5,00
    expect(screen.getByText(/Troco a devolver:/i)).toBeTruthy();
    expect(screen.getByText('R$ 5,00')).toBeTruthy();
  });

  it('exibe o valor restante (falta) quando o valor pago for menor que o total final', () => {
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
        subtotal={50.00}
        totalFinal={50.00}
        discountSummary=""
        creditUsed={0}
        amountPaid="30"
        setAmountPaid={vi.fn()}
      />
    );

    expect(screen.getByText(/Falta:/i)).toBeTruthy();
    expect(screen.getByText('R$ 20,00')).toBeTruthy();
  });
});
