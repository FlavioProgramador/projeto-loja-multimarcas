import React, { useCallback, useEffect, useRef } from 'react';
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
import { isSupabaseConfigured } from '../lib/supabase/client';

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

export type StoreDataDomain =
  | 'products'
  | 'transactions'
  | 'fixedExpenses'
  | 'sales'
  | 'customers'
  | 'suppliers'
  | 'returns';

export type RefreshDomains = (...domains: StoreDataDomain[]) => Promise<void>;

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

const FULL_REFRESH_DOMAINS: StoreDataDomain[] = [
  'products',
  'transactions',
  'fixedExpenses',
  'sales',
  'customers',
  'suppliers',
  'returns',
];

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
  const refreshSequenceRef = useRef(0);
  const inFlightRefreshesRef = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    refreshSequenceRef.current += 1;
  }, [accessToken, activeStoreId, isAuthorized, userId]);

  const runScopedRefresh = useCallback(
    function runScopedRefresh<T>(
      domain: StoreDataDomain,
      loader: () => Promise<T>,
      setter: Setter<T>,
      source: string,
    ): Promise<void> {
      if (
        !isSupabaseConfigured ||
        !isAuthorized ||
        authLoading ||
        !accessToken ||
        !activeStoreId
      ) {
        return Promise.resolve();
      }

      const refreshKey = `${domain}:${userId ?? 'anonymous'}:${activeStoreId}:${accessToken}`;
      const currentRefresh = inFlightRefreshesRef.current.get(refreshKey);
      if (currentRefresh) return currentRefresh;

      const requestSequence = refreshSequenceRef.current;
      const operation = (async () => {
        try {
          const value = await loader();
          if (requestSequence !== refreshSequenceRef.current) return;
          setter(value);
        } catch (error) {
          console.warn(
            'Falha ao carregar ' + source + '; mantendo dados atuais.',
            error,
          );
        }
      })();

      inFlightRefreshesRef.current.set(refreshKey, operation);

      void operation.finally(() => {
        if (inFlightRefreshesRef.current.get(refreshKey) === operation) {
          inFlightRefreshesRef.current.delete(refreshKey);
        }
      });

      return operation;
    },
    [accessToken, activeStoreId, authLoading, isAuthorized, userId],
  );

  const refreshDomain = useCallback(
    (domain: StoreDataDomain): Promise<void> => {
      if (!activeStoreId) return Promise.resolve();

      switch (domain) {
        case 'products':
          return runScopedRefresh(
            domain,
            () => ProductsService.getAll(activeStoreId),
            setProducts,
            'produtos/estoque',
          );
        case 'transactions':
          return runScopedRefresh(
            domain,
            () => FinanceService.getTransactions(activeStoreId),
            setTransactions,
            'financeiro',
          );
        case 'fixedExpenses':
          return runScopedRefresh(
            domain,
            () => FinanceService.getFixedExpenses(activeStoreId),
            setFixedExpenses,
            'despesas fixas',
          );
        case 'sales':
          return runScopedRefresh(
            domain,
            () => SalesService.getMovements(activeStoreId),
            setMovements,
            'vendas do PDV',
          );
        case 'customers':
          return runScopedRefresh(
            domain,
            () => CustomersService.getAll(activeStoreId),
            setCustomers,
            'clientes',
          );
        case 'suppliers':
          return runScopedRefresh(
            domain,
            () => SuppliersService.getAll(),
            setSuppliers,
            'fornecedores',
          );
        case 'returns':
          return runScopedRefresh(
            domain,
            () => ReturnsService.getAll(activeStoreId),
            setReturns,
            'devoluções',
          );
      }
    },
    [
      activeStoreId,
      runScopedRefresh,
      setCustomers,
      setFixedExpenses,
      setMovements,
      setProducts,
      setReturns,
      setSuppliers,
      setTransactions,
    ],
  );

  const refreshDomains = useCallback<RefreshDomains>(
    async (...domains) => {
      const uniqueDomains = [...new Set(domains)];
      await Promise.all(uniqueDomains.map(refreshDomain));
    },
    [refreshDomain],
  );

  const refreshData = useCallback(async (): Promise<void> => {
    if (
      !isSupabaseConfigured ||
      !isAuthorized ||
      authLoading ||
      !accessToken ||
      !activeStoreId
    ) {
      return;
    }

    const requestSequence = refreshSequenceRef.current;

    try {
      setIsLoading(true);
      await refreshDomains(...FULL_REFRESH_DOMAINS);
    } finally {
      if (requestSequence === refreshSequenceRef.current) {
        setIsLoading(false);
      }
    }
  }, [
    accessToken,
    activeStoreId,
    authLoading,
    isAuthorized,
    refreshDomains,
    setIsLoading,
  ]);

  return { refreshData, refreshDomains };
};
