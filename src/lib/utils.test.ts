import { describe, expect, it } from 'vitest';
import {
  formatMoeda,
  totalEstoque,
  getStatusEstoque,
  calcVariacao,
  hoje,
  mesAtual,
  mesAnterior,
} from './utils';
import type { Product } from '../types';

const produto = (qtds: number[]): Product => ({
  id: 1,
  nome: 'Camiseta',
  marca: 'Marca',
  categoria: 'Roupas',
  preco: 99.9,
  skus: qtds.map((qtd, i) => ({ tamanho: 'M', cor: `C${i}`, qtd })),
});

describe('formatMoeda', () => {
  it('formata valores com duas casas e vírgula', () => {
    expect(formatMoeda(99.9)).toBe('R$ 99,90');
    expect(formatMoeda(0)).toBe('R$ 0,00');
  });

  it('trata valores nulos/undefined como zero', () => {
    expect(formatMoeda(undefined as unknown as number)).toBe('R$ 0,00');
    expect(formatMoeda(NaN)).toBe('R$ 0,00');
  });
});

describe('totalEstoque', () => {
  it('soma a quantidade de todos os SKUs', () => {
    expect(totalEstoque(produto([2, 3, 5]))).toBe(10);
  });

  it('retorna 0 para produto sem SKUs', () => {
    expect(totalEstoque(produto([]))).toBe(0);
  });
});

describe('getStatusEstoque', () => {
  it.each([
    [0, 'Esgotado'],
    [-1, 'Esgotado'],
    [1, 'Baixo Estoque'],
    [2, 'Baixo Estoque'],
    [3, 'Normal'],
    [100, 'Normal'],
  ] as const)('qtd %i => %s', (qtd, esperado) => {
    expect(getStatusEstoque(qtd)).toBe(esperado);
  });
});

describe('calcVariacao', () => {
  it('calcula variação positiva', () => {
    const r = calcVariacao(150, 100);
    expect(r.valor).toBeCloseTo(50);
    expect(r.classe).toBe('positivo');
    expect(r.texto).toBe('↑ 50.0%');
  });

  it('calcula variação negativa', () => {
    const r = calcVariacao(50, 100);
    expect(r.classe).toBe('negativo');
    expect(r.texto).toBe('↓ 50.0%');
  });

  it('trata base zero com valor atual positivo', () => {
    const r = calcVariacao(10, 0);
    expect(r).toEqual({ valor: 100, classe: 'positivo', texto: '↑ 100%' });
  });

  it('trata base zero com valor atual zero', () => {
    expect(calcVariacao(0, 0)).toEqual({ valor: 0, classe: 'neutro', texto: '→ 0%' });
  });
});

describe('datas', () => {
  it('hoje retorna YYYY-MM-DD', () => {
    expect(hoje()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('mesAtual e mesAnterior retornam YYYY-MM', () => {
    expect(mesAtual()).toMatch(/^\d{4}-\d{2}$/);
    expect(mesAnterior()).toMatch(/^\d{4}-\d{2}$/);
    expect(mesAnterior()).not.toBe(mesAtual());
  });
});
