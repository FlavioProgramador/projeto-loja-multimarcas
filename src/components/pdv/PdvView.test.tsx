import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PdvView } from './PdvView';

const mockProcessSale = vi.fn();
const mockAddItem = vi.fn();
const mockClearCart = vi.fn();
let mockCart: any[] = [];
let mockSubtotal = 0;

vi.mock('../../lib/supabase/client', () => ({
  supabase: {
    channel: () => ({
      on: () => ({
        subscribe: () => ({})
      })
    }),
    removeChannel: () => ({})
  },
  isSupabaseConfigured: false
}));

vi.mock('../returns/NewReturnModal', () => ({
  NewReturnModal: () => null
}));

vi.mock('../customers/NewCustomerModal', () => ({
  NewCustomerModal: () => null
}));

vi.mock('./ReceiptPrinter', () => ({
  ReceiptPrinter: () => null
}));

vi.mock('../../contexts/StoreContext', () => ({
  useStore: () => ({
    products: [
      {
        id: 1,
        uuid: 'prod-1',
        nome: 'Camiseta Basica',
        marca: 'Marca X',
        categoria: 'Roupas',
        preco: 50,
        skus: [{ tamanho: 'M', cor: 'Preta', qtd: 10 }]
      }
    ],
    customers: [],
    processSale: mockProcessSale,
    activeStoreId: 'store-1'
  })
}));

vi.mock('../../contexts/CartContext', () => ({
  useCart: () => ({
    cart: mockCart,
    addItem: mockAddItem,
    updateQuantity: vi.fn(),
    removeItem: vi.fn(),
    clearCart: mockClearCart,
    subtotal: mockSubtotal
  })
}));

describe('PdvView - Usabilidade e Validações', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.print = vi.fn();
    mockCart = [
      {
        id: 1,
        nome: 'Camiseta Basica',
        tamanho: 'M',
        cor: 'Preta',
        preco: 50,
        qtd: 2,
        maxStock: 10
      }
    ];
    mockSubtotal = 100;
  });

  it('deve fechar o modal "Limpar Carrinho" ao pressionar a tecla Escape', async () => {
    render(<PdvView />);

    // Clica no botão "Limpar" para abrir o modal
    const clearButton = screen.getByRole('button', { name: /Limpar/i });
    fireEvent.click(clearButton);

    // O modal deve estar visível
    expect(screen.getByText('Deseja remover todos os itens do carrinho? Esta ação não pode ser desfeita.')).toBeTruthy();

    // Dispara tecla Escape
    fireEvent.keyDown(window, { key: 'Escape' });

    // O modal deve fechar
    await waitFor(() => {
      expect(screen.queryByText('Deseja remover todos os itens do carrinho? Esta ação não pode ser desfeita.')).toBeNull();
    });
  });

  it('deve exibir aviso quando o valor em dinheiro informado for menor que o total da venda', async () => {
    mockProcessSale.mockResolvedValue({ success: true, totalFinal: 100 });
    render(<PdvView />);

    // Seleciona método Dinheiro
    const paymentSelect = screen.getByDisplayValue('PIX');
    fireEvent.change(paymentSelect, { target: { value: 'Dinheiro' } });

    // Abre modal de checkout
    const finishButton = screen.getByRole('button', { name: /Finalizar Venda/i });
    fireEvent.click(finishButton);

    // No modal de checkout com Dinheiro
    const amountPaidInput = screen.getByLabelText(/Valor recebido em dinheiro/i);
    fireEvent.change(amountPaidInput, { target: { value: '50' } });

    // Clica em Confirmar & Imprimir
    const confirmButton = screen.getByRole('button', { name: /Confirmar & Imprimir/i });
    fireEvent.click(confirmButton);

    // Deve exibir aviso e NÃO chamar processSale
    expect(screen.getByText(/O valor pago em dinheiro é inferior ao total da venda/i)).toBeTruthy();
    expect(mockProcessSale).not.toHaveBeenCalled();
  });
});
