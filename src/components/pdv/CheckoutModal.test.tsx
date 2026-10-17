import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CheckoutModal } from './CheckoutModal';
import { CartItem } from '../../types';

const mockCartItems: CartItem[] = [
  {
    produtoId: 1,
    skuIndex: 0,
    nome: 'Camiseta Basica',
    tamanho: 'M',
    cor: 'Preta',
    preco: 50.0,
    qtd: 2,
    maxStock: 10
  }
];

describe('CheckoutModal - Cash Payment Validation and UX', () => {
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
    setAmountPaid: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('desabilita o botão de confirmação quando o pagamento for Dinheiro e valor pago estiver vazio', () => {
    render(<CheckoutModal {...defaultProps} amountPaid="" />);

    const confirmButton = screen.getByRole('button', { name: /Confirmar & Imprimir/i }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
    expect(screen.getByText(/Clique em "Exato" ou digite o valor recebido/i)).toBeTruthy();
  });

  it('desabilita o botão de confirmação e exibe aviso de falta quando o valor pago for insuficiente', () => {
    render(<CheckoutModal {...defaultProps} amountPaid="80.00" />);

    const confirmButton = screen.getByRole('button', { name: /Confirmar & Imprimir/i }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
    expect(screen.getByText('Falta:')).toBeTruthy();
    expect(screen.getByText('R$ 20,00')).toBeTruthy();
  });

  it('habilita o botão de confirmação e calcula o troco quando o valor pago for suficiente', () => {
    render(<CheckoutModal {...defaultProps} amountPaid="150.00" />);

    const confirmButton = screen.getByRole('button', { name: /Confirmar & Imprimir/i }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(false);
    expect(screen.getByText('Troco a devolver:')).toBeTruthy();
    expect(screen.getByText('R$ 50,00')).toBeTruthy();
  });

  it('aciona setAmountPaid com o valor exato ao clicar no botão Exato', () => {
    const setAmountPaidMock = vi.fn();
    render(<CheckoutModal {...defaultProps} amountPaid="" setAmountPaid={setAmountPaidMock} totalFinal={125.50} />);

    const exactButton = screen.getByRole('button', { name: /Exato/i });
    fireEvent.click(exactButton);

    expect(setAmountPaidMock).toHaveBeenCalledWith('125.50');
  });

  it('permite a confirmação direta para formas de pagamento que não utilizam dinheiro (ex: Cartão)', () => {
    render(<CheckoutModal {...defaultProps} paymentMethod="Cartão" amountPaid="" />);

    const confirmButton = screen.getByRole('button', { name: /Confirmar & Imprimir/i }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(false);
  });
});
