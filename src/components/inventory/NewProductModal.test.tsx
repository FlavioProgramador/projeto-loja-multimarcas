import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <NewProductModal isOpen={false} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('displays inline validation error when required fields are missing', async () => {
    render(<NewProductModal isOpen={true} onClose={vi.fn()} />);

    const saveButton = screen.getByRole('button', { name: /Salvar Produto/i });
    fireEvent.click(saveButton);

    const errorMessage = await screen.findByRole('alert');
    expect(errorMessage.textContent).toContain(
      'Preencha todos os campos obrigatórios com valores válidos.'
    );
    expect(mockAddProduct).not.toHaveBeenCalled();
  });

  it('displays inline error when trying to remove the last remaining SKU variation', async () => {
    render(<NewProductModal isOpen={true} onClose={vi.fn()} />);

    const removeButton = screen.getByTitle('Remover variação');
    fireEvent.click(removeButton);

    const errorMessage = await screen.findByRole('alert');
    expect(errorMessage.textContent).toContain('Mantenha pelo menos uma variação cadastrada.');
  });

  it('successfully submits valid product data and triggers onSuccess', async () => {
    const handleClose = vi.fn();
    const handleSuccess = vi.fn();
    mockAddProduct.mockResolvedValueOnce(undefined);

    render(
      <NewProductModal
        isOpen={true}
        onClose={handleClose}
        onSuccess={handleSuccess}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/Ex: Camiseta Oversized Minimal/i), {
      target: { value: 'Camiseta Teste' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Ex: Cyclone, Nike, Oakley.../i), {
      target: { value: 'Marca Teste' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Ex: Camisas, Calçados.../i), {
      target: { value: 'Categoria Teste' },
    });
    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '99.90' },
    });

    const saveButton = screen.getByRole('button', { name: /Salvar Produto/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockAddProduct).toHaveBeenCalledWith({
        nome: 'Camiseta Teste',
        marca: 'Marca Teste',
        categoria: 'Categoria Teste',
        preco: 99.9,
        skus: [
          {
            tamanho: 'P',
            cor: 'Preto',
            qtd: 10,
          },
        ],
      });
    });

    expect(handleSuccess).toHaveBeenCalledWith('Produto cadastrado com sucesso.');
    expect(handleClose).toHaveBeenCalled();
  });
});
