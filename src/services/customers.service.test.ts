import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fromMock, updateMock, eqMock1, eqMock2 } = vi.hoisted(() => {
  const eqMock2Fn = vi.fn();
  const eqMock1Fn = vi.fn().mockImplementation(() => ({
    eq: eqMock2Fn,
    then: (resolve: (val: any) => any) => resolve({ error: null }),
  }));
  const updateMockFn = vi.fn().mockImplementation(() => ({
    eq: eqMock1Fn,
  }));
  const fromMockFn = vi.fn().mockImplementation(() => ({
    update: updateMockFn,
  }));

  return {
    fromMock: fromMockFn,
    updateMock: updateMockFn,
    eqMock1: eqMock1Fn,
    eqMock2: eqMock2Fn,
  };
});

vi.mock('../lib/supabase/client', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: fromMock,
  },
}));

import { CustomersService } from './customers.service';

describe('CustomersService multi-tenant update & remove', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eqMock1.mockImplementation(() => ({
      eq: eqMock2,
      then: (resolve: (val: any) => any) => resolve({ error: null }),
    }));
    eqMock2.mockResolvedValue({ error: null });
  });

  it('update sem storeId filtra apenas por id', async () => {
    await CustomersService.update('customer-uuid-1', { nome: 'João Silva' });

    expect(fromMock).toHaveBeenCalledWith('customers');
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'João Silva' }));
    expect(eqMock1).toHaveBeenCalledWith('id', 'customer-uuid-1');
    expect(eqMock2).not.toHaveBeenCalled();
  });

  it('update com storeId filtra por id e store_id', async () => {
    await CustomersService.update('customer-uuid-1', { nome: 'João Silva' }, 'store-uuid-a');

    expect(fromMock).toHaveBeenCalledWith('customers');
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'João Silva' }));
    expect(eqMock1).toHaveBeenCalledWith('id', 'customer-uuid-1');
    expect(eqMock2).toHaveBeenCalledWith('store_id', 'store-uuid-a');
  });

  it('remove sem storeId atualiza is_active para false e filtra apenas por id', async () => {
    await CustomersService.remove('customer-uuid-2');

    expect(fromMock).toHaveBeenCalledWith('customers');
    expect(updateMock).toHaveBeenCalledWith({ is_active: false });
    expect(eqMock1).toHaveBeenCalledWith('id', 'customer-uuid-2');
    expect(eqMock2).not.toHaveBeenCalled();
  });

  it('remove com storeId atualiza is_active para false e filtra por id e store_id', async () => {
    await CustomersService.remove('customer-uuid-2', 'store-uuid-b');

    expect(fromMock).toHaveBeenCalledWith('customers');
    expect(updateMock).toHaveBeenCalledWith({ is_active: false });
    expect(eqMock1).toHaveBeenCalledWith('id', 'customer-uuid-2');
    expect(eqMock2).toHaveBeenCalledWith('store_id', 'store-uuid-b');
  });

  it('lança erro caso a operação de update retorne erro', async () => {
    eqMock1.mockImplementation(() => ({
      eq: eqMock2,
      then: (resolve: (val: any) => any) => resolve({ error: new Error('Erro de banco de dados') }),
    }));

    await expect(
      CustomersService.update('customer-uuid-1', { nome: 'João' }),
    ).rejects.toThrow('Erro de banco de dados');
  });
});
