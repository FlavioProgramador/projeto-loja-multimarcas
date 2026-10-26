import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { NewProductModal } from './NewProductModal';

const mockAddProduct = vi.fn();

vi.mock('../../contexts/StoreContext', () => ({
  useStore: () => ({
    addProduct: mockAddProduct,
  }),
}));

describe('NewProductModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders modal when open', () => {
    render(<NewProductModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Cadastrar Novo Produto')).toBeInTheDocument();
  });

  it('shows inline error message with role="alert" when required fields are missing', () => {
    render(<NewProductModal isOpen={true} onClose={vi.fn()} />);

    const saveButton = screen.getByRole('button', { name: 'Salvar Produto' });
    fireEvent.click(saveButton);

    const alertElement = screen.getByRole('alert');
    expect(alertElement).toBeInTheDocument();
    expect(alertElement).toHaveTextContent('Preencha todos os campos obrigatórios e informe um preço válido.');
    expect(mockAddProduct).not.toHaveBeenCalled();
  });

  it('submits product successfully when form is valid', () => {
    const handleClose = vi.fn();
    render(<NewProductModal isOpen={true} onClose={handleClose} />);

    fireEvent.change(screen.getByPlaceholderText('Ex: Camiseta Oversized Minimal'), {
      target: { value: 'Camiseta Teste' },
    });
    fireEvent.change(screen.getByPlaceholderText('Ex: Cyclone, Nike, Oakley...'), {
      target: { value: 'Marca X' },
    });
    fireEvent.change(screen.getByPlaceholderText('Ex: Camisas, Calçados...'), {
      target: { value: 'Vestuário' },
    });
    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '99.90' },
    });

    const saveButton = screen.getByRole('button', { name: 'Salvar Produto' });
    fireEvent.click(saveButton);

    expect(mockAddProduct).toHaveBeenCalledWith({
      nome: 'Camiseta Teste',
      marca: 'Marca X',
      categoria: 'Vestuário',
      preco: 99.9,
      skus: [
        {
          tamanho: 'P',
          cor: 'Preto',
          qtd: 10,
        },
      ],
    });
    expect(handleClose).toHaveBeenCalled();
  });
});
