import React, { useCallback } from 'react';
import type {
  Customer,
  FinancialTransaction,
  FixedExpense,
  Product,
  ReturnRecord,
  SaleMovement,
  Supplier,
  UserStoreAccess,
} from '../types';

import {
  ProductsService,
  CustomersService,
  SuppliersService,
  FinanceService,
  SalesService,
} from '../services';
import { ReturnsService } from '../services/returns.service';
import { storeService } from '../services/store.service';
import { supabase, isSupabaseConfigured } from '../lib/supabase/client';

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

interface UseStoreDataParams {
  userId?: string;
  accessToken?: string;
  isAuthorized: boolean;
  authLoading: boolean;
  activeStoreId: string | null;
  setActiveStoreId: (id: string) => void;
  setUserStores: Setter<UserStoreAccess[]>;
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
  setActiveStoreId,
  setUserStores,
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
    if (!isSupabaseConfigured || !isAuthorized || authLoading || !accessToken) return;

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

      const remoteStores = await storeService.getUserStores();
      if (!remoteStores.length) {
        throw new Error('Nenhuma loja disponível para o usuário autenticado.');
      }

      setUserStores(remoteStores);

      const resolvedStoreId =
        activeStoreId && remoteStores.some(store => store.store_id === activeStoreId)
          ? activeStoreId
          : remoteStores[0].store_id;

      if (resolvedStoreId !== activeStoreId) {
        setActiveStoreId(resolvedStoreId);
      }

      const results = await Promise.allSettled([
        ProductsService.getAll(resolvedStoreId),
        FinanceService.getTransactions(resolvedStoreId),
        FinanceService.getFixedExpenses(resolvedStoreId),
        SalesService.getMovements(resolvedStoreId),
        CustomersService.getAll(resolvedStoreId),
        SuppliersService.getAll(),
        ReturnsService.getAll(resolvedStoreId),
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
    setActiveStoreId,
    setCustomers,
    setFixedExpenses,
    setIsLoading,
    setMovements,
    setProducts,
    setReturns,
    setSuppliers,
    setTransactions,
    setUserStores,
    userId,
  ]);

  return { refreshData };
};
