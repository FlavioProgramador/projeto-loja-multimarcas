import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
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

  it('não renderiza conteúdo quando isOpen é falso', () => {
    render(<NewProductModal isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByText('Cadastrar Novo Produto')).not.toBeInTheDocument();
  });

  it('exibe erro de validação inline ao tentar salvar com campos obrigatórios vazios', async () => {
    render(<NewProductModal isOpen={true} onClose={vi.fn()} />);

    const saveButton = screen.getByRole('button', { name: 'Salvar Produto' });
    fireEvent.click(saveButton);

    const errorMessage = await screen.findByRole('alert');
    expect(errorMessage).toHaveTextContent(
      'Preencha todos os campos obrigatórios e informe um preço de venda válido.'
    );
    expect(mockAddProduct).not.toHaveBeenCalled();
  });

  it('cadastra produto com sucesso chamando addProduct e onSuccess', async () => {
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

    fireEvent.change(screen.getByPlaceholderText('Ex: Camiseta Oversized Minimal'), {
      target: { value: 'Camiseta Tech Dry' },
    });
    fireEvent.change(screen.getByPlaceholderText('Ex: Cyclone, Nike, Oakley...'), {
      target: { value: 'Nike' },
    });
    fireEvent.change(screen.getByPlaceholderText('Ex: Camisas, Calçados...'), {
      target: { value: 'Vestuário' },
    });
    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '149.90' },
    });

    const saveButton = screen.getByRole('button', { name: 'Salvar Produto' });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockAddProduct).toHaveBeenCalledWith({
        nome: 'Camiseta Tech Dry',
        marca: 'Nike',
        categoria: 'Vestuário',
        preco: 149.9,
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
    expect(handleClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('exibe mensagem de erro da API quando addProduct falha e permite tentar novamente', async () => {
    mockAddProduct.mockRejectedValueOnce(new Error('Falha de conexão com o servidor'));

    render(<NewProductModal isOpen={true} onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('Ex: Camiseta Oversized Minimal'), {
      target: { value: 'Camiseta Tech Dry' },
    });
    fireEvent.change(screen.getByPlaceholderText('Ex: Cyclone, Nike, Oakley...'), {
      target: { value: 'Nike' },
    });
    fireEvent.change(screen.getByPlaceholderText('Ex: Camisas, Calçados...'), {
      target: { value: 'Vestuário' },
    });
    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '149.90' },
    });

    const saveButton = screen.getByRole('button', { name: 'Salvar Produto' });
    fireEvent.click(saveButton);

    const errorMessage = await screen.findByRole('alert');
    expect(errorMessage).toHaveTextContent('Falha de conexão com o servidor');
    expect(screen.getByRole('button', { name: 'Salvar Produto' })).not.toBeDisabled();
  });

  it('não permite remover a última variação cadastrada', async () => {
    render(<NewProductModal isOpen={true} onClose={vi.fn()} />);

    const removeSkuButton = screen.getByTitle('Remover variação');
    fireEvent.click(removeSkuButton);

    const errorMessage = await screen.findByRole('alert');
    expect(errorMessage).toHaveTextContent('Mantenha pelo menos uma variação cadastrada.');
    expect(mockAddProduct).not.toHaveBeenCalled();
  });
});
