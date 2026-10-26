import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { StockEntryModal } from './StockEntryModal';

const mockRegisterStockEntry = vi.fn();

const mockProducts = [
  {
    id: 1,
    nome: 'Camiseta Basica',
    marca: 'Nike',
    categoria: 'Camisas',
    preco: 100,
    skus: [
      { id: 101, tamanho: 'M', cor: 'Preto', qtd: 5 },
    ],
  },
];

vi.mock('../../contexts/StoreContext', () => ({
  useStore: () => ({
    products: mockProducts,
    registerStockEntry: mockRegisterStockEntry,
  }),
}));

describe('StockEntryModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders modal when open', () => {
    render(<StockEntryModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Registrar Entrada de Estoque')).toBeInTheDocument();
  });

  it('shows inline error message with role="alert" when product name is empty', async () => {
    render(<StockEntryModal isOpen={true} onClose={vi.fn()} />);

    const registerButton = screen.getByRole('button', { name: 'Registrar Entrada' });
    fireEvent.click(registerButton);

    const alertElement = await screen.findByRole('alert');
    expect(alertElement).toBeInTheDocument();
    expect(alertElement).toHaveTextContent('Informe o nome do produto.');
    expect(mockRegisterStockEntry).not.toHaveBeenCalled();
  });

  it('registers stock entry for existing product successfully', async () => {
    const handleClose = vi.fn();
    render(<StockEntryModal isOpen={true} onClose={handleClose} />);

    fireEvent.change(screen.getByPlaceholderText('Digite ou selecione o produto...'), {
      target: { value: 'Camiseta Basica' },
    });
    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '50.00' },
    });

    const registerButton = screen.getByRole('button', { name: 'Registrar Entrada' });
    fireEvent.click(registerButton);

    await waitFor(() => {
      expect(mockRegisterStockEntry).toHaveBeenCalledWith({
        productName: 'Camiseta Basica',
        skuIndex: 0,
        qtd: 1,
        custoUnitario: 50,
        newSize: undefined,
        newColor: undefined,
      });
    });
    expect(handleClose).toHaveBeenCalled();
  });
});
