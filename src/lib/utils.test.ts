import { describe, expect, it } from 'vitest';
import { maskCpf } from './utils';

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
