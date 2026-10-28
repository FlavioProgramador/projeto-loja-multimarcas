import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StockEntryModal } from './StockEntryModal';
import { useStore } from '../../contexts/StoreContext';

vi.mock('../../contexts/StoreContext', () => ({
  useStore: vi.fn(),
}));

const mockRegisterStockEntry = vi.fn();
const mockProducts = [
  {
    id: 1,
    uuid: 'prod-1',
    nome: 'Camiseta Classic',
    marca: 'Nike',
    categoria: 'Camisas',
    preco: 99.9,
    skus: [{ id: 'sku-1', tamanho: 'M', cor: 'Preto', qtd: 5 }],
  },
];

describe('StockEntryModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
      products: mockProducts,
      registerStockEntry: mockRegisterStockEntry,
    });
  });

  it('não renderiza nada quando isOpen é false', () => {
    const { container } = render(
      <StockEntryModal isOpen={false} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('exibe erro de validação quando o nome do produto está em branco', async () => {
    render(<StockEntryModal isOpen={true} onClose={vi.fn()} />);

    const submitBtn = screen.getByRole('button', { name: 'Registrar Entrada' });
    fireEvent.click(submitBtn);

    const alertMessage = await screen.findByRole('alert');
    expect(alertMessage).toHaveTextContent('Informe o nome do produto.');
    expect(mockRegisterStockEntry).not.toHaveBeenCalled();
  });

  it('exibe erro de validação para quantidade ou custo inválido', async () => {
    render(<StockEntryModal isOpen={true} onClose={vi.fn()} />);

    const productInput = screen.getByPlaceholderText('Digite ou selecione o produto...');
    fireEvent.change(productInput, { target: { value: 'Camiseta Classic' } });

    const qtdInput = screen.getByDisplayValue('1');
    fireEvent.change(qtdInput, { target: { value: '0' } });

    const submitBtn = screen.getByRole('button', { name: 'Registrar Entrada' });
    fireEvent.click(submitBtn);

    const alertMessage = await screen.findByRole('alert');
    expect(alertMessage).toHaveTextContent('A quantidade de entrada deve ser um número maior que zero.');
    expect(mockRegisterStockEntry).not.toHaveBeenCalled();
  });

  it('registra entrada com sucesso para produto existente e chama onSuccess', async () => {
    mockRegisterStockEntry.mockResolvedValueOnce(undefined);
    const handleClose = vi.fn();
    const handleSuccess = vi.fn();

    render(
      <StockEntryModal
        isOpen={true}
        onClose={handleClose}
        onSuccess={handleSuccess}
      />
    );

    const productInput = screen.getByPlaceholderText('Digite ou selecione o produto...');
    fireEvent.change(productInput, { target: { value: 'Camiseta Classic' } });

    const costoInput = screen.getByPlaceholderText('0.00');
    fireEvent.change(costoInput, { target: { value: '45.00' } });

    const submitBtn = screen.getByRole('button', { name: 'Registrar Entrada' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockRegisterStockEntry).toHaveBeenCalledWith({
        productName: 'Camiseta Classic',
        skuIndex: 0,
        qtd: 1,
        custoUnitario: 45,
        newSize: undefined,
        newColor: undefined,
      });
    });

    expect(handleSuccess).toHaveBeenCalledWith('Entrada de estoque registrada com sucesso!');
    expect(handleClose).toHaveBeenCalled();
  });

  it('exibe mensagem de erro inline quando a chamada registerStockEntry lança exceção', async () => {
    mockRegisterStockEntry.mockRejectedValueOnce(new Error('Falha de conexão com Supabase'));

    render(<StockEntryModal isOpen={true} onClose={vi.fn()} />);

    const productInput = screen.getByPlaceholderText('Digite ou selecione o produto...');
    fireEvent.change(productInput, { target: { value: 'Camiseta Classic' } });

    const costoInput = screen.getByPlaceholderText('0.00');
    fireEvent.change(costoInput, { target: { value: '50.00' } });

    const submitBtn = screen.getByRole('button', { name: 'Registrar Entrada' });
    fireEvent.click(submitBtn);

    const alertMessage = await screen.findByRole('alert');
    expect(alertMessage).toHaveTextContent('Falha de conexão com Supabase');
  });
});
