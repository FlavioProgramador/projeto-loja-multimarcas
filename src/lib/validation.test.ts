import { describe, expect, it } from 'vitest';
import { validateCPF, validateName, validateQuantity, validatePrice } from './validation';

describe('validateCPF', () => {
  it('aceita CPF formatado', () => {
    expect(validateCPF('123.456.789-09')).toBe(true);
  });

  it('aceita CPF apenas com dígitos', () => {
    expect(validateCPF('12345678909')).toBe(true);
  });

  it.each(['123.456.789-0', '1234567890', 'abc.def.ghi-jk', '', '123.456.789/09'])(
    'rejeita formato inválido: %s',
    (cpf) => {
      expect(validateCPF(cpf)).toBe(false);
    }
  );
});

describe('validateName', () => {
  it('aceita nomes válidos com acentos', () => {
    expect(validateName('Ana')).toBe(true);
    expect(validateName('José da Silva')).toBe(true);
  });

  it.each(['A', 'João123', 'João_Silva', '  ', 'x'.repeat(101)])(
    'rejeita nome inválido: %s',
    (name) => {
      expect(validateName(name)).toBe(false);
    }
  );
});

describe('validateQuantity', () => {
  it.each([[1, true], [10, true], [0, false], [-1, false], [1.5, false], [NaN, false]])(
    'validateQuantity(%s) === %s',
    (qty, esperado) => {
      expect(validateQuantity(qty as number)).toBe(esperado);
    }
  );
});

describe('validatePrice', () => {
  it.each([[0, true], [99.9, true], [-0.01, false], [NaN, false]])(
    'validatePrice(%s) === %s',
    (price, esperado) => {
      expect(validatePrice(price as number)).toBe(esperado);
    }
  );
});
