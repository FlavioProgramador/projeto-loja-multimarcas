import React, { useCallback } from 'react';
import { CustomersService } from '../../services';
import { Customer } from '../../types';
import type { RefreshDomains } from '../useStoreData';

export function useCustomersDomain(
  customers: Customer[],
  setCustomers: React.Dispatch<React.SetStateAction<Customer[]>>,
  activeStoreId: string | null,
  refreshDomains: RefreshDomains,
) {
  const addCustomer = useCallback(async (data: Omit<Customer, 'id' | 'historico'>) => {
    if (!activeStoreId) throw new Error('Nenhuma loja ativa selecionada.');
    await CustomersService.create(data, activeStoreId);
    await refreshDomains('customers');
  }, [activeStoreId, refreshDomains]);

  const updateCustomer = useCallback(async (id: number | string, data: Partial<Customer>) => {
    const target = customers.find(c => String(c.uuid || c.id) === String(id));
    if (!target?.uuid) throw new Error('Cliente sem UUID do Supabase. Atualização cancelada.');
    const snapshot = customers;
    setCustomers(prev => prev.map(c => String(c.uuid || c.id) === String(id) ? { ...c, ...data } : c));
    try {
      await CustomersService.update(target.uuid, data);
      await refreshDomains('customers');
    } catch (error) {
      setCustomers(snapshot);
      throw error;
    }
  }, [customers, refreshDomains, setCustomers]);

  const deleteCustomer = useCallback(async (id: number | string) => {
    const target = customers.find(c => String(c.uuid || c.id) === String(id));
    if (!target?.uuid) throw new Error('Cliente sem UUID do Supabase. Exclusão cancelada.');
    const snapshot = customers;
    setCustomers(prev => prev.filter(c => String(c.uuid || c.id) !== String(id)));
    try {
      await CustomersService.remove(target.uuid);
      await refreshDomains('customers');
    } catch (error) {
      setCustomers(snapshot);
      throw error;
    }
  }, [customers, refreshData, setCustomers]);

  return { addCustomer, updateCustomer, deleteCustomer };
}
