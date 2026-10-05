import { describe, it, expect } from 'vitest';
import { filterProducts, findMatchingSkuIndex } from './pdvUtils';
import { Product } from '../../types';

const mockProducts: Product[] = [
  {
    id: 101,
    nome: 'Camiseta Algodão Premium',
    marca: 'Nike',
    categoria: 'Camisetas',
    preco: 99.90,
    skus: [
      { id: 'sku-1-p', sku: 'CAM-NIKE-P', tamanho: 'P', cor: 'Preto', qtd: 5 },
      { id: 'sku-1-m', sku: 'CAM-NIKE-M', tamanho: 'M', cor: 'Preto', qtd: 10 },
      { id: 'sku-1-g', sku: 'CAM-NIKE-G', tamanho: 'G', cor: 'Branco', qtd: 0 },
    ]
  },
  {
    id: 102,
    nome: 'Calça Jeans Slim',
    marca: 'Levi\'s',
    categoria: 'Calças',
    preco: 199.90,
    skus: [
      { id: 'sku-2-40', sku: 'CALCA-LEV-40', tamanho: '40', cor: 'Azul', qtd: 3 },
      { id: 'sku-2-42', sku: 'CALCA-LEV-42', tamanho: '42', cor: 'Azul', qtd: 2 },
    ]
  },
  {
    id: 103,
    nome: 'Tênis Running',
    marca: 'Adidas',
    categoria: 'Calçados',
    preco: 299.90,
    skus: [
      { id: 'sku-3-41', sku: 'TENIS-ADI-41', tamanho: '41', cor: 'Preto', qtd: 8 },
    ]
  }
];

describe('pdvUtils - filterProducts', () => {
  it('retorna todos os produtos quando busca e categoria estão vazios', () => {
    const result = filterProducts(mockProducts, '', '');
    expect(result).toHaveLength(3);
  });

  it('busca produtos pelo nome', () => {
    const result = filterProducts(mockProducts, 'Camiseta', '');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(101);
  });

  it('busca produtos pela marca', () => {
    const result = filterProducts(mockProducts, 'Adidas', '');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(103);
  });

  it('busca produtos pelo ID do produto', () => {
    const result = filterProducts(mockProducts, '102', '');
    expect(result).toHaveLength(1);
    expect(result[0].nome).toBe('Calça Jeans Slim');
  });

  it('busca produtos pelo código SKU da variação', () => {
    const result = filterProducts(mockProducts, 'CALCA-LEV-42', '');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(102);
  });

  it('busca produtos pela cor da variação', () => {
    const result = filterProducts(mockProducts, 'Branco', '');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(101);
  });

  it('filtra corretamente por categoria e termo de busca', () => {
    const result = filterProducts(mockProducts, 'Preto', 'Calçados');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(103);
  });

  it('retorna lista vazia quando nenhum produto atende aos critérios', () => {
    const result = filterProducts(mockProducts, 'Inexistente', '');
    expect(result).toHaveLength(0);
  });
});

describe('pdvUtils - findMatchingSkuIndex', () => {
  it('respeita a seleção explícita fornecida pelo usuário', () => {
    const index = findMatchingSkuIndex(mockProducts[0], 'CAM-NIKE-P', 2);
    expect(index).toBe(2);
  });

  it('retorna o índice correspondente ao código SKU exato pesquisado', () => {
    const index = findMatchingSkuIndex(mockProducts[0], 'CAM-NIKE-M');
    expect(index).toBe(1);
  });

  it('retorna o índice da variação cujo tamanho coincide exatamente com o termo', () => {
    const index = findMatchingSkuIndex(mockProducts[1], '42');
    expect(index).toBe(1);
  });

  it('retorna 0 (índice padrão) quando a busca não corresponde a nenhuma variação específica', () => {
    const index = findMatchingSkuIndex(mockProducts[0], 'Nike');
    expect(index).toBe(0);
  });
});
