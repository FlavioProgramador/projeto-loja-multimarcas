import React, { useCallback } from 'react';
import { SuppliersService } from '../../services';
import { Supplier } from '../../types';
import type { RefreshDomains } from '../useStoreData';

export function useSuppliersDomain(suppliers: Supplier[], setSuppliers: React.Dispatch<React.SetStateAction<Supplier[]>>, refreshDomains: RefreshDomains) {
  const addSupplier = useCallback(async (data: Omit<Supplier, 'id' | 'produtos'>) => { await SuppliersService.create(data); await refreshDomains('suppliers'); }, [refreshDomains]);
  const updateSupplier = useCallback(async (id: number|string, data: Partial<Supplier>) => {
    const target = suppliers.find(s => String(s.id) === String(id));
    if (!target?.uuid) throw new Error('Fornecedor sem UUID do Supabase. Atualização cancelada.');
    const snapshot = suppliers; setSuppliers(prev => prev.map(s => String(s.id) === String(id) ? { ...s, ...data } : s));
    try { await SuppliersService.update(target.uuid, data); await refreshDomains('suppliers'); } catch (error) { setSuppliers(snapshot); throw error; }
  }, [suppliers, refreshDomains, setSuppliers]);
  const deleteSupplier = useCallback(async (id: number|string) => {
    const target = suppliers.find(s => String(s.id) === String(id));
    if (!target?.uuid) throw new Error('Fornecedor sem UUID do Supabase. Exclusão cancelada.');
    const snapshot = suppliers; setSuppliers(prev => prev.filter(s => String(s.id) !== String(id)));
    try { await SuppliersService.remove(target.uuid); await refreshDomains('suppliers'); } catch (error) { setSuppliers(snapshot); throw error; }
  }, [suppliers, refreshDomains, setSuppliers]);
  return { addSupplier, updateSupplier, deleteSupplier };
}

