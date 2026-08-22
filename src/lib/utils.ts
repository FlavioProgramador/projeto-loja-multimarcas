import { Product, StockStatus } from '../types';

export function formatMoeda(v: number): string {
  return 'R$ ' + (v || 0).toFixed(2).replace('.', ',');
}

export function totalEstoque(prod: Product): number {
  return prod.skus.reduce((acc, s) => acc + s.qtd, 0);
}

export function getStatusEstoque(qtd: number): StockStatus {
  if (qtd <= 0) return 'Esgotado';
  if (qtd <= 2) return 'Baixo Estoque';
  return 'Normal';
}

export function hoje(): string {
  return new Date().toISOString().slice(0, 10);
}

export function mesAtual(): string {
  return new Date().toISOString().slice(0, 7);
}

export function mesAnterior(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

export function calcVariacao(atual: number, anterior: number) {
  if (anterior === 0) {
    return {
      valor: atual > 0 ? 100 : 0,
      classe: atual > 0 ? 'positivo' : 'neutro',
      texto: atual > 0 ? '↑ 100%' : '→ 0%'
    };
  }
  const variacao = ((atual - anterior) / anterior) * 100;
  return {
    valor: variacao,
    classe: variacao > 0 ? 'positivo' : variacao < 0 ? 'negativo' : 'neutro',
    texto: variacao > 0 ? `↑ ${variacao.toFixed(1)}%` : variacao < 0 ? `↓ ${Math.abs(variacao).toFixed(1)}%` : '→ 0%'
  };
}

export function downloadCSV(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}
