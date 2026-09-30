import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  Product,
  FinancialTransaction,
  Customer,
  Supplier,
  FixedExpense,
  SaleMovement,
  CartItem,
  ReturnRecord,
  ReturnItem,
  UserStoreAccess,
  CustomerCreditMovement
} from '../types';
import {
  INITIAL_PRODUCTS,
  INITIAL_TRANSACTIONS,
  INITIAL_MOVEMENTS,
  INITIAL_CUSTOMERS,
  INITIAL_RETURNS,
  INITIAL_SUPPLIERS,
  INITIAL_FIXED_EXPENSES,
  INITIAL_NOTIFICATIONS
} from '../data/initialData';
import { hoje } from '../lib/utils';
import { useCustomersDomain } from '../hooks/domains/useCustomersDomain';
import { useProductsDomain } from '../hooks/domains/useProductsDomain';
import { useSuppliersDomain } from '../hooks/domains/useSuppliersDomain';
import { useFinanceDomain } from '../hooks/domains/useFinanceDomain';
import { useReturnsDomain } from '../hooks/domains/useReturnsDomain';
import { useSalesDomain } from '../hooks/domains/useSalesDomain';
import { isSupabaseConfigured } from '../lib/supabase/client';
import { useStoreData } from '../hooks/useStoreData';
import { useStoreSelection } from '../hooks/useStoreSelection';
import { useStoreAuthReset } from '../hooks/useStoreAuthReset';
import { InventoryService } from '../services';
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
  setActiveStoreId: (id: string) => void;

  // Product & Inventory actions
  addProduct: (product: Omit<Product, 'id'>) => Promise<void>;
  updateProduct: (id: number, updated: Partial<Product>) => Promise<void>;
  deleteProduct: (id: number) => Promise<void>;
  registerStockEntry: (params: {
    productName: string;
    brand?: string;
    category?: string;
    price?: number;
    skuIndex: number;
    qtd: number;
    custoUnitario: number;
    newSize?: string;
    newColor?: string;
  }) => Promise<void>;

  // PDV Sale Action
  processSale: (params: {
    cartItems: CartItem[];
    buyerName: string;
    cpf: string;
    paymentMethod: string;
    installments: number;
    discountValue: number;
    discountPercent: number;
    creditUsed?: number;
  }) => Promise<{ success: boolean; message: string; totalFinal: number }>;

  // Returns & Exchanges Action
  processReturn: (params: {
    clienteNome: string;
    clienteCpf: string;
    vendaOriginalId?: string;
    itens: ReturnItem[];
    tipoResolucao: 'credito_cliente' | 'vale_troca' | 'estorno_dinheiro';
    observacoes?: string;
  }) => Promise<{ success: boolean; message: string; returnRecord: ReturnRecord }>;

  // Financial actions
  toggleExpensePaid: (id: number) => Promise<void>;

  // Customer actions
  addCustomer: (customer: Omit<Customer, 'id' | 'historico'>) => Promise<void>;
  updateCustomer: (id: number | string, data: Partial<Customer>) => Promise<void>;
  deleteCustomer: (id: number | string) => Promise<void>;

  // Supplier actions
  addSupplier: (supplier: Omit<Supplier, 'id' | 'produtos'>) => Promise<void>;
  updateSupplier: (id: number | string, data: Partial<Supplier>) => Promise<void>;
  deleteSupplier: (id: number | string) => Promise<void>;

  // Automation & Alerts
  checkAlerts: () => void;
  refreshData: () => Promise<void>;
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, session, isAuthorized, loading: authLoading } = useAuth();
  const previousUserId = useRef<string | null>(null);
  const [products, setProducts] = useState<Product[]>(() => {
    const saved = localStorage.getItem('erp_products');
    return saved ? JSON.parse(saved) : INITIAL_PRODUCTS;
  });

  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);

  const [movements, setMovements] = useState<SaleMovement[]>([]);

  const [customers, setCustomers] = useState<Customer[]>([]);

  const [returns, setReturns] = useState<ReturnRecord[]>([]);

  const [suppliers, setSuppliers] = useState<Supplier[]>(() => {
    const saved = localStorage.getItem('erp_suppliers');
    return saved ? JSON.parse(saved) : INITIAL_SUPPLIERS;
  });

  const [fixedExpenses, setFixedExpenses] = useState<FixedExpense[]>(() => {
    const saved = localStorage.getItem('erp_fixed_expenses');
    return saved ? JSON.parse(saved) : INITIAL_FIXED_EXPENSES;
  });

  const [notifications, setNotifications] = useState<string[]>(() => {
    const saved = localStorage.getItem('erp_notifications');
    return saved ? JSON.parse(saved) : INITIAL_NOTIFICATIONS;
  });


  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [userStores, setUserStores] = useState<UserStoreAccess[]>([]);

  const resetStoreState = useCallback(() => {
    setProducts([]);
    setTransactions([]);
    setMovements([]);
    setCustomers([]);
    setReturns([]);
    setSuppliers([]);
    setFixedExpenses([]);
    setNotifications([]);
    setUserStores([]);

    const keys = [
      'erp_products',
      'erp_transactions',
      'erp_movements',
      'erp_customers',
      'erp_returns',
      'erp_suppliers',
      'erp_fixed_expenses',
      'erp_notifications'
    ];

    keys.forEach(key => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });
  }, []);

  const storeSelection = useStoreSelection({
    isAuthorized,
    isSupabaseConfigured,
    remoteStores: userStores,
  });

  const activeStoreId = storeSelection.activeStoreId;
  const setActiveStoreId = storeSelection.setActiveStoreId;

  useStoreAuthReset({
    userId: user?.id,
    isAuthorized,
    resetStoreState,
  });

  // Carregar dados reais do Supabase somente depois de resolver a loja ativa.
  // Não sobrescreve dados válidos com arrays vazios causados por falta de contexto,
  // falha transitória ou consulta executada antes da definição do store_id.
  const { refreshData } = useStoreData({
    userId: user?.id,
    accessToken: session?.access_token,
    isAuthorized,
    authLoading,
    activeStoreId: storeSelection.activeStoreId,
    setActiveStoreId: storeSelection.setActiveStoreId,
    setUserStores,
    setProducts,
    setTransactions,
    setMovements,
    setCustomers,
    setReturns,
    setSuppliers,
    setFixedExpenses,
    setIsLoading,
  });

  useEffect(() => {
    if (!isAuthorized || authLoading || !session?.access_token) return;
    refreshData();
  }, [refreshData, isAuthorized, authLoading, session?.access_token]);

  // Persistência no localStorage como fallback / cache
  useEffect(() => {
    if (!isAuthorized) return;
    localStorage.setItem('erp_products', JSON.stringify(products));
  }, [isAuthorized, products]);





  useEffect(() => {
    if (!isAuthorized) return;
    localStorage.setItem('erp_suppliers', JSON.stringify(suppliers));
  }, [isAuthorized, suppliers]);

  useEffect(() => {
    if (!isAuthorized) return;
    localStorage.setItem('erp_fixed_expenses', JSON.stringify(fixedExpenses));
  }, [isAuthorized, fixedExpenses]);


  useEffect(() => {
    if (!isAuthorized) return;
    localStorage.setItem('erp_notifications', JSON.stringify(notifications));
  }, [isAuthorized, notifications]);

  const customersDomain = useCustomersDomain(customers, setCustomers, activeStoreId, refreshData);

  const { addProduct, updateProduct, deleteProduct } = useProductsDomain({
    products,
    setProducts,
    activeStoreId,
    refreshData,
    isSupabaseConfigured,
  });

  const suppliersDomain = useSuppliersDomain(suppliers, setSuppliers, refreshData);
  const financeDomain = useFinanceDomain(fixedExpenses, setFixedExpenses);

  const registerStockEntry = async (params: {
    productName: string;
    brand?: string;
    category?: string;
    price?: number;
    skuIndex: number;
    qtd: number;
    custoUnitario: number;
    newSize?: string;
    newColor?: string;
  }) => {
    if (isSupabaseConfigured) {
      if (!activeStoreId) {
        console.error('Nenhuma loja ativa selecionada.');
        return;
      }
      try {
        await InventoryService.registerStockEntry({
          ...params,
          storeId: activeStoreId
        });
        await refreshData();
        return;
      } catch (err) {
        console.error('Erro ao registrar entrada de estoque no Supabase:', err);
        throw err;
      }
    }

    // Fallback local
    const existing = products.find(p => p.nome.toLowerCase() === params.productName.toLowerCase());
    const currentDate = hoje();

    if (existing) {
      setProducts(prev =>
        prev.map(p => {
          if (p.id !== existing.id) return p;
          const updatedSkus = [...p.skus];
          if (params.skuIndex >= 0 && params.skuIndex < updatedSkus.length) {
            updatedSkus[params.skuIndex] = {
              ...updatedSkus[params.skuIndex],
              qtd: updatedSkus[params.skuIndex].qtd + params.qtd
            };
          } else {
            updatedSkus.push({
              tamanho: params.newSize || 'Único',
              cor: params.newColor || 'Padrão',
              qtd: params.qtd
            });
          }
          return { ...p, skus: updatedSkus };
        })
      );
    } else {
      const newId = products.reduce((max, p) => Math.max(max, p.id), 0) + 1;
      const newProd: Product = {
        id: newId,
        nome: params.productName,
        marca: params.brand || 'Genérica',
        categoria: params.category || 'Geral',
        preco: params.price || 0,
        skus: [{ tamanho: params.newSize || 'Único', cor: params.newColor || 'Padrão', qtd: params.qtd }]
      };
      setProducts(prev => [...prev, newProd]);
    }

    const newTransId = transactions.reduce((max, t) => Math.max(max, t.id), 0) + 1;
    setTransactions(prev => [
      ...prev,
      {
        id: newTransId,
        tipo: 'EXPENSE',
        descricao: `Entrada ${params.productName}`,
        valor: params.custoUnitario * params.qtd,
        data: currentDate
      }
    ]);
  };

  const checkAlerts = () => {
    const alerts: string[] = [];
    products.forEach(p => {
      p.skus.forEach(s => {
        if (s.qtd <= 2 && s.qtd > 0) {
          alerts.push(`${p.nome} (${s.tamanho}/${s.cor}) - Baixo estoque: ${s.qtd} und`);
        } else if (s.qtd === 0) {
          alerts.push(`${p.nome} (${s.tamanho}/${s.cor}) - ESGOTADO`);
        }
      });
    });

    fixedExpenses
      .filter(d => !d.pago)
      .forEach(d => {
        const diffDays = Math.ceil(
          (new Date(d.dataVencimento).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
        );
        if (diffDays <= 3 && diffDays >= 0) {
          alerts.push(`💰 ${d.descricao} vence em ${diffDays} dias - R$ ${d.valor.toFixed(2)}`);
        }
      });

    setNotifications(prev => Array.from(new Set([...prev, ...alerts])));
  };

  const processSale = useSalesDomain({
    activeStoreId,
    isSupabaseConfigured,
    movements,
    transactions,
    setProducts,
    setMovements,
    setCustomers,
    setTransactions,
    checkAlerts,
    refreshData,
  }).processSale;


  const processReturn = useReturnsDomain({
    activeStoreId,
    isSupabaseConfigured,
    returns,
    setReturns,
    setProducts,
    refreshData,
  }).processReturn;


  return (
    <StoreContext.Provider
      value={{
        products,
        transactions,
        movements,
        customers,
        returns,
        suppliers,
        fixedExpenses,
        notifications,
        isLoading,
        userStores,
        activeStoreId,
        setActiveStoreId,
        addProduct,
        updateProduct,
        deleteProduct,
        registerStockEntry,
        processSale,
        processReturn,
        toggleExpensePaid: financeDomain.toggleExpensePaid,
        addCustomer: customersDomain.addCustomer,
        updateCustomer: customersDomain.updateCustomer,
        deleteCustomer: customersDomain.deleteCustomer,
        addSupplier: suppliersDomain.addSupplier,
        updateSupplier: suppliersDomain.updateSupplier,
        deleteSupplier: suppliersDomain.deleteSupplier,
        checkAlerts,
        refreshData
      }}
    >
      {children}
    </StoreContext.Provider>
  );
};

export const useStore = () => {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStore must be used within StoreProvider');
  return context;
};