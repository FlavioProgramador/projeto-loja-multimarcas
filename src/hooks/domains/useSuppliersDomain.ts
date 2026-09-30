import React, { useCallback } from 'react';
import { SuppliersService } from '../../services';
import { Supplier } from '../../types';

export function useSuppliersDomain(suppliers: Supplier[], setSuppliers: React.Dispatch<React.SetStateAction<Supplier[]>>, refreshData: () => Promise<void>) {
  const addSupplier = useCallback(async (data: Omit<Supplier, 'id' | 'produtos'>) => { await SuppliersService.create(data); await refreshData(); }, [refreshData]);
  const updateSupplier = useCallback(async (id: number|string, data: Partial<Supplier>) => {
    const target = suppliers.find(s => String(s.id) === String(id));
    if (!target?.uuid) throw new Error('Fornecedor sem UUID do Supabase. Atualização cancelada.');
    const snapshot = suppliers; setSuppliers(prev => prev.map(s => String(s.id) === String(id) ? { ...s, ...data } : s));
    try { await SuppliersService.update(target.uuid, data); await refreshData(); } catch (error) { setSuppliers(snapshot); throw error; }
  }, [suppliers, refreshData, setSuppliers]);
  const deleteSupplier = useCallback(async (id: number|string) => {
    const target = suppliers.find(s => String(s.id) === String(id));
    if (!target?.uuid) throw new Error('Fornecedor sem UUID do Supabase. Exclusão cancelada.');
    const snapshot = suppliers; setSuppliers(prev => prev.filter(s => String(s.id) !== String(id)));
    try { await SuppliersService.remove(target.uuid); await refreshData(); } catch (error) { setSuppliers(snapshot); throw error; }
  }, [suppliers, refreshData, setSuppliers]);
  return { addSupplier, updateSupplier, deleteSupplier };
}

