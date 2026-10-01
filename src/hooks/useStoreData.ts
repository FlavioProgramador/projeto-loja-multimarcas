import React, { useCallback } from 'react';
import type {
  Customer,
  FinancialTransaction,
  FixedExpense,
  Product,
  ReturnRecord,
  SaleMovement,
  Supplier,
} from '../types';

import {
  ProductsService,
  CustomersService,
  SuppliersService,
  FinanceService,
  SalesService,
} from '../services';
import { ReturnsService } from '../services/returns.service';
import { supabase, isSupabaseConfigured } from '../lib/supabase/client';

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

interface UseStoreDataParams {
  userId?: string;
  accessToken?: string;
  isAuthorized: boolean;
  authLoading: boolean;
  activeStoreId: string | null;
  setProducts: Setter<Product[]>;
  setTransactions: Setter<FinancialTransaction[]>;
  setMovements: Setter<SaleMovement[]>;
  setCustomers: Setter<Customer[]>;
  setReturns: Setter<ReturnRecord[]>;
  setSuppliers: Setter<Supplier[]>;
  setFixedExpenses: Setter<FixedExpense[]>;
  setIsLoading: Setter<boolean>;
}

export const useStoreData = ({
  userId,
  accessToken,
  isAuthorized,
  authLoading,
  activeStoreId,
  setProducts,
  setTransactions,
  setMovements,
  setCustomers,
  setReturns,
  setSuppliers,
  setFixedExpenses,
  setIsLoading,
}: UseStoreDataParams) => {
  const refreshData = useCallback(async () => {
    if (!isSupabaseConfigured || !isAuthorized || authLoading || !accessToken || !activeStoreId) return;

    try {
      setIsLoading(true);

      const {
        data: { session: verifiedSession },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;
      if (!verifiedSession?.access_token || verifiedSession.user.id !== userId) {
        throw new Error('Sessão autenticada indisponível para carregar os dados da loja.');
      }

      const results = await Promise.allSettled([
        ProductsService.getAll(activeStoreId),
        FinanceService.getTransactions(activeStoreId),
        FinanceService.getFixedExpenses(activeStoreId),
        SalesService.getMovements(activeStoreId),
        CustomersService.getAll(activeStoreId),
        SuppliersService.getAll(),
        ReturnsService.getAll(activeStoreId),
      ]);

      const applyResult = <T,>(
        result: PromiseSettledResult<T>,
        setter: Setter<T>,
        source: string
      ) => {
        if (result.status === 'fulfilled') {
          setter(result.value);
          return;
        }

        console.warn(
          'Falha ao carregar ' + source + '; mantendo dados atuais.',
          result.reason
        );
      };

      applyResult(results[0], setProducts, 'produtos/estoque');
      applyResult(results[1], setTransactions, 'financeiro');
      applyResult(results[2], setFixedExpenses, 'despesas fixas');
      applyResult(results[3], setMovements, 'vendas do PDV');
      applyResult(results[4], setCustomers, 'clientes');
      applyResult(results[5], setSuppliers, 'fornecedores');
      applyResult(results[6], setReturns, 'devoluções');
    } catch (err) {
      console.warn(
        'Sincronização com Supabase falhou; mantendo estado atual.',
        err
      );
    } finally {
      setIsLoading(false);
    }
  }, [
    accessToken,
    activeStoreId,
    authLoading,
    isAuthorized,
    setCustomers,
    setFixedExpenses,
    setIsLoading,
    setMovements,
    setProducts,
    setReturns,
    setSuppliers,
    setTransactions,
    userId,
  ]);

  return { refreshData };
};
