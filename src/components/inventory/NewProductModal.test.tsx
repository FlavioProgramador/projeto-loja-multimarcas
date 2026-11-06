import '@testing-library/jest-dom/vitest';
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

  it('não renderiza nada quando isOpen for falso', () => {
    render(<NewProductModal isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByText('Cadastrar Novo Produto')).not.toBeInTheDocument();
  });

  it('exibe erro de validação inline se campos obrigatórios não forem preenchidos', async () => {
    render(<NewProductModal isOpen={true} onClose={vi.fn()} />);

    const saveButton = screen.getByRole('button', { name: /salvar produto/i });
    fireEvent.click(saveButton);

    const errorMessage = await screen.findByRole('alert');
    expect(errorMessage).toBeInTheDocument();
    expect(errorMessage).toHaveTextContent(/preencha todos os campos obrigatórios e informe um preço válido/i);
    expect(mockAddProduct).not.toHaveBeenCalled();
  });

  it('impede remover a última variação exibindo mensagem de erro inline', async () => {
    render(<NewProductModal isOpen={true} onClose={vi.fn()} />);

    const removeButtons = screen.getAllByTitle('Remover variação');
    expect(removeButtons).toHaveLength(1);

    fireEvent.click(removeButtons[0]);

    const errorMessage = await screen.findByRole('alert');
    expect(errorMessage).toHaveTextContent(/mantenha pelo menos uma variação cadastrada/i);
  });

  it('chama addProduct e onSuccess com sucesso ao preencher o formulário corretamente', async () => {
    const handleClose = vi.fn();
    const handleSuccess = vi.fn();
    mockAddProduct.mockResolvedValueOnce(undefined);

    render(<NewProductModal isOpen={true} onClose={handleClose} onSuccess={handleSuccess} />);

    fireEvent.change(screen.getByPlaceholderText(/ex: camiseta oversized minimal/i), {
      target: { value: 'Camiseta Silk' },
    });
    fireEvent.change(screen.getByPlaceholderText(/ex: cyclone, nike, oakley/i), {
      target: { value: 'Nike' },
    });
    fireEvent.change(screen.getByPlaceholderText(/ex: camisas, calçados/i), {
      target: { value: 'Vestuário' },
    });
    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '99.90' },
    });

    const saveButton = screen.getByRole('button', { name: /salvar produto/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockAddProduct).toHaveBeenCalledWith({
        nome: 'Camiseta Silk',
        marca: 'Nike',
        categoria: 'Vestuário',
        preco: 99.90,
        skus: [
          { tamanho: 'P', cor: 'Preto', qtd: 10 }
        ]
      });
    });

    expect(handleSuccess).toHaveBeenCalledWith('Produto cadastrado com sucesso.');
    expect(handleClose).toHaveBeenCalled();
  });

  it('exibe mensagem de erro da API quando addProduct lança exceção', async () => {
    mockAddProduct.mockRejectedValueOnce(new Error('Erro no servidor ao salvar'));

    render(<NewProductModal isOpen={true} onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/ex: camiseta oversized minimal/i), {
      target: { value: 'Bermuda Sarja' },
    });
    fireEvent.change(screen.getByPlaceholderText(/ex: cyclone, nike, oakley/i), {
      target: { value: 'Cyclone' },
    });
    fireEvent.change(screen.getByPlaceholderText(/ex: camisas, calçados/i), {
      target: { value: 'Bermudas' },
    });
    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '150.00' },
    });

    const saveButton = screen.getByRole('button', { name: /salvar produto/i });
    fireEvent.click(saveButton);

    const errorMessage = await screen.findByRole('alert');
    expect(errorMessage).toHaveTextContent('Erro no servidor ao salvar');
  });
});
