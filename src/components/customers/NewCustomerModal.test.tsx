import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {
  NewCustomerModal,
  formatCpfInput,
  formatPhoneInput,
  validateEmail,
} from './NewCustomerModal';

const mockAddCustomer = vi.fn();

vi.mock('../../contexts/StoreContext', () => ({
  useStore: () => ({
    addCustomer: mockAddCustomer,
  }),
}));

describe('NewCustomerModal formatting & validation helpers', () => {
  it('formats CPF input progressively', () => {
    expect(formatCpfInput('12345678901')).toBe('123.456.789-01');
    expect(formatCpfInput('12345')).toBe('123.45');
    expect(formatCpfInput('1234567')).toBe('123.456.7');
  });

  it('formats phone input progressively for mobile and landline', () => {
    expect(formatPhoneInput('11999998888')).toBe('(11) 99999-8888');
    expect(formatPhoneInput('1133334444')).toBe('(11) 3333-4444');
    expect(formatPhoneInput('11')).toBe('(11');
  });

  it('validates email addresses correctly', () => {
    expect(validateEmail('')).toBe(true);
    expect(validateEmail('user@domain.com')).toBe(true);
    expect(validateEmail('invalid-email')).toBe(false);
  });
});

describe('NewCustomerModal component', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly with accessibility attributes and labels', () => {
    render(<NewCustomerModal {...defaultProps} />);

    expect(screen.getByLabelText(/Nome Completo \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/CPF \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Telefone \/ WhatsApp/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/E-mail/i)).toBeInTheDocument();
  });

  it('applies input masks in real time on CPF and phone inputs', () => {
    render(<NewCustomerModal {...defaultProps} />);

    const cpfInput = screen.getByLabelText(/CPF \*/i) as HTMLInputElement;
    const phoneInput = screen.getByLabelText(/Telefone \/ WhatsApp/i) as HTMLInputElement;

    fireEvent.change(cpfInput, { target: { value: '12345678901' } });
    expect(cpfInput.value).toBe('123.456.789-01');

    fireEvent.change(phoneInput, { target: { value: '11988887777' } });
    expect(phoneInput.value).toBe('(11) 98888-7777');
  });

  it('displays error and sets aria-invalid when submitting empty required fields', () => {
    render(<NewCustomerModal {...defaultProps} />);

    const saveButton = screen.getByRole('button', { name: /Salvar Cliente/i });
    fireEvent.click(saveButton);

    const errorMessage = screen.getByRole('alert');
    expect(errorMessage).toHaveTextContent('Os campos Nome e CPF são obrigatórios.');

    const nameInput = screen.getByLabelText(/Nome Completo \*/i);
    expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    expect(mockAddCustomer).not.toHaveBeenCalled();
  });

  it('displays error when submitting invalid CPF format', () => {
    render(<NewCustomerModal {...defaultProps} />);

    const nameInput = screen.getByLabelText(/Nome Completo \*/i);
    const cpfInput = screen.getByLabelText(/CPF \*/i);

    fireEvent.change(nameInput, { target: { value: 'Maria Silva' } });
    fireEvent.change(cpfInput, { target: { value: '123' } });

    const saveButton = screen.getByRole('button', { name: /Salvar Cliente/i });
    fireEvent.click(saveButton);

    expect(screen.getByRole('alert')).toHaveTextContent(/O CPF informado não é válido/i);
    expect(cpfInput).toHaveAttribute('aria-invalid', 'true');
    expect(mockAddCustomer).not.toHaveBeenCalled();
  });

  it('submits successfully when form data is valid', () => {
    render(<NewCustomerModal {...defaultProps} />);

    fireEvent.change(screen.getByLabelText(/Nome Completo \*/i), { target: { value: 'João Souza' } });
    fireEvent.change(screen.getByLabelText(/CPF \*/i), { target: { value: '12345678901' } });
    fireEvent.change(screen.getByLabelText(/Telefone \/ WhatsApp/i), { target: { value: '11977776666' } });
    fireEvent.change(screen.getByLabelText(/E-mail/i), { target: { value: 'joao@email.com' } });

    const saveButton = screen.getByRole('button', { name: /Salvar Cliente/i });
    fireEvent.click(saveButton);

    expect(mockAddCustomer).toHaveBeenCalledWith({
      nome: 'João Souza',
      cpf: '123.456.789-01',
      rg: '',
      telefone: '(11) 97777-6666',
      email: 'joao@email.com',
      endereco: '',
      dataNascimento: '',
    });
    expect(defaultProps.onSuccess).toHaveBeenCalled();
    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});
