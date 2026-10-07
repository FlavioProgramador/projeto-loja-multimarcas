import { describe, it, expect } from 'vitest';
import { validateCashPayment } from './pdv-validation';

describe('validateCashPayment', () => {
  it('should pass for non-cash payment methods regardless of amountPaid', () => {
    expect(validateCashPayment('PIX', '', 100)).toEqual({ isValid: true });
    expect(validateCashPayment('Cartão', '10', 100)).toEqual({ isValid: true });
  });

  it('should pass for cash payment when amountPaid is empty (exact change assumption)', () => {
    expect(validateCashPayment('Dinheiro', '', 100)).toEqual({ isValid: true });
    expect(validateCashPayment('Dinheiro', '   ', 100)).toEqual({ isValid: true });
  });

  it('should pass for cash payment when amountPaid is greater than or equal to totalFinal', () => {
    expect(validateCashPayment('Dinheiro', '100', 100)).toEqual({ isValid: true });
    expect(validateCashPayment('Dinheiro', '150.50', 100)).toEqual({ isValid: true });
  });

  it('should fail for cash payment when amountPaid is less than totalFinal', () => {
    const result = validateCashPayment('Dinheiro', '50', 100);
    expect(result.isValid).toBe(false);
    expect(result.isInsufficientCash).toBe(true);
    expect(result.message).toContain('menor que o total');
  });

  it('should fail for cash payment when amountPaid is not a valid number', () => {
    const result = validateCashPayment('Dinheiro', 'abc', 100);
    expect(result.isValid).toBe(false);
    expect(result.isInsufficientCash).toBe(true);
  });
});
