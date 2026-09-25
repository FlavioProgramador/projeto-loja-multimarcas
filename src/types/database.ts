export type UserRole = 'ADMIN' | 'MANAGER' | 'CASHIER' | 'EMPLOYEE';

export interface ProfileRow { id:string; full_name:string; email:string; role:UserRole; is_active:boolean; created_at:string; updated_at:string; }
export interface StoreRow { id:string; name:string; location:string|null; is_main:boolean; is_active:boolean; created_at:string; updated_at:string; }
export interface UserStoreAccessRow { user_id:string; store_id:string; role:UserRole; is_active:boolean; created_at:string; }
export interface StoreInventoryRow { id:string; store_id:string; product_variant_id:string; quantity:number; minimum_stock:number; created_at:string; updated_at:string; }
export interface SaleIdempotencyRow { idempotency_key:string; sale_id:string; created_at:string; }
export interface BrandRow { id:string; name:string; description:string|null; logo_url:string|null; is_active:boolean; created_at:string; updated_at:string; }
export interface CategoryRow { id:string; name:string; description:string|null; is_active:boolean; created_at:string; updated_at:string; }
export interface ProductRow { id:string; brand_id:string|null; category_id:string|null; name:string; description:string|null; cost_price:number; sale_price:number; minimum_stock:number; is_active:boolean; image_url:string|null; created_at:string; updated_at:string; brands?:BrandRow|null; categories?:CategoryRow|null; product_variants?:ProductVariantRow[]; }
export interface ProductVariantRow { id:string; product_id:string; sku:string; barcode:string|null; size:string; color:string; stock_quantity:number; created_at:string; updated_at:string; is_active:boolean; minimum_stock:number; reserved_quantity:number; }
export type InventoryMovementType='ENTRY'|'SALE'|'RETURN'|'ADJUSTMENT'|'LOSS'|'TRANSFER_IN'|'TRANSFER_OUT'|'INITIAL'|'CORRECTION'|'CANCELLATION';
export interface InventoryMovementRow { id:string; product_variant_id:string; type:InventoryMovementType; quantity:number; quantity_before:number; quantity_after:number; reference_type:string|null; reference_id:string|null; user_id:string|null; notes:string|null; created_at:string; store_id:string|null; reason:string|null; }
export interface CustomerRow { id:string; name:string; cpf:string|null; rg:string|null; phone:string|null; email:string|null; address:string|null; birth_date:string|null; is_active:boolean; created_at:string; updated_at:string; }
export interface SupplierRow { id:string; company_name:string; contact_name:string|null; document:string|null; email:string|null; phone:string|null; address:string|null; is_active:boolean; created_at:string; updated_at:string; }
export type SaleStatus='PENDING'|'COMPLETED'|'CANCELLED'|'REFUNDED';
export interface SaleRow { id:string; store_id:string; sale_number:string; customer_id:string|null; user_id:string|null; customer_name:string|null; customer_cpf:string|null; subtotal:number; discount:number; total:number; status:SaleStatus; coupon_code:string|null; created_at:string; completed_at:string|null; sale_items?:SaleItemRow[]; payments?:PaymentRow[]; }
export interface SaleItemRow { id:string; sale_id:string; product_id:string|null; product_variant_id:string|null; product_name:string; variant_description:string; quantity:number; unit_price:number; discount:number; total:number; created_at:string; }
export type PaymentMethod='PIX'|'CREDIT_CARD'|'DEBIT_CARD'|'CASH'|'Cartão'|'Dinheiro';
export type PaymentStatus='PENDING'|'PROCESSING'|'APPROVED'|'DECLINED'|'CANCELLED'|'REFUNDED';
export interface PaymentRow { id:string; sale_id:string; method:PaymentMethod; amount:number; status:PaymentStatus; installments:number; provider:string|null; provider_transaction_id:string|null; created_at:string; updated_at:string; }
export type FinancialTransactionType='INCOME'|'EXPENSE'; export type FinancialTransactionStatus='PENDING'|'PAID'|'CANCELLED';
export interface FinancialTransactionRow { id:string; store_id:string; type:FinancialTransactionType; category:string|null; description:string; amount:number; status:FinancialTransactionStatus; reference_type:string|null; reference_id:string|null; due_date:string|null; paid_at:string|null; created_at:string; updated_at:string; }
export interface FixedExpenseRow { id:string; store_id:string; description:string; amount:number; due_date:string; category:string|null; recurring:boolean; paid:boolean; created_at:string; updated_at:string; }
export interface ReturnRow { id:string; return_number:string; original_sale_id:string; customer_id:string|null; customer_name:string; customer_cpf:string|null; resolution_type:'credito_cliente'|'vale_troca'|'estorno_dinheiro'; status:'CONCLUIDO'|'CANCELADO'; total_amount:number; observations:string|null; expires_at:string|null; created_by:string|null; store_id:string; created_at:string; return_items?:ReturnItemRow[]; }
export interface ReturnItemRow { id:string; return_id:string; product_id:string|null; product_variant_id:string; product_name:string; size:string; color:string; unit_price:number; quantity:number; reason:string; created_at:string; }
export type CustomerCreditMovementType='CREDIT'|'DEBIT';
export interface CustomerCreditMovementRow { id:string; store_id:string; customer_id:string; type:CustomerCreditMovementType; amount:number; description:string; reference_type:string|null; reference_id:string|null; created_at:string; }
