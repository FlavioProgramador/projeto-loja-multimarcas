import { describe, expect, it } from 'vitest';
import { formatCpf, maskCpf } from './utils';

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
