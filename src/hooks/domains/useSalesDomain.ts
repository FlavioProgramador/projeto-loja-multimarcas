import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { SalesService } from '../../services';
import { CartItem, Customer, FinancialTransaction, Product, SaleMovement } from '../../types';
import { hoje } from '../../lib/utils';
import { generateIdempotencyKey } from '../../lib/idempotency';
import type { RefreshDomains } from '../useStoreData';

type SaleParams = {
  cartItems: CartItem[];
  buyerName: string;
  cpf: string;
  paymentMethod: string;
  installments: number;
  discountValue: number;
  discountPercent: number;
  creditUsed?: number;
};

type SalesDomainArgs = {
  activeStoreId: string | null;
  isSupabaseConfigured: boolean;
  movements: SaleMovement[];
  transactions: FinancialTransaction[];
  setProducts: Dispatch<SetStateAction<Product[]>>;
  setMovements: Dispatch<SetStateAction<SaleMovement[]>>;
  setCustomers: Dispatch<SetStateAction<Customer[]>>;
  setTransactions: Dispatch<SetStateAction<FinancialTransaction[]>>;
  checkAlerts: () => void;
  refreshDomains: RefreshDomains;
};

type SaleResult = { success: boolean; message: string; totalFinal: number };

export function useSalesDomain({
  activeStoreId,
  isSupabaseConfigured,
  movements,
  transactions,
  setProducts,
  setMovements,
  setCustomers,
  setTransactions,
  checkAlerts,
  refreshDomains,
}: SalesDomainArgs) {
  const processSale = useCallback(async ({
    cartItems, buyerName, cpf, paymentMethod, installments,
    discountValue, discountPercent, creditUsed = 0,
  }: SaleParams): Promise<SaleResult> => {
    if (cartItems.length === 0) {
      return { success: false, message: 'Carrinho vazio', totalFinal: 0 };
    }

    if (isSupabaseConfigured) {
      if (!activeStoreId) {
        return { success: false, message: 'Nenhuma loja ativa selecionada', totalFinal: 0 };
      }

      if (cartItems.every(item => item.variantId)) {
        const rpcResult = await SalesService.completeSale({
          storeId: activeStoreId, cartItems, buyerName, cpf, paymentMethod,
          installments, discountValue: discountValue + creditUsed,
          discountPercent, idempotencyKey: generateIdempotencyKey(),
        });

        if (rpcResult.success) {
          if (creditUsed > 0) {
            setCustomers(prev => prev.map(c =>
              c.cpf === cpf || c.nome.toLowerCase() === buyerName.toLowerCase()
                ? { ...c, saldoCredito: Math.max(0, (c.saldoCredito || 0) - creditUsed) }
                : c
            ));
          }
          await refreshDomains('products', 'sales', 'customers', 'transactions');
          return { success: true, message: 'Venda processada atomicamente no Supabase com sucesso!', totalFinal: rpcResult.totalFinal };
        }

        return { success: false, message: rpcResult.message || 'Falha ao processar venda no banco de dados.', totalFinal: 0 };
      }

      return { success: false, message: 'Não foi possível concluir a venda no servidor. A operação não foi registrada localmente.', totalFinal: 0 };
    }

    const subtotal = cartItems.reduce((acc, item) => acc + item.preco * item.qtd, 0);
    const discountTotal = discountValue + subtotal * (discountPercent / 100);
    const totalFinal = Math.max(0, subtotal - discountTotal - creditUsed);
    const nextVendaNum = movements.length + 1004;
    const vendaIdFormatted = `PDV #${nextVendaNum}`;
    const currentDate = hoje();
    const resolvedName = buyerName.trim() || 'Cliente não identificado';
    const resolvedCpf = cpf.trim() || 'Não informado';


    let paymentFormatted = paymentMethod;
    if (paymentMethod === 'Cartão' && installments > 1) paymentFormatted += ` ${installments}x`;
    if (creditUsed > 0) paymentFormatted += ` (Abatido R$ ${creditUsed.toFixed(2)} de Crédito)`;

    setProducts(prev => prev.map(prod => {
      const matchingItems = cartItems.filter(item => item.produtoId === prod.id);
      if (matchingItems.length === 0) return prod;
      return {
        ...prod,
        skus: prod.skus.map((sku, sIdx) => {
          const match = matchingItems.find(item => item.skuIndex === sIdx);
          return match ? { ...sku, qtd: Math.max(0, sku.qtd - match.qtd) } : sku;
        }),
      };
    }));

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
      creditoUtilizado: creditUsed,
    };
    setMovements(prev => [newMovement, ...prev]);

    setCustomers(prev => {
      const existingCustomer =
        prev.find(c => c.cpf === resolvedCpf && resolvedCpf !== 'Não informado') ||
        prev.find(c => c.nome.toLowerCase() === resolvedName.toLowerCase());
      const purchaseRecord = {
        vendaId: vendaIdFormatted, valor: totalFinal, data: currentDate,
        itens: cartItems.map(i => `${i.nome} x${i.qtd}`).join(', '),
      };
      const creditDebitMovement = creditUsed > 0
        ? [{ id: Date.now(), tipo: 'saida' as const, valor: creditUsed,
            descricao: `Uso de crédito na Venda ${vendaIdFormatted}`,
            data: currentDate, referenciaId: vendaIdFormatted }]
        : [];

      if (existingCustomer) {
        return prev.map(c => c.id === existingCustomer.id
          ? {
              ...c,
              saldoCredito: Math.max(0, (c.saldoCredito || 0) - creditUsed),
              historico: [purchaseRecord, ...c.historico],
              movimentacoesCredito: [...creditDebitMovement, ...(c.movimentacoesCredito || [])],
            }
          : c);
      }
      if (resolvedName !== 'Cliente não identificado') {
        const nextCustId = prev.reduce((max, c) => Math.max(max, c.id), 0) + 1;
        return [...prev, {
          id: nextCustId, nome: resolvedName, cpf: resolvedCpf, rg: '', telefone: '', email: '',
          endereco: '', dataNascimento: '', saldoCredito: 0, historico: [purchaseRecord],
          movimentacoesCredito: creditDebitMovement,
        }];
      }
      return prev;
    });

    if (totalFinal > 0) {
      const nextTransId = transactions.reduce((max, t) => Math.max(max, t.id), 0) + 1;
      setTransactions(prev => [{
        id: nextTransId,
        tipo: 'INCOME',
        descricao: `Venda ${vendaIdFormatted}`,
        valor: totalFinal,
        data: currentDate,
      }, ...prev]);
    }

    checkAlerts();
    return { success: true, message: 'Venda realizada com sucesso!', totalFinal };
  }, [
    activeStoreId, isSupabaseConfigured, movements, transactions,
    setProducts, setMovements, setCustomers, setTransactions, checkAlerts, refreshDomains,
  ]);

  return { processSale };
}
