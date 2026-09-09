export interface ProductSku {
  id?: string;
  sku?: string;
  tamanho: string;
  cor: string;
  qtd: number;
}

export type StockStatus = 'Normal' | 'Baixo Estoque' | 'Esgotado';

export interface Product {
  id: number;
  uuid?: string;
  nome: string;
  marca: string;
  categoria: string;
  colecao?: string;
  estacao?: string;
  genero?: string;
  imagemUrl?: string;
  preco: number;
  skus: ProductSku[];
}

export interface CartItem {
  produtoId: number;
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

export interface CustomerCreditMovement {
  id: number;
  tipo: 'entrada' | 'saida';
  valor: number;
  descricao: string;
  data: string;
  referenciaId?: string;
}

export interface Customer {
  id: number;
  uuid?: string;
  nome: string;
  cpf: string;
  telefone: string;
  email: string;
  endereco: string;
  saldoCredito?: number;
  historico: CustomerPurchase[];
  movimentacoesCredito?: CustomerCreditMovement[];
}

export interface Supplier {
  id: number;
  uuid?: string;
  nome: string;
  cnpj: string;
  contato: string;
  email: string;
  endereco: string;
  produtos: string[];
}

export type TransactionType = 'entrada' | 'saida';

export interface FinancialTransaction {
  id: number;
  uuid?: string;
  tipo: TransactionType;
  descricao: string;
  valor: number;
  data: string;
}

export interface FixedExpense {
  id: number;
  uuid?: string;
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
  creditoUtilizado?: number;
}

export type ReturnReason =
  | 'Tamanho Incorreto'
  | 'Defeito de Fabricação'
  | 'Insatisfação com o Modelo'
  | 'Troca de Cor'
  | 'Presente / Outro';

export interface ReturnItem {
  produtoId: number;
  productUuid?: string;
  variantId?: string;
  nome: string;
  tamanho: string;
  cor: string;
  precoUnitario: number;
  qtd: number;
  motivo: ReturnReason | string;
}

export interface ReturnRecord {
  id: number;
  uuid?: string;
  codigo: string;
  data: string;
  vendaOriginalId?: string;
  clienteNome: string;
  clienteCpf: string;
  clienteId?: number;
  itens: ReturnItem[];
  valorTotal: number;
  tipoResolucao: 'credito_cliente' | 'vale_troca' | 'estorno_dinheiro';
  status: 'CONCLUIDO' | 'CANCELADO';
  dataValidade?: string;
  observacoes?: string;
}

export type ActiveModule =
  | 'dashboard'
  | 'pdv'
  | 'estoque'
  | 'trocas'
  | 'financeiro'
  | 'movimentacoes'
  | 'clientes'
  | 'fornecedores'
  | 'relatorios'
  | 'automacoes';

