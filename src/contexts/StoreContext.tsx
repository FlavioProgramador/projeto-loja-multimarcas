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
import { isSupabaseConfigured } from '../lib/supabase/client';
import {
  ProductsService,
  InventoryService,
  SalesService,
  CustomersService,
  SuppliersService,
  FinanceService
} from '../services';
import { storeService } from '../services/store.service';

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
  updateCustomer: (id: number | string, data: Partial<Customer>) => void;
  deleteCustomer: (id: number | string) => void;

  // Supplier actions
  addSupplier: (supplier: Omit<Supplier, 'id' | 'produtos'>) => Promise<void>;

  // Automation & Alerts
  checkAlerts: () => void;
  refreshData: () => Promise<void>;
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [products, setProducts] = useState<Product[]>(() => {
    const saved = localStorage.getItem('erp_products');
    return saved ? JSON.parse(saved) : INITIAL_PRODUCTS;
  });

  const [transactions, setTransactions] = useState<FinancialTransaction[]>(() => {
    const saved = localStorage.getItem('erp_transactions');
    return saved ? JSON.parse(saved) : INITIAL_TRANSACTIONS;
  });

  const [movements, setMovements] = useState<SaleMovement[]>(() => {
    const saved = localStorage.getItem('erp_movements');
    return saved ? JSON.parse(saved) : INITIAL_MOVEMENTS;
  });

  const [customers, setCustomers] = useState<Customer[]>(() => {
    const saved = localStorage.getItem('erp_customers');
    return saved ? JSON.parse(saved) : INITIAL_CUSTOMERS;
  });

  const [returns, setReturns] = useState<ReturnRecord[]>(() => {
    const saved = localStorage.getItem('erp_returns');
    return saved ? JSON.parse(saved) : INITIAL_RETURNS;
  });

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

  // Carregar dados reais do Supabase na inicialização
  const refreshData = useCallback(async () => {
    if (!isSupabaseConfigured) return;

    try {
      setIsLoading(true);
      const [
        remoteProducts,
        remoteTransactions,
        remoteExpenses,
        remoteMovements,
        remoteCustomers,
        remoteSuppliers,
        remoteStores
      ] = await Promise.all([
        ProductsService.getAll(activeStoreId || undefined),
        FinanceService.getTransactions(activeStoreId || undefined),
        FinanceService.getFixedExpenses(activeStoreId || undefined),
        SalesService.getMovements(activeStoreId || undefined),
        CustomersService.getAll(),
        SuppliersService.getAll(),
        storeService.getUserStores().catch(() => [])
      ]);

      if (remoteStores && remoteStores.length > 0) {
        setUserStores(remoteStores);
        if (!activeStoreId || !remoteStores.find(s => s.store_id === activeStoreId)) {
          setActiveStoreId(remoteStores[0].store_id);
        }
      }

      if (remoteProducts) {
        setProducts(remoteProducts);
      }
      if (remoteTransactions) {
        setTransactions(remoteTransactions);
      }
      if (remoteExpenses) {
        setFixedExpenses(remoteExpenses);
      }
      if (remoteMovements) {
        setMovements(remoteMovements);
      }
      if (remoteCustomers) {
        setCustomers(remoteCustomers);
      }
      if (remoteSuppliers) {
        setSuppliers(remoteSuppliers);
      }
    } catch (err) {
      console.warn('Sincronização com Supabase: mantendo cache local.', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeStoreId]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Persistência no localStorage como fallback / cache
  useEffect(() => {
    localStorage.setItem('erp_products', JSON.stringify(products));
  }, [products]);

  useEffect(() => {
    localStorage.setItem('erp_transactions', JSON.stringify(transactions));
  }, [transactions]);

  useEffect(() => {
    localStorage.setItem('erp_movements', JSON.stringify(movements));
  }, [movements]);

  useEffect(() => {
    localStorage.setItem('erp_customers', JSON.stringify(customers));
  }, [customers]);

  useEffect(() => {
    localStorage.setItem('erp_returns', JSON.stringify(returns));
  }, [returns]);

  useEffect(() => {
    localStorage.setItem('erp_suppliers', JSON.stringify(suppliers));
  }, [suppliers]);

  useEffect(() => {
    localStorage.setItem('erp_fixed_expenses', JSON.stringify(fixedExpenses));
  }, [fixedExpenses]);


  useEffect(() => {
    localStorage.setItem('erp_notifications', JSON.stringify(notifications));
  }, [notifications]);

  // Product methods
  const addProduct = async (prodData: Omit<Product, 'id'>) => {
    const newId = products.reduce((max, p) => Math.max(max, p.id), 0) + 1;
    const newProd: Product = { id: newId, ...prodData };
    setProducts(prev => [...prev, newProd]);

    if (isSupabaseConfigured) {
      try {
        await ProductsService.create(prodData);
        await refreshData();
      } catch (err) {
        console.error('Erro ao salvar produto no Supabase:', err);
      }
    }
  };

  const updateProduct = async (id: number, updated: Partial<Product>) => {
    setProducts(prev => prev.map(p => (p.id === id ? { ...p, ...updated } : p)));

    if (isSupabaseConfigured) {
      const targetProd = products.find(p => p.id === id);
      if (targetProd?.uuid) {
        try {
          await ProductsService.update(targetProd.uuid, updated);
          await refreshData();
        } catch (err) {
          console.error('Erro ao atualizar produto no Supabase:', err);
        }
      }
    }
  };

  const deleteProduct = async (id: number) => {
    const targetProd = products.find(p => p.id === id);
    setProducts(prev => prev.filter(p => p.id !== id));

    if (isSupabaseConfigured && targetProd?.uuid) {
      try {
        await ProductsService.remove(targetProd.uuid);
        await refreshData();
      } catch (err) {
        console.error('Erro ao remover produto no Supabase:', err);
      }
    }
  };

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

  const processSale = async ({
    cartItems,
    buyerName,
    cpf,
    paymentMethod,
    installments,
    discountValue,
    discountPercent,
    creditUsed = 0
  }: {
    cartItems: CartItem[];
    buyerName: string;
    cpf: string;
    paymentMethod: string;
    installments: number;
    discountValue: number;
    discountPercent: number;
    creditUsed?: number;
  }) => {
    if (cartItems.length === 0) {
      return { success: false, message: 'Carrinho vazio', totalFinal: 0 };
    }

    // Se o Supabase estiver configurado e os itens tiverem UUIDs, processar atomicamente via RPC complete_sale
    if (isSupabaseConfigured) {
      if (!activeStoreId) {
        return { success: false, message: 'Nenhuma loja ativa selecionada', totalFinal: 0 };
      }
      const hasVariantIds = cartItems.every(item => item.variantId);
      if (hasVariantIds) {
        const idempotencyKey = crypto.randomUUID();
        const rpcResult = await SalesService.completeSale({
          storeId: activeStoreId,
          cartItems,
          buyerName,
          cpf,
          paymentMethod,
          installments,
          discountValue: discountValue + creditUsed,
          discountPercent,
          idempotencyKey
        });

        if (rpcResult.success) {
          // Se houve crédito usado, abater do cliente localmente também
          if (creditUsed > 0) {
            setCustomers(prev =>
              prev.map(c =>
                c.cpf === cpf || c.nome.toLowerCase() === buyerName.toLowerCase()
                  ? {
                    ...c,
                    saldoCredito: Math.max(0, (c.saldoCredito || 0) - creditUsed)
                  }
                  : c
              )
            );
          }
          await refreshData();
          return {
            success: true,
            message: 'Venda processada atomicamente no Supabase com sucesso!',
            totalFinal: rpcResult.totalFinal
          };
        } else {
          return {
            success: false,
            message: rpcResult.message || 'Falha ao processar venda no banco de dados.',
            totalFinal: 0
          };
        }
      }
    }

    // Operações críticas não podem cair silenciosamente para o navegador quando o backend está configurado.
    // O fallback local continua disponível apenas para o modo explicitamente offline/local.
    if (isSupabaseConfigured) {
      return {
        success: false,
        message: 'Não foi possível concluir a venda no servidor. A operação não foi registrada localmente.',
        totalFinal: 0
      };
    }

    // Processamento Local / Fallback
    const subtotal = cartItems.reduce((acc, item) => acc + item.preco * item.qtd, 0);
    const discountTotal = discountValue + subtotal * (discountPercent / 100);
    const totalFinal = Math.max(0, subtotal - discountTotal - creditUsed);

    const nextVendaNum = movements.length + 1004;
    const vendaIdFormatted = `PDV #${nextVendaNum}`;
    const currentDate = hoje();
    const resolvedName = buyerName.trim() || 'Cliente não identificado';
    const resolvedCpf = cpf.trim() || 'Não informado';

    let paymentFormatted = paymentMethod;
    if (paymentMethod === 'Cartão' && installments > 1) {
      paymentFormatted += ` ${installments}x`;
    }
    if (creditUsed > 0) {
      paymentFormatted += ` (Abatido R$ ${creditUsed.toFixed(2)} de Crédito)`;
    }

    // Deduct stock from products
    setProducts(prev =>
      prev.map(prod => {
        const matchingItems = cartItems.filter(item => item.produtoId === prod.id);
        if (matchingItems.length === 0) return prod;

        const updatedSkus = prod.skus.map((sku, sIdx) => {
          const cartItemMatch = matchingItems.find(item => item.skuIndex === sIdx);
          if (!cartItemMatch) return sku;
          return {
            ...sku,
            qtd: Math.max(0, sku.qtd - cartItemMatch.qtd)
          };
        });

        return { ...prod, skus: updatedSkus };
      })
    );

    // Add movement
    const nextMovId = movements.reduce((max, m) => Math.max(max, m.id), 0) + 1;
    const newMovement: SaleMovement = {
      id: nextMovId,
      tipo: 'EXPENSE',
      valor: totalFinal,
      formaPagamento: paymentFormatted,
      comprador: resolvedName,
      cpf: resolvedCpf,
      produtos: cartItems.map(i => `${i.nome} (${i.tamanho}/${i.cor}) x${i.qtd}`).join(', '),
      data: currentDate,
      vendaId: vendaIdFormatted,
      creditoUtilizado: creditUsed
    };
    setMovements(prev => [newMovement, ...prev]);

    // Update customer history and deduct store credit if used
    setCustomers(prev => {
      const existingCustomer =
        prev.find(c => c.cpf === resolvedCpf && resolvedCpf !== 'Não informado') ||
        prev.find(c => c.nome.toLowerCase() === resolvedName.toLowerCase());

      const purchaseRecord = {
        vendaId: vendaIdFormatted,
        valor: totalFinal,
        data: currentDate,
        itens: cartItems.map(i => `${i.nome} x${i.qtd}`).join(', ')
      };

      const creditDebitMovement = creditUsed > 0
        ? [{
          id: Date.now(),
          tipo: 'saida' as const,
          valor: creditUsed,
          descricao: `Uso de crédito na Venda ${vendaIdFormatted}`,
          data: currentDate,
          referenciaId: vendaIdFormatted
        }]
        : [];

      if (existingCustomer) {
        return prev.map(c =>
          c.id === existingCustomer.id
            ? {
              ...c,
              saldoCredito: Math.max(0, (c.saldoCredito || 0) - creditUsed),
              historico: [purchaseRecord, ...c.historico],
              movimentacoesCredito: [
                ...creditDebitMovement,
                ...(c.movimentacoesCredito || [])
              ]
            }
            : c
        );
      } else if (resolvedName !== 'Cliente não identificado') {
        const nextCustId = prev.reduce((max, c) => Math.max(max, c.id), 0) + 1;
        return [
          ...prev,
          {
            id: nextCustId,
            nome: resolvedName,
            cpf: resolvedCpf,
            telefone: '',
            email: '',
            endereco: '',
            saldoCredito: 0,
            historico: [purchaseRecord],
            movimentacoesCredito: creditDebitMovement
          }
        ];
      }
      return prev;
    });

    // Add financial entry transaction
    if (totalFinal > 0) {
      const nextTransId = transactions.reduce((max, t) => Math.max(max, t.id), 0) + 1;
      setTransactions(prev => [
        {
          id: nextTransId,
          tipo: 'INCOME',
          descricao: `Venda ${vendaIdFormatted}`,
          valor: totalFinal,
          data: currentDate
        },
        ...prev
      ]);
    }

    // Check low stock notifications
    checkAlerts();

    return { success: true, message: 'Venda realizada com sucesso!', totalFinal };
  };

  const processReturn = async ({
    clienteNome,
    clienteCpf,
    vendaOriginalId,
    itens,
    tipoResolucao,
    observacoes
  }: {
    clienteNome: string;
    clienteCpf: string;
    vendaOriginalId?: string;
    itens: ReturnItem[];
    tipoResolucao: 'credito_cliente' | 'vale_troca' | 'estorno_dinheiro';
    observacoes?: string;
  }) => {
    const totalReturnAmount = itens.reduce((sum, item) => sum + item.precoUnitario * item.qtd, 0);
    const returnIdNum = returns.length + 1001;
    const returnCode = `DEV-${returnIdNum}`;
    const currentDate = hoje();
    const resolvedName = clienteNome.trim() || 'Consumidor Final';
    const resolvedCpf = clienteCpf.trim() || 'Não informado';

    // 1. Aumentar o estoque físico dos SKUs devolvidos
    setProducts(prev =>
      prev.map(prod => {
        const returnedForThisProd = itens.filter(
          i => i.produtoId === prod.id || (prod.uuid && i.productUuid === prod.uuid)
        );
        if (returnedForThisProd.length === 0) return prod;

        const updatedSkus = prod.skus.map(sku => {
          const matchItem = returnedForThisProd.find(
            i =>
              i.tamanho.trim().toLowerCase() === sku.tamanho.trim().toLowerCase() &&
              i.cor.trim().toLowerCase() === sku.cor.trim().toLowerCase()
          );
          if (!matchItem) return sku;
          return {
            ...sku,
            qtd: sku.qtd + matchItem.qtd
          };
        });

        return { ...prod, skus: updatedSkus };
      })
    );

    // 2. Criar registro da devolução
    const newReturnRecord: ReturnRecord = {
      id: returnIdNum,
      codigo: returnCode,
      data: currentDate,
      vendaOriginalId,
      clienteNome: resolvedName,
      clienteCpf: resolvedCpf,
      itens,
      valorTotal: totalReturnAmount,
      tipoResolucao,
      status: 'CONCLUIDO',
      dataValidade: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      observacoes:
        observacoes ||
        (tipoResolucao === 'estorno_dinheiro'
          ? 'Estorno em dinheiro ao cliente'
          : 'Crédito/Vale gerado para abatimento em futuras compras')
    };

    setReturns(prev => [newReturnRecord, ...prev]);

    // 3. Atualizar saldo de crédito do cliente
    if (tipoResolucao === 'credito_cliente' || tipoResolucao === 'vale_troca') {
      setCustomers(prev => {
        const existingCustomer =
          prev.find(c => resolvedCpf !== 'Não informado' && c.cpf === resolvedCpf) ||
          prev.find(c => c.nome.toLowerCase() === resolvedName.toLowerCase());

        const creditMovement: CustomerCreditMovement = {
          id: Date.now(),
          tipo: 'entrada',
          valor: totalReturnAmount,
          descricao: `Crédito gerado pela Devolução #${returnCode}`,
          data: currentDate,
          referenciaId: returnCode
        };

        if (existingCustomer) {
          return prev.map(c =>
            c.id === existingCustomer.id
              ? {
                ...c,
                saldoCredito: (c.saldoCredito || 0) + totalReturnAmount,
                movimentacoesCredito: [
                  creditMovement,
                  ...(c.movimentacoesCredito || [])
                ]
              }
              : c
          );
        } else if (resolvedName !== 'Consumidor Final' && resolvedName !== 'Cliente não identificado') {
          const nextCustId = prev.reduce((max, c) => Math.max(max, c.id), 0) + 1;
          return [
            ...prev,
            {
              id: nextCustId,
              nome: resolvedName,
              cpf: resolvedCpf,
              rg: '',
              telefone: '',
              email: '',
              endereco: '',
              dataNascimento: '',
              saldoCredito: totalReturnAmount,
              historico: [],
              movimentacoesCredito: [creditMovement]
            }
          ];
        }
        return prev;
      });
    } else if (tipoResolucao === 'estorno_dinheiro') {
      // Registrar saída financeira de estorno
      const nextTransId = transactions.reduce((max, t) => Math.max(max, t.id), 0) + 1;
      setTransactions(prev => [
        {
          id: nextTransId,
          tipo: 'EXPENSE',
          descricao: `Estorno Devolução #${returnCode}`,
          valor: totalReturnAmount,
          data: currentDate
        },
        ...prev
      ]);
    }

    setNotifications(prev => [
      `🔄 Devolução #${returnCode} registrada. Estoque reabastecido e crédito de R$ ${totalReturnAmount.toFixed(2)} gerado.`,
      ...prev
    ]);

    return {
      success: true,
      message: `Troca/Devolução #${returnCode} processada com sucesso!`,
      returnRecord: newReturnRecord
    };
  };

  const toggleExpensePaid = async (id: number) => {
    const exp = fixedExpenses.find(e => e.id === id);
    if (!exp) return;

    setFixedExpenses(prev =>
      prev.map(e => (e.id === id ? { ...e, pago: !e.pago } : e))
    );

    if (isSupabaseConfigured && exp.uuid) {
      await FinanceService.toggleExpensePaid(exp.uuid, exp.pago);
    }
  };

  const addCustomer = async (data: Omit<Customer, 'id' | 'historico'>) => {
    const nextId = customers.reduce((max, c) => Math.max(max, c.id), 0) + 1;
    setCustomers(prev => [...prev, { id: nextId, ...data, saldoCredito: 0, historico: [] }]);

    if (isSupabaseConfigured) {
      try {
        await CustomersService.create(data);
        await refreshData();
      } catch (err) {
        console.error('Erro ao adicionar cliente no Supabase:', err);
      }
    }
  };

  const updateCustomer = (id: number | string, data: Partial<Customer>) => {
    setCustomers(prev =>
      prev.map(c => (String(c.id) === String(id) ? { ...c, ...data } : c))
    );
  };

  const deleteCustomer = (id: number | string) => {
    setCustomers(prev => prev.filter(c => String(c.id) !== String(id)));
  };

  const addSupplier = async (data: Omit<Supplier, 'id' | 'produtos'>) => {
    const nextId = suppliers.reduce((max, s) => Math.max(max, s.id), 0) + 1;
    setSuppliers(prev => [...prev, { id: nextId, ...data, produtos: [] }]);

    if (isSupabaseConfigured) {
      try {
        await SuppliersService.create(data);
        await refreshData();
      } catch (err) {
        console.error('Erro ao adicionar fornecedor no Supabase:', err);
      }
    }
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
        toggleExpensePaid,
        addCustomer,
        updateCustomer,
        deleteCustomer,
        addSupplier,
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