import React, { useCallback } from 'react';
import { FinanceService } from '../../services';
import { FixedExpense } from '../../types';
export function useFinanceDomain(fixedExpenses: FixedExpense[], setFixedExpenses: React.Dispatch<React.SetStateAction<FixedExpense[]>>) {
  const toggleExpensePaid = useCallback(async (id: number) => {
    const target = fixedExpenses.find(e => e.id === id);
    if (!target) return;
    const nextPaid = !target.pago;
    const snapshot = fixedExpenses;
    setFixedExpenses(prev => prev.map(e => e.id === id ? { ...e, pago: nextPaid } : e));
    if (!target.uuid) return;
    try { await FinanceService.toggleExpensePaid(target.uuid, target.pago); }
    catch (error) { setFixedExpenses(snapshot); throw error; }
  }, [fixedExpenses, setFixedExpenses]);
  return { toggleExpensePaid };
}

