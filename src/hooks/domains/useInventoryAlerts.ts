import { useCallback } from 'react';
import type { FixedExpense, Product } from '../../types';

interface UseInventoryAlertsParams {
  products: Product[];
  fixedExpenses: FixedExpense[];
  setNotifications: React.Dispatch<React.SetStateAction<string[]>>;
}

export const useInventoryAlerts = ({
  products,
  fixedExpenses,
  setNotifications,
}: UseInventoryAlertsParams) => {
  const checkAlerts = useCallback(() => {
    const alerts: string[] = [];

    products.forEach(product => {
      product.skus.forEach(sku => {
        if (sku.qtd <= 2 && sku.qtd > 0) {
          alerts.push(`${product.nome} (${sku.tamanho}/${sku.cor}) - Baixo estoque: ${sku.qtd} und`);
        } else if (sku.qtd === 0) {
          alerts.push(`${product.nome} (${sku.tamanho}/${sku.cor}) - ESGOTADO`);
        }
      });
    });

    fixedExpenses.filter(expense => !expense.pago).forEach(expense => {
      const diffDays = Math.ceil((new Date(expense.dataVencimento).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      if (diffDays <= 3 && diffDays >= 0) {
        alerts.push(`💰 ${expense.descricao} vence em ${diffDays} dias - R$ ${expense.valor.toFixed(2)}`);
      }
    });

    setNotifications(previous => Array.from(new Set([...previous, ...alerts])));
  }, [fixedExpenses, products, setNotifications]);

  return { checkAlerts };
};
