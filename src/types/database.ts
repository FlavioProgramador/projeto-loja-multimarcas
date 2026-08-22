export type UserRole = 'ADMIN' | 'MANAGER' | 'CASHIER' | 'EMPLOYEE';

export interface ProfileRow {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BrandRow {
  id: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CategoryRow {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductRow {
  id: string;
  brand_id: string | null;
  category_id: string | null;
  name: string;
  description: string | null;
  cost_price: number;
  sale_price: number;
  minimum_stock: number;
  is_active: boolean;
  image_url: string | null;
  created_at: string;
  updated_at: string;
  // Joins opcionais
  brands?: BrandRow | null;
  categories?: CategoryRow | null;
  product_variants?: ProductVariantRow[];
}

export interface ProductVariantRow {
  id: string;
  product_id: string;
  sku: string;
  barcode: string | null;
  size: string;
  color: string;
  stock_quantity: number;
  created_at: string;
  updated_at: string;
}

export type InventoryMovementType =
  | 'ENTRY'
  | 'SALE'
  | 'RETURN'
  | 'ADJUSTMENT'
  | 'CANCELLATION';

export interface InventoryMovementRow {
  id: string;
  product_variant_id: string;
  type: InventoryMovementType;
  quantity: number;
  quantity_before: number;
  quantity_after: number;
  reference_type: string | null;
  reference_id: string | null;
  user_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface CustomerRow {
  id: string;
  name: string;
  cpf: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  birth_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupplierRow {
  id: string;
  company_name: string;
  contact_name: string | null;
  document: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type SaleStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'REFUNDED';

export interface SaleRow {
  id: string;
  sale_number: string;
  customer_id: string | null;
  user_id: string | null;
  customer_name: string | null;
  customer_cpf: string | null;
  subtotal: number;
  discount: number;
  total: number;
  status: SaleStatus;
  coupon_code: string | null;
  created_at: string;
  completed_at: string | null;
  sale_items?: SaleItemRow[];
  payments?: PaymentRow[];
}

export interface SaleItemRow {
  id: string;
  sale_id: string;
  product_id: string | null;
  product_variant_id: string | null;
  product_name: string;
  variant_description: string;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
  created_at: string;
}

export type PaymentMethod =
  | 'PIX'
  | 'CREDIT_CARD'
  | 'DEBIT_CARD'
  | 'CASH'
  | 'Cartão'
  | 'Dinheiro';

export type PaymentStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'APPROVED'
  | 'DECLINED'
  | 'CANCELLED'
  | 'REFUNDED';

export interface PaymentRow {
  id: string;
  sale_id: string;
  method: PaymentMethod;
  amount: number;
  status: PaymentStatus;
  installments: number;
  provider: string | null;
  provider_transaction_id: string | null;
  created_at: string;
  updated_at: string;
}

export type FinancialTransactionType =
  | 'INCOME'
  | 'EXPENSE'
  | 'entrada'
  | 'saida';

export type FinancialTransactionStatus = 'PENDING' | 'PAID' | 'CANCELLED';

export interface FinancialTransactionRow {
  id: string;
  type: FinancialTransactionType;
  category: string | null;
  description: string;
  amount: number;
  status: FinancialTransactionStatus;
  reference_type: string | null;
  reference_id: string | null;
  due_date: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FixedExpenseRow {
  id: string;
  description: string;
  amount: number;
  due_date: string;
  category: string | null;
  recurring: boolean;
  paid: boolean;
  created_at: string;
  updated_at: string;
}


