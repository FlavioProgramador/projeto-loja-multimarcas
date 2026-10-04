import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSuppliersDomain } from './useSuppliersDomain';
import { SuppliersService } from '../../services';
import type { Supplier } from '../../types';

vi.mock('../../services', () => ({
  SuppliersService: {
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

describe('useSuppliersDomain', () => {
  const refreshDomains = vi.fn().mockResolvedValue(undefined);
  const initialSuppliers: Supplier[] = [
    {
      id: 1,
      uuid: '11111111-1111-1111-1111-111111111111',
      nome: 'Fornecedor A',
      cnpj: '00.000.000/0001-00',
      contato: 'João',
      email: 'joao@fornecedora.com',
      endereco: 'Rua A',
      produtos: [],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve adicionar fornecedor chamando o servico e recarregando o dominio', async () => {
    let suppliersState = [...initialSuppliers];
    const setSuppliers = vi.fn(updater => {
      if (typeof updater === 'function') {
        suppliersState = updater(suppliersState);
      } else {
        suppliersState = updater;
      }
    });

    vi.mocked(SuppliersService.create).mockResolvedValueOnce({ id: '22222222-2222-2222-2222-222222222222' });

    const { result } = renderHook(() =>
      useSuppliersDomain(suppliersState, setSuppliers, refreshDomains, 'store-123')
    );

    await act(async () => {
      await result.current.addSupplier({
        nome: 'Fornecedor B',
        cnpj: '11.111.111/0001-11',
        contato: 'Maria',
        email: 'maria@fornecedorb.com',
        endereco: 'Rua B',
      });
    });

    expect(SuppliersService.create).toHaveBeenCalledWith({
      nome: 'Fornecedor B',
      cnpj: '11.111.111/0001-11',
      contato: 'Maria',
      email: 'maria@fornecedorb.com',
      endereco: 'Rua B',
    });
    expect(refreshDomains).toHaveBeenCalledWith('suppliers');
  });

  it('deve lançar erro ao tentar adicionar fornecedor sem loja ativa selecionada (null)', async () => {
    const setSuppliers = vi.fn();
    const { result } = renderHook(() =>
      useSuppliersDomain(initialSuppliers, setSuppliers, refreshDomains, null)
    );

    await expect(
      act(async () => {
        await result.current.addSupplier({
          nome: 'Fornecedor C',
          cnpj: '',
          contato: '',
          email: '',
          endereco: '',
        });
      })
    ).rejects.toThrow('Nenhuma loja ativa selecionada.');
  });

  it('deve atualizar fornecedor de forma otimista e fazer rollback em caso de erro', async () => {
    let suppliersState = [...initialSuppliers];
    const setSuppliers = vi.fn(updater => {
      if (typeof updater === 'function') {
        suppliersState = updater(suppliersState);
      } else {
        suppliersState = updater;
      }
    });

    vi.mocked(SuppliersService.update).mockRejectedValueOnce(new Error('Erro de conexão no Supabase'));

    const { result } = renderHook(() =>
      useSuppliersDomain(suppliersState, setSuppliers, refreshDomains, 'store-123')
    );

    await expect(
      act(async () => {
        await result.current.updateSupplier('11111111-1111-1111-1111-111111111111', {
          nome: 'Fornecedor A Alterado',
        });
      })
    ).rejects.toThrow('Erro de conexão no Supabase');

    expect(setSuppliers).toHaveBeenCalledTimes(2);
    expect(suppliersState[0].nome).toBe('Fornecedor A');
  });

  it('deve remover fornecedor de forma otimista e fazer rollback em caso de erro', async () => {
    let suppliersState = [...initialSuppliers];
    const setSuppliers = vi.fn(updater => {
      if (typeof updater === 'function') {
        suppliersState = updater(suppliersState);
      } else {
        suppliersState = updater;
      }
    });

    vi.mocked(SuppliersService.remove).mockRejectedValueOnce(new Error('Falha de permissão'));

    const { result } = renderHook(() =>
      useSuppliersDomain(suppliersState, setSuppliers, refreshDomains, 'store-123')
    );

    await expect(
      act(async () => {
        await result.current.deleteSupplier('11111111-1111-1111-1111-111111111111');
      })
    ).rejects.toThrow('Falha de permissão');

    expect(suppliersState).toHaveLength(1);
    expect(suppliersState[0].uuid).toBe('11111111-1111-1111-1111-111111111111');
  });
});
