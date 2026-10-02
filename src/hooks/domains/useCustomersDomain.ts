import React, { useCallback } from 'react';
import { CustomersService } from '../../services';
import { Customer } from '../../types';

export function useCustomersDomain(
  customers: Customer[],
  setCustomers: React.Dispatch<React.SetStateAction<Customer[]>>,
  activeStoreId: string | null,
) {
  const addCustomer = useCallback(async (data: Omit<Customer, 'id' | 'historico'>) => {
    if (!activeStoreId) throw new Error('Nenhuma loja ativa selecionada.');
    await CustomersService.create(data, activeStoreId);
  }, [activeStoreId]);

  const updateCustomer = useCallback(async (id: number | string, data: Partial<Customer>) => {
    const target = customers.find(c => String(c.uuid || c.id) === String(id));
    const targetUuid = typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)
      ? id
      : target?.uuid;
    if (!targetUuid) throw new Error('Cliente sem UUID do Supabase. Atualização cancelada.');

    const snapshot = customers;
    setCustomers(prev => prev.map(c =>
      String(c.uuid || c.id) === String(id) ? { ...c, ...data } : c
    ));

    try {
      await CustomersService.update(targetUuid, data);
    } catch (error) {
      setCustomers(snapshot);
      throw error;
    }
  }, [customers, setCustomers]);

  const deleteCustomer = useCallback(async (id: number | string) => {
    const target = customers.find(c => String(c.uuid || c.id) === String(id));
    const targetUuid = typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)
      ? id
      : target?.uuid;
    if (!targetUuid) throw new Error('Cliente sem UUID do Supabase. Exclusão cancelada.');

    const snapshot = customers;
    setCustomers(prev => prev.filter(c => String(c.uuid || c.id) !== String(id)));

    try {
      await CustomersService.remove(targetUuid);
    } catch (error) {
      setCustomers(snapshot);
      throw error;
    }
  }, [customers, setCustomers]);

  return { addCustomer, updateCustomer, deleteCustomer };
}
