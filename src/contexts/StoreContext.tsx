import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Product, FinancialTransaction, Customer, Supplier, FixedExpense, SaleMovement, CartItem, ReturnRecord, ReturnItem, UserStoreAccess } from '../types';
import type { UserRole } from '../types/database';
import { INITIAL_PRODUCTS, INITIAL_SUPPLIERS, INITIAL_FIXED_EXPENSES, INITIAL_NOTIFICATIONS } from '../data/initialData';
import { useCustomersDomain } from '../hooks/domains/useCustomersDomain';
import { useProductsDomain } from '../hooks/domains/useProductsDomain';
import { useSuppliersDomain } from '../hooks/domains/useSuppliersDomain';
import { useFinanceDomain } from '../hooks/domains/useFinanceDomain';
import { useReturnsDomain } from '../hooks/domains/useReturnsDomain';
import { useSalesDomain } from '../hooks/domains/useSalesDomain';
import { useInventoryDomain } from '../hooks/domains/useInventoryDomain';
import { useInventoryAlerts } from '../hooks/domains/useInventoryAlerts';
import { useStoreData } from '../hooks/useStoreData';
import { useStoreSelection } from '../hooks/useStoreSelection';
import { useStoreAuthReset } from '../hooks/useStoreAuthReset';
import { isSupabaseConfigured } from '../lib/supabase/client';
import { useAuth } from './AuthContext';

interface StoreContextType {
  products: Product[];
  transactions: FinancialTransaction[];
  movements: SaleMovement[];
  customers: Customer[];
  returns: ReturnRecord[];
  suppliers: Supplier[];
  fixedExpenses: FixedExpense[];
  notifications: string[];
  isLoading: boolean;
  userStores: UserStoreAccess[];
  activeStoreId: string | null;
  activeStoreRole: UserRole | null;
  setActiveStoreId: (id: string) => void;
  addProduct: (product: Omit<Product, 'id'>) => Promise<void>;
  updateProduct: (id: number, updated: Partial<Product>) => Promise<void>;
  deleteProduct: (id: number) => Promise<void>;
  registerStockEntry: (params: { productName: string; brand?: string; category?: string; price?: number; skuIndex: number; qtd: number; custoUnitario: number; newSize?: string; newColor?: string; }) => Promise<void>;
  processSale: (params: { cartItems: CartItem[]; buyerName: string; cpf: string; customerId?: string; paymentMethod: string; installments: number; discountValue: number; discountPercent: number; creditUsed?: number; }) => Promise<{ success: boolean; message: string; totalFinal: number }>;
  processReturn: (params: { clienteNome: string; clienteCpf: string; vendaOriginalId?: string; itens: ReturnItem[]; tipoResolucao: 'credito_cliente' | 'vale_troca' | 'estorno_dinheiro'; observacoes?: string; }) => Promise<{ success: boolean; message: string; returnRecord: ReturnRecord }>;
  toggleExpensePaid: (id: number) => Promise<void>;
  addCustomer: (customer: Omit<Customer, 'id' | 'historico'>) => Promise<void>;
  updateCustomer: (id: number | string, data: Partial<Customer>) => Promise<void>;
  deleteCustomer: (id: number | string) => Promise<void>;
  addSupplier: (supplier: Omit<Supplier, 'id' | 'produtos'>) => Promise<void>;
  updateSupplier: (id: number | string, data: Partial<Supplier>) => Promise<void>;
  deleteSupplier: (id: number | string) => Promise<void>;
  checkAlerts: () => void;
  refreshData: () => Promise<void>;
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, session, stores: authorizedStores, isAuthorized, loading: authLoading } = useAuth();
  const [products, setProducts] = useState<Product[]>(() => { if (isSupabaseConfigured) return []; const saved = localStorage.getItem('erp_products'); return saved ? JSON.parse(saved) : INITIAL_PRODUCTS; });
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [movements, setMovements] = useState<SaleMovement[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => { if (isSupabaseConfigured) return []; const saved = localStorage.getItem('erp_suppliers'); return saved ? JSON.parse(saved) : INITIAL_SUPPLIERS; });
  const [fixedExpenses, setFixedExpenses] = useState<FixedExpense[]>(() => { if (isSupabaseConfigured) return []; const saved = localStorage.getItem('erp_fixed_expenses'); return saved ? JSON.parse(saved) : INITIAL_FIXED_EXPENSES; });
  const [notifications, setNotifications] = useState<string[]>(() => { if (isSupabaseConfigured) return []; const saved = localStorage.getItem('erp_notifications'); return saved ? JSON.parse(saved) : INITIAL_NOTIFICATIONS; });
  const [isLoading, setIsLoading] = useState(false);
  const userStores: UserStoreAccess[] = authorizedStores;
  const resetStoreState = useCallback(() => {
    setProducts([]); setTransactions([]); setMovements([]); setCustomers([]); setReturns([]); setSuppliers([]); setFixedExpenses([]); setNotifications([]); setIsLoading(false);
    ['erp_products','erp_transactions','erp_movements','erp_customers','erp_returns','erp_suppliers','erp_fixed_expenses','erp_notifications'].forEach(key => { localStorage.removeItem(key); sessionStorage.removeItem(key); });
  }, []);

  const { activeStoreId, setActiveStoreId } = useStoreSelection({ isAuthorized, isSupabaseConfigured, remoteStores: userStores });
  const activeStoreRole = useMemo<UserRole | null>(
    () => (userStores.find(store => store.store_id === activeStoreId)?.role as UserRole | undefined) ?? null,
    [activeStoreId, userStores]
  );
  useStoreAuthReset({ userId: user?.id, isAuthorized, resetStoreState });
  const { refreshData, refreshDomains } = useStoreData({
    userId: user?.id, accessToken: session?.access_token, isAuthorized, authLoading,
    activeStoreId, setProducts, setTransactions,
    setMovements, setCustomers, setReturns, setSuppliers, setFixedExpenses, setIsLoading,
  });

  const previousStoreIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeStoreId || previousStoreIdRef.current === activeStoreId) return;

    setProducts([]);
    setTransactions([]);
    setMovements([]);
    setCustomers([]);
    setReturns([]);
    setFixedExpenses([]);
    setNotifications([]);
    previousStoreIdRef.current = activeStoreId;
  }, [activeStoreId]);

  const refreshDataRef = useRef(refreshData);

  useEffect(() => {
    refreshDataRef.current = refreshData;
  }, [refreshData]);

  useEffect(() => {
    if (!isAuthorized || authLoading || !session?.access_token) return;
    void refreshDataRef.current();
  }, [activeStoreId, authLoading, isAuthorized, session?.access_token, user?.id]);

  useEffect(() => { if (isAuthorized) localStorage.setItem('erp_products', JSON.stringify(products)); }, [isAuthorized, products]);
  useEffect(() => { if (isAuthorized) localStorage.setItem('erp_suppliers', JSON.stringify(suppliers)); }, [isAuthorized, suppliers]);
  useEffect(() => { if (isAuthorized) localStorage.setItem('erp_fixed_expenses', JSON.stringify(fixedExpenses)); }, [isAuthorized, fixedExpenses]);
  useEffect(() => { if (isAuthorized) localStorage.setItem('erp_notifications', JSON.stringify(notifications)); }, [isAuthorized, notifications]);

  const customersDomain = useCustomersDomain(customers, setCustomers, activeStoreId);
  const productsDomain = useProductsDomain({ products, setProducts, activeStoreId, refreshDomains, isSupabaseConfigured });
  const suppliersDomain = useSuppliersDomain(suppliers, setSuppliers, refreshDomains);
  const financeDomain = useFinanceDomain(fixedExpenses, setFixedExpenses);
  const inventoryDomain = useInventoryDomain({ products, transactions, setProducts, setTransactions, activeStoreId, refreshDomains, isSupabaseConfigured });
  const alertsDomain = useInventoryAlerts({ products, fixedExpenses, setNotifications });
  const { processSale } = useSalesDomain({ activeStoreId, isSupabaseConfigured, movements, transactions, setProducts, setMovements, setCustomers, setTransactions, checkAlerts: alertsDomain.checkAlerts, refreshDomains });
  const { processReturn } = useReturnsDomain({ activeStoreId, isSupabaseConfigured, returns, setReturns, setProducts, refreshDomains });

  return (
    <StoreContext.Provider value={{
      products, transactions, movements, customers, returns, suppliers, fixedExpenses, notifications,
      isLoading, userStores, activeStoreId, activeStoreRole, setActiveStoreId,
      addProduct: productsDomain.addProduct,
      updateProduct: productsDomain.updateProduct,
      deleteProduct: productsDomain.deleteProduct,
      registerStockEntry: inventoryDomain.registerStockEntry,
      processSale, processReturn,
      toggleExpensePaid: financeDomain.toggleExpensePaid,
      addCustomer: customersDomain.addCustomer,
      updateCustomer: customersDomain.updateCustomer,
      deleteCustomer: customersDomain.deleteCustomer,
      addSupplier: suppliersDomain.addSupplier,
      updateSupplier: suppliersDomain.updateSupplier,
      deleteSupplier: suppliersDomain.deleteSupplier,
      checkAlerts: alertsDomain.checkAlerts,
      refreshData,
    }}>
      {children}
    </StoreContext.Provider>
  );
};

export const useStore = () => {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStore must be used within StoreProvider');
  return context;
};
