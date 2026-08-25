export interface ProductSku {
  id?: string;
  sku?: string;
  tamanho: string;
  cor: string;
  qtd: number;
}

export type StockStatus = 'Normal' | 'Baixo Estoque' | 'Esgotado';

export interface Product {
  id: string;
  nome: string;
  marca: string;
  categoria: string;
  preco: number;
  skus: ProductSku[];
}

export interface CartItem {
  produtoId: string;
  skuIndex: number;
  nome: string;
  tamanho: string;
  cor: string;
  preco: number;
  qtd: number;
  variantId?: string;
  productUuid?: string;
}

export interface CustomerPurchase {
  vendaId: string;
  valor: number;
  data: string;
  itens: string;
}

export interface Customer {
  id: string;
  nome: string;
  cpf: string;
  telefone: string;
  email: string;
  endereco: string;
  historico: CustomerPurchase[];
}

export interface Supplier {
  id: string;
  nome: string;
  cnpj: string;
  contato: string;
  email: string;
  endereco: string;
  produtos: string[];
}

export type TransactionType = 'entrada' | 'saida';

export interface FinancialTransaction {
  id: string;
  tipo: TransactionType;
  descricao: string;
  valor: number;
  data: string;
}

export interface FixedExpense {
  id: string;
  descricao: string;
  valor: number;
  dataVencimento: string;
  categoria: string;
  pago: boolean;
}


export interface SaleMovement {
  id: number;
  uuid?: string;
  tipo: 'saida' | 'entrada';
  valor: number;
  formaPagamento: string;
  comprador: string;
  cpf: string;
  produtos: string;
  data: string;
  vendaId: string;
}

export type ActiveModule =
  | 'dashboard'
  | 'pdv'
  | 'estoque'
  | 'financeiro'
  | 'movimentacoes'
  | 'clientes'
  | 'fornecedores'
  | 'relatorios'
  | 'automacoes';
