export interface CashValidationResult {
  isValid: boolean;
  message?: string;
  isInsufficientCash?: boolean;
}

export function validateCashPayment(
  paymentMethod: string,
  amountPaid: string,
  totalFinal: number
): CashValidationResult {
  if (paymentMethod !== 'Dinheiro') {
    return { isValid: true };
  }

  const trimmed = amountPaid.trim();
  if (trimmed === '') {
    return { isValid: true };
  }

  const paidVal = parseFloat(trimmed);
  if (isNaN(paidVal) || paidVal < totalFinal) {
    return {
      isValid: false,
      isInsufficientCash: true,
      message: '⚠️ Valor recebido em dinheiro é menor que o total a pagar.'
    };
  }

  return { isValid: true };
}
