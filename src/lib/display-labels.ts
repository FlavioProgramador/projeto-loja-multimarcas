export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  PIX: 'PIX',
  CASH: 'Dinheiro',
  CREDIT_CARD: 'Cartão de crédito',
  DEBIT_CARD: 'Cartão de débito',
  VOUCHER: 'Vale',
};

export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  ENTRY: 'Entrada',
  SALE: 'Venda',
  RETURN: 'Devolução',
  ADJUSTMENT: 'Ajuste',
  LOSS: 'Perda',
  TRANSFER_IN: 'Transferência recebida',
  TRANSFER_OUT: 'Transferência enviada',
  INITIAL: 'Estoque inicial',
  CORRECTION: 'Correção',
  CANCELLATION: 'Cancelamento',
};

export function formatPaymentMethod(value?: string | null): string {
  if (!value) return 'Não informado';
  const normalized = value.trim().toUpperCase();
  return PAYMENT_METHOD_LABELS[normalized] ?? value;
}

export function formatMovementType(value?: string | null): string {
  if (!value) return 'Não informado';
  const normalized = value.trim().toUpperCase();
  return MOVEMENT_TYPE_LABELS[normalized] ?? value;
}
