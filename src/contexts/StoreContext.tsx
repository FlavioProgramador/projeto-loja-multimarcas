import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
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
import { supabase, isSupabaseConfigured } from '../lib/supabase/client';
import {
  ProductsService,
  InventoryService,
  CustomersService,
  SuppliersService,
  FinanceService
} from '../services';
import { ReturnsService } from '../services/returns.service';
import { storeService } from '../services/store.service';
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
  const [activeStoreId, setActiveStoreId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthorized) {
      setProducts([]);
      setTransactions([]);
      setMovements([]);
      setCustomers([]);
      setReturns([]);
      setSuppliers([]);
      setFixedExpenses([]);
      setNotifications([]);
      setUserStores([]);
      setActiveStoreId(null);

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
      previousUserId.current = null;
      return;
    }

    if (previousUserId.current && previousUserId.current !== user?.id) {
      setProducts([]);
      setTransactions([]);
      setMovements([]);
      setCustomers([]);
      setReturns([]);
      setSuppliers([]);
      setFixedExpenses([]);
      setNotifications([]);
      setUserStores([]);
      setActiveStoreId(null);

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
    }

    previousUserId.current = user?.id ?? null;
  }, [isAuthorized, user?.id]);

  // Carregar dados reais do Supabase somente depois de resolver a loja ativa.
  // Não sobrescreve dados válidos com arrays vazios causados por falta de contexto,
  // falha transitória ou consulta executada antes da definição do store_id.
  const refreshData = useCallback(async () => {
    if (!isSupabaseConfigured || !isAuthorized || authLoading || !session?.access_token) return;

    try {
      setIsLoading(true);

      // O Supabase Auth mantém a sessão no storage customizado. Exigir uma
      // sessão válida antes das consultas evita que o RLS devolva [] para o
      // papel anon durante a transição de autenticação.
      const { data: { session: verifiedSession }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!verifiedSession?.access_token || verifiedSession.user.id !== user?.id) {
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
        ReturnsService.getAll(resolvedStoreId)
      ]);

      const applyResult = <T,>(
        result: PromiseSettledResult<T>,
        setter: (value: T) => void,
        source: string
      ) => {
        if (result.status === 'fulfilled') {
          setter(result.value);
        } else {
          console.warn('Falha ao carregar ' + source + '; mantendo dados atuais.', result.reason);
        }
      };

      // Uma falha isolada não pode zerar ou bloquear os demais módulos.
      applyResult(results[0], setProducts, 'produtos/estoque');
      applyResult(results[1], setTransactions, 'financeiro');
      applyResult(results[2], setFixedExpenses, 'despesas fixas');
      applyResult(results[3], setMovements, 'vendas do PDV');
      applyResult(results[4], setCustomers, 'clientes');
      applyResult(results[5], setSuppliers, 'fornecedores');
      applyResult(results[6], setReturns, 'devoluções');
    } catch (err) {
      console.warn('Sincronização com Supabase falhou; mantendo estado atual.', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeStoreId, isAuthorized, authLoading, session?.access_token, user?.id]);

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