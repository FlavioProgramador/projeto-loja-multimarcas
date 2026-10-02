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
import { supabase, isSupabaseConfigured } from '../lib/supabase/client';

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
  const inFlightFullRefreshRef = useRef<{ key: string; promise: Promise<void> } | null>(null);

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

      return Promise.resolve();
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

  const refreshData = useCallback((): Promise<void> => {
    if (
      !isSupabaseConfigured ||
      !isAuthorized ||
      authLoading ||
      !accessToken ||
      !activeStoreId
    ) {
      return Promise.resolve();
    }

    const refreshKey = `${userId ?? 'anonymous'}:${activeStoreId}:${accessToken}`;
    const currentRefresh = inFlightFullRefreshRef.current;
    if (currentRefresh?.key === refreshKey) {
      return currentRefresh.promise;
    }

    const requestSequence = refreshSequenceRef.current;
    const operation = (async () => {
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

        await refreshDomains(...FULL_REFRESH_DOMAINS);
      } catch (error) {
        console.warn(
          'Sincronização com Supabase falhou; mantendo estado atual.',
          error,
        );
      } finally {
        if (requestSequence === refreshSequenceRef.current) {
          setIsLoading(false);
        }
      }
    })();

    inFlightFullRefreshRef.current = { key: refreshKey, promise: operation };

    void operation.finally(() => {
      if (inFlightFullRefreshRef.current?.promise === operation) {
        inFlightFullRefreshRef.current = null;
      }
    });

    return operation;
  }, [
    accessToken,
    activeStoreId,
    authLoading,
    isAuthorized,
    refreshDomains,
    setIsLoading,
    userId,
  ]);

  return { refreshData, refreshDomains };
};
