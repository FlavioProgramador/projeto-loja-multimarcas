import React from 'react';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NewCustomerModal } from './NewCustomerModal';
import { useStore } from '../../contexts/StoreContext';

vi.mock('../../contexts/StoreContext', () => ({
  useStore: vi.fn(),
}));

describe('NewCustomerModal', () => {
  const mockAddCustomer = vi.fn();
  const mockOnClose = vi.fn();
  const mockOnSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useStore as any).mockReturnValue({
      addCustomer: mockAddCustomer,
    });
  });

  it('exibe mensagem de erro se nome ou CPF não forem preenchidos', async () => {
    render(<NewCustomerModal isOpen={true} onClose={mockOnClose} />);

    const saveButton = screen.getByRole('button', { name: /Salvar Cliente/i });
    fireEvent.click(saveButton);

    expect(await screen.findByText(/Os campos Nome e CPF são obrigatórios/i)).toBeInTheDocument();
    expect(mockAddCustomer).not.toHaveBeenCalled();
  });

  it('cadastra cliente com sucesso e chama callbacks', async () => {
    mockAddCustomer.mockResolvedValueOnce(undefined);

    render(<NewCustomerModal isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />);

    fireEvent.change(screen.getByLabelText(/Nome Completo \*/i), { target: { value: 'João Silva' } });
    fireEvent.change(screen.getByLabelText(/CPF \*/i), { target: { value: '123.456.789-00' } });

    const saveButton = screen.getByRole('button', { name: /Salvar Cliente/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockAddCustomer).toHaveBeenCalledWith({
        nome: 'João Silva',
        cpf: '123.456.789-00',
        rg: '',
        telefone: '',
        email: '',
        endereco: '',
        dataNascimento: '',
      });
      expect(mockOnSuccess).toHaveBeenCalledTimes(1);
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });

  it('exibe estado de carregamento e trata erros lançados pelo addCustomer', async () => {
    let rejectAddCustomer: (reason?: any) => void = () => {};
    const addCustomerPromise = new Promise((_, reject) => {
      rejectAddCustomer = reject;
    });
    mockAddCustomer.mockImplementationOnce(() => addCustomerPromise);

    render(<NewCustomerModal isOpen={true} onClose={mockOnClose} />);

    fireEvent.change(screen.getByLabelText(/Nome Completo \*/i), { target: { value: 'Maria Oliveira' } });
    fireEvent.change(screen.getByLabelText(/CPF \*/i), { target: { value: '987.654.321-11' } });

    const saveButton = screen.getByRole('button', { name: /Salvar Cliente/i });
    fireEvent.click(saveButton);

    expect(screen.getByRole('button', { name: /Salvando.../i })).toBeDisabled();
    expect(screen.getByLabelText(/Nome Completo \*/i)).toBeDisabled();

    rejectAddCustomer(new Error('CPF já cadastrado.'));

    expect(await screen.findByText(/⚠️ CPF já cadastrado\./i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salvar Cliente/i })).not.toBeDisabled();
    expect(mockOnClose).not.toHaveBeenCalled();
  });
});
