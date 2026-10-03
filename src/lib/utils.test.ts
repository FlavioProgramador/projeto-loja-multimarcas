import { describe, expect, it } from 'vitest';
import { formatCpf, formatDiscountSummary, maskCpf } from './utils';

describe('maskCpf', () => {
  it('mascara CPF formatado preservando apenas os dois últimos dígitos', () => {
    expect(maskCpf('123.456.789-09')).toBe('***.***.***-09');
  });

  it('mascara CPF sem formatação', () => {
    expect(maskCpf('12345678909')).toBe('***.***.***-09');
  });

  it('trata valor ausente sem expor dados', () => {
    expect(maskCpf('')).toBe('Não informado');
    expect(maskCpf(null)).toBe('Não informado');
  });

  it('preserva o marcador de dado ausente', () => {
    expect(maskCpf('Não informado')).toBe('Não informado');
  });
});


describe('formatCpf', () => {
  it('exibe o CPF completo formatado nos fluxos operacionais', () => {
    expect(formatCpf('12345678909')).toBe('123.456.789-09');
    expect(formatCpf('123.456.789-09')).toBe('123.456.789-09');
  });

  it('mantém valores ausentes como não informados', () => {
    expect(formatCpf('')).toBe('Não informado');
    expect(formatCpf(null)).toBe('Não informado');
    expect(formatCpf('Não informado')).toBe('Não informado');
  });
});

describe('formatDiscountSummary', () => {
  it('retorna string vazia se nenhum desconto for informado ou se forem <= 0', () => {
    expect(formatDiscountSummary(0, 0, 100)).toBe('');
    expect(formatDiscountSummary('', '', 100)).toBe('');
    expect(formatDiscountSummary(null, null, 100)).toBe('');
  });

  it('formata apenas desconto em valor fixo', () => {
    expect(formatDiscountSummary(15, 0, 100)).toBe('R$ 15,00');
    expect(formatDiscountSummary('10.5', 0, 100)).toBe('R$ 10,50');
  });

  it('formata apenas desconto percentual com o valor correspondente no subtotal', () => {
    expect(formatDiscountSummary(0, 10, 200)).toBe('10% (R$ 20,00)');
    expect(formatDiscountSummary(0, '5', 100)).toBe('5% (R$ 5,00)');
  });

  it('formata descontos combinados (valor fixo + percentual)', () => {
    expect(formatDiscountSummary(10, 5, 200)).toBe('R$ 10,00 + 5% (R$ 10,00)');
  });
});
