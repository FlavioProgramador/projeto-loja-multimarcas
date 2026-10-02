import { act, renderHook } from '@testing-library/react';
import { useStoreData } from './useStoreData';
import {
  CustomersService,
  FinanceService,
  ProductsService,
  SalesService,
  SuppliersService,
} from '../services';
import { ReturnsService } from '../services/returns.service';

vi.mock('../lib/supabase/client', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: {
          session: {
            access_token: 'token-a',
            user: { id: 'user-a' },
          },
        },
        error: null,
      }),
    },
  },
}));

vi.mock('../services', () => ({
  ProductsService: {
    getAll: vi.fn().mockResolvedValue([]),
  },
  CustomersService: {
    getAll: vi.fn().mockResolvedValue([]),
  },
  SuppliersService: {
    getAll: vi.fn().mockResolvedValue([]),
  },
  FinanceService: {
    getTransactions: vi.fn().mockResolvedValue([]),
    getFixedExpenses: vi.fn().mockResolvedValue([]),
  },
  SalesService: {
    getMovements: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../services/returns.service', () => ({
  ReturnsService: {
    getAll: vi.fn().mockResolvedValue([]),
  },
}));

const buildParams = () => ({
  userId: 'user-a',
  accessToken: 'token-a',
  isAuthorized: true,
  authLoading: false,
  activeStoreId: 'store-a',
  setProducts: vi.fn(),
  setTransactions: vi.fn(),
  setMovements: vi.fn(),
  setCustomers: vi.fn(),
  setReturns: vi.fn(),
  setSuppliers: vi.fn(),
  setFixedExpenses: vi.fn(),
  setIsLoading: vi.fn(),
});

describe('useStoreData - refresh por domínio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('atualiza somente clientes quando apenas o domínio customers é invalidado', async () => {
    const params = buildParams();
    const { result } = renderHook(() => useStoreData(params));

    await act(async () => {
      await result.current.refreshDomains('customers');
    });

    expect(CustomersService.getAll).toHaveBeenCalledTimes(1);
    expect(CustomersService.getAll).toHaveBeenCalledWith('store-a');
    expect(ProductsService.getAll).not.toHaveBeenCalled();
    expect(FinanceService.getTransactions).not.toHaveBeenCalled();
    expect(FinanceService.getFixedExpenses).not.toHaveBeenCalled();
    expect(SalesService.getMovements).not.toHaveBeenCalled();
    expect(SuppliersService.getAll).not.toHaveBeenCalled();
    expect(ReturnsService.getAll).not.toHaveBeenCalled();
  });

  it('deduplica domínios repetidos e atualiza somente o conjunto solicitado', async () => {
    const params = buildParams();
    const { result } = renderHook(() => useStoreData(params));

    await act(async () => {
      await result.current.refreshDomains('products', 'transactions', 'products');
    });

    expect(ProductsService.getAll).toHaveBeenCalledTimes(1);
    expect(FinanceService.getTransactions).toHaveBeenCalledTimes(1);
    expect(CustomersService.getAll).not.toHaveBeenCalled();
    expect(FinanceService.getFixedExpenses).not.toHaveBeenCalled();
    expect(SalesService.getMovements).not.toHaveBeenCalled();
    expect(SuppliersService.getAll).not.toHaveBeenCalled();
    expect(ReturnsService.getAll).not.toHaveBeenCalled();
  });

  it('mantém o refresh global para sincronização completa', async () => {
    const params = buildParams();
    const { result } = renderHook(() => useStoreData(params));

    await act(async () => {
      await result.current.refreshData();
    });

    expect(ProductsService.getAll).toHaveBeenCalledTimes(1);
    expect(FinanceService.getTransactions).toHaveBeenCalledTimes(1);
    expect(FinanceService.getFixedExpenses).toHaveBeenCalledTimes(1);
    expect(SalesService.getMovements).toHaveBeenCalledTimes(1);
    expect(CustomersService.getAll).toHaveBeenCalledTimes(1);
    expect(SuppliersService.getAll).toHaveBeenCalledTimes(1);
    expect(ReturnsService.getAll).toHaveBeenCalledTimes(1);
    expect(params.setIsLoading).toHaveBeenNthCalledWith(1, true);
    expect(params.setIsLoading).toHaveBeenLastCalledWith(false);
  });
});
