import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NewProductModal } from './NewProductModal';
import { useStore } from '../../contexts/StoreContext';

vi.mock('../../contexts/StoreContext', () => ({
  useStore: vi.fn(),
}));

describe('NewProductModal', () => {
  const mockAddProduct = vi.fn();
  const mockOnClose = vi.fn();
  const mockOnSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      addProduct: mockAddProduct,
    });
  });

  it('não renderiza nada quando isOpen é false', () => {
    render(<NewProductModal isOpen={false} onClose={mockOnClose} onSuccess={mockOnSuccess} />);
    expect(screen.queryByText('Cadastrar Novo Produto')).toBeNull();
  });

  it('exibe erro de validação inline quando campos obrigatórios estão vazios', async () => {
    render(<NewProductModal isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />);

    const saveButton = screen.getByRole('button', { name: /Salvar Produto/i });
    fireEvent.click(saveButton);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Por favor, preencha todos os campos obrigatórios e informe um preço válido.');
    expect(mockAddProduct).not.toHaveBeenCalled();
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('cadastra produto com sucesso, dispara onSuccess e fecha o modal', async () => {
    mockAddProduct.mockResolvedValueOnce(undefined);

    render(<NewProductModal isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />);

    fireEvent.change(screen.getByPlaceholderText(/Ex: Camiseta Oversized Minimal/i), {
      target: { value: 'Camiseta Teste' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Ex: Cyclone, Nike, Oakley/i), {
      target: { value: 'Marca X' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Ex: Camisas, Calçados/i), {
      target: { value: 'Camisas' },
    });
    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '99.90' },
    });

    const saveButton = screen.getByRole('button', { name: /Salvar Produto/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockAddProduct).toHaveBeenCalledWith({
        nome: 'Camiseta Teste',
        marca: 'Marca X',
        categoria: 'Camisas',
        preco: 99.9,
        skus: [
          { tamanho: 'P', cor: 'Preto', qtd: 10 },
        ],
      });
    });

    expect(mockOnSuccess).toHaveBeenCalledWith('Produto cadastrado com sucesso.');
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('exibe erro inline e mantém modal aberto se addProduct falhar', async () => {
    mockAddProduct.mockRejectedValueOnce(new Error('Nenhuma loja ativa selecionada.'));

    render(<NewProductModal isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />);

    fireEvent.change(screen.getByPlaceholderText(/Ex: Camiseta Oversized Minimal/i), {
      target: { value: 'Camiseta Erro' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Ex: Cyclone, Nike, Oakley/i), {
      target: { value: 'Marca Y' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Ex: Camisas, Calçados/i), {
      target: { value: 'Roupas' },
    });
    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '49.90' },
    });

    const saveButton = screen.getByRole('button', { name: /Salvar Produto/i });
    fireEvent.click(saveButton);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Nenhuma loja ativa selecionada.');
    expect(mockOnSuccess).not.toHaveBeenCalled();
    expect(mockOnClose).not.toHaveBeenCalled();
  });
});
