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

  it('não renderiza conteúdo quando isOpen for falso', () => {
    render(<NewProductModal isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByText('Cadastrar Novo Produto')).not.toBeInTheDocument();
  });

  it('exibe erro de validação em linha se campos obrigatórios estiverem vazios', async () => {
    render(<NewProductModal isOpen={true} onClose={vi.fn()} />);

    const saveButton = screen.getByRole('button', { name: /Salvar Produto/i });
    fireEvent.click(saveButton);

    const alertMessage = await screen.findByRole('alert');
    expect(alertMessage).toHaveTextContent('Por favor, preencha todos os campos obrigatórios e informe um preço válido.');
    expect(mockAddProduct).not.toHaveBeenCalled();
  });

  it('permite adicionar e remover variações e impede remover a última variação', async () => {
    render(<NewProductModal isOpen={true} onClose={vi.fn()} />);

    // Há 1 variação inicial
    const removeButtons = screen.getAllByTitle('Remover variação');
    expect(removeButtons).toHaveLength(1);

    // Tentar remover a única variação
    fireEvent.click(removeButtons[0]);
    const alertMessage = await screen.findByRole('alert');
    expect(alertMessage).toHaveTextContent('Mantenha pelo menos uma variação cadastrada.');

    // Adicionar uma nova variação
    const addVarButton = screen.getByRole('button', { name: /Adicionar Variação/i });
    fireEvent.click(addVarButton);

    expect(screen.getAllByTitle('Remover variação')).toHaveLength(2);
  });

  it('cadastra produto com sucesso, chamando addProduct, onSuccess e onClose', async () => {
    mockAddProduct.mockResolvedValueOnce(undefined);
    const handleClose = vi.fn();
    const handleSuccess = vi.fn();

    render(<NewProductModal isOpen={true} onClose={handleClose} onSuccess={handleSuccess} />);

    fireEvent.change(screen.getByPlaceholderText('Ex: Camiseta Oversized Minimal'), {
      target: { value: 'Camisa Linho Pura' },
    });
    fireEvent.change(screen.getByPlaceholderText('Ex: Cyclone, Nike, Oakley...'), {
      target: { value: 'Vestra' },
    });
    fireEvent.change(screen.getByPlaceholderText('Ex: Camisas, Calçados...'), {
      target: { value: 'Camisas' },
    });
    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '189.90' },
    });

    const saveButton = screen.getByRole('button', { name: /Salvar Produto/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockAddProduct).toHaveBeenCalledTimes(1);
    });

    expect(mockAddProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        nome: 'Camisa Linho Pura',
        marca: 'Vestra',
        categoria: 'Camisas',
        preco: 189.9,
      })
    );

    expect(handleSuccess).toHaveBeenCalledWith('Produto cadastrado com sucesso.');
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('trata erro de submissão do backend exibindo mensagem de erro inline sem fechar o modal', async () => {
    mockAddProduct.mockRejectedValueOnce(new Error('Falha de conexão com o banco de dados'));
    const handleClose = vi.fn();
    const handleSuccess = vi.fn();

    render(<NewProductModal isOpen={true} onClose={handleClose} onSuccess={handleSuccess} />);

    fireEvent.change(screen.getByPlaceholderText('Ex: Camiseta Oversized Minimal'), {
      target: { value: 'Camiseta Teste' },
    });
    fireEvent.change(screen.getByPlaceholderText('Ex: Cyclone, Nike, Oakley...'), {
      target: { value: 'Marca Teste' },
    });
    fireEvent.change(screen.getByPlaceholderText('Ex: Camisas, Calçados...'), {
      target: { value: 'Categoria Teste' },
    });
    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '99.90' },
    });

    const saveButton = screen.getByRole('button', { name: /Salvar Produto/i });
    fireEvent.click(saveButton);

    const alertMessage = await screen.findByRole('alert');
    expect(alertMessage).toHaveTextContent('Falha de conexão com o banco de dados');
    expect(handleSuccess).not.toHaveBeenCalled();
    expect(handleClose).not.toHaveBeenCalled();
  });
});
