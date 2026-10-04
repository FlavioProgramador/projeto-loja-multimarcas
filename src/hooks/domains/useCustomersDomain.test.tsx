import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCustomersDomain } from './useCustomersDomain';
import { CustomersService } from '../../services';
import type { Customer } from '../../types';

vi.mock('../../services', () => ({
  CustomersService: {
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

describe('useCustomersDomain', () => {
  const initialCustomers: Customer[] = [
    {
      id: 1,
      uuid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      nome: 'Cliente A',
      cpf: '000.000.000-00',
      rg: '',
      email: 'clientea@teste.com',
      telefone: '(11) 99999-9999',
      endereco: 'Rua A',
      dataNascimento: '1990-01-01',
      saldoCredito: 0,
      historico: [],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve cadastrar cliente chamando CustomersService.create', async () => {
    const setCustomers = vi.fn();
    vi.mocked(CustomersService.create).mockResolvedValueOnce({ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' });

    const { result } = renderHook(() =>
      useCustomersDomain(initialCustomers, setCustomers, 'store-123')
    );

    await act(async () => {
      await result.current.addCustomer({
        nome: 'Cliente B',
        cpf: '111.111.111-11',
        rg: '',
        email: 'clienteb@teste.com',
        telefone: '(11) 88888-8888',
        endereco: 'Rua B',
        dataNascimento: '1992-02-02',
        saldoCredito: 0,
      });
    });

    expect(CustomersService.create).toHaveBeenCalledWith(
      {
        nome: 'Cliente B',
        cpf: '111.111.111-11',
        rg: '',
        email: 'clienteb@teste.com',
        telefone: '(11) 88888-8888',
        endereco: 'Rua B',
        dataNascimento: '1992-02-02',
        saldoCredito: 0,
      },
      'store-123'
    );
  });

  it('deve lançar erro ao tentar adicionar cliente sem loja ativa', async () => {
    const setCustomers = vi.fn();
    const { result } = renderHook(() =>
      useCustomersDomain(initialCustomers, setCustomers, null)
    );

    await expect(
      act(async () => {
        await result.current.addCustomer({
          nome: 'Cliente Sem Loja',
          cpf: '222.222.222-22',
          rg: '',
          email: '',
          telefone: '',
          endereco: '',
          dataNascimento: '',
        });
      })
    ).rejects.toThrow('Nenhuma loja ativa selecionada.');
  });

  it('deve atualizar cliente otimisticamente e fazer rollback em caso de falha', async () => {
    let customersState = [...initialCustomers];
    const setCustomers = vi.fn(updater => {
      if (typeof updater === 'function') {
        customersState = updater(customersState);
      } else {
        customersState = updater;
      }
    });

    vi.mocked(CustomersService.update).mockRejectedValueOnce(new Error('Erro de atualização no banco'));

    const { result } = renderHook(() =>
      useCustomersDomain(customersState, setCustomers, 'store-123')
    );

    await expect(
      act(async () => {
        await result.current.updateCustomer('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', {
          nome: 'Cliente A Modificado',
        });
      })
    ).rejects.toThrow('Erro de atualização no banco');

    expect(setCustomers).toHaveBeenCalledTimes(2);
    expect(customersState[0].nome).toBe('Cliente A');
  });

  it('deve excluir cliente otimisticamente e fazer rollback em caso de falha', async () => {
    let customersState = [...initialCustomers];
    const setCustomers = vi.fn(updater => {
      if (typeof updater === 'function') {
        customersState = updater(customersState);
      } else {
        customersState = updater;
      }
    });

    vi.mocked(CustomersService.remove).mockRejectedValueOnce(new Error('Erro de exclusão lógica'));

    const { result } = renderHook(() =>
      useCustomersDomain(customersState, setCustomers, 'store-123')
    );

    await expect(
      act(async () => {
        await result.current.deleteCustomer('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
      })
    ).rejects.toThrow('Erro de exclusão lógica');

    expect(customersState).toHaveLength(1);
    expect(customersState[0].uuid).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  });
});
