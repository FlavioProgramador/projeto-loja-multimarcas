import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

  it('não renderiza nada quando isOpen é false', () => {
    render(<NewProductModal isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByText('Cadastrar Novo Produto')).toBeNull();
  });

  it('exibe erro inline (role="alert") quando campos obrigatórios estão vazios', async () => {
    render(<NewProductModal isOpen={true} onClose={vi.fn()} />);

    const saveButton = screen.getByRole('button', { name: 'Salvar Produto' });
    fireEvent.click(saveButton);

    const alert = await screen.findByRole('alert');
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain('Por favor, preencha todos os campos obrigatórios com valores válidos.');
    expect(mockAddProduct).not.toHaveBeenCalled();
  });

  it('exibe erro inline (role="alert") ao tentar remover a única variação cadastrada', async () => {
    render(<NewProductModal isOpen={true} onClose={vi.fn()} />);

    const removeSkuButton = screen.getByTitle('Remover variação');
    fireEvent.click(removeSkuButton);

    const alert = await screen.findByRole('alert');
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain('Mantenha pelo menos uma variação cadastrada.');
  });

  it('cadastra produto com sucesso chamando addProduct e onSuccess', async () => {
    const handleClose = vi.fn();
    const handleSuccess = vi.fn();
    mockAddProduct.mockResolvedValueOnce(undefined);

    render(<NewProductModal isOpen={true} onClose={handleClose} onSuccess={handleSuccess} />);

    fireEvent.change(screen.getByPlaceholderText('Ex: Camiseta Oversized Minimal'), {
      target: { value: 'Camiseta Teste' },
    });
    fireEvent.change(screen.getByPlaceholderText('Ex: Cyclone, Nike, Oakley...'), {
      target: { value: 'Nike' },
    });
    fireEvent.change(screen.getByPlaceholderText('Ex: Camisas, Calçados...'), {
      target: { value: 'Camisas' },
    });
    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '99.90' },
    });

    const saveButton = screen.getByRole('button', { name: 'Salvar Produto' });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockAddProduct).toHaveBeenCalledWith({
        nome: 'Camiseta Teste',
        marca: 'Nike',
        categoria: 'Camisas',
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

    expect(handleSuccess).toHaveBeenCalledWith('Produto cadastrado com sucesso!');
    expect(handleClose).toHaveBeenCalled();
  });
});
