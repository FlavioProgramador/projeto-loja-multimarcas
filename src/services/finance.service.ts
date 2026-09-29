import { supabase, isSupabaseConfigured } from '../lib/supabase/client';
import { FinancialTransaction, FixedExpense } from '../types';
export type FinanceTransactionStatus = 'PENDING' | 'PAID' | 'CANCELLED';
export interface FinanceTransaction {
  id:string; storeId:string; type:'INCOME'|'EXPENSE'; category:string|null;
  description:string; amount:number; status:FinanceTransactionStatus;
  referenceType:string|null; referenceId:string|null; dueDate:string|null;
  paidAt:string|null; createdAt:string; updatedAt:string;
}
export interface FinanceFixedExpense {
  id:string; storeId:string; description:string; amount:number; dueDate:string;
  category:string|null; recurring:boolean; paid:boolean; createdAt:string; updatedAt:string;
}
interface TransactionRow {
  id:string; store_id:string; type:'INCOME'|'EXPENSE'; category:string|null;
  description:string; amount:number|string; status:FinanceTransactionStatus;
  reference_type:string|null; reference_id:string|null; due_date:string|null;
  paid_at:string|null; created_at:string; updated_at:string;
}
interface ExpenseRow {
  id:string; store_id:string; description:string; amount:number|string; due_date:string;
  category:string|null; recurring:boolean; paid:boolean; created_at:string; updated_at:string;
}
const toTransaction = (row: TransactionRow): FinanceTransaction => ({
  id:row.id, storeId:row.store_id, type:row.type, category:row.category,
  description:row.description, amount:Number(row.amount)||0, status:row.status,
  referenceType:row.reference_type, referenceId:row.reference_id, dueDate:row.due_date,
  paidAt:row.paid_at, createdAt:row.created_at, updatedAt:row.updated_at,
});
const toExpense = (row: ExpenseRow): FinanceFixedExpense => ({
  id:row.id, storeId:row.store_id, description:row.description, amount:Number(row.amount)||0,
  dueDate:row.due_date, category:row.category, recurring:row.recurring,
  paid:row.paid, createdAt:row.created_at, updatedAt:row.updated_at,
});
const toLegacyTransaction = (row:FinanceTransaction): FinancialTransaction => ({
  id:0, uuid:row.id, tipo:row.type, descricao:row.description, valor:row.amount,
  data:(row.createdAt || row.paidAt || '').slice(0,10),
});
const toLegacyExpense = (row:FinanceFixedExpense): FixedExpense => ({
  id:0, uuid:row.id, descricao:row.description, valor:row.amount,
  dataVencimento:row.dueDate, categoria:row.category || 'Geral', pago:row.paid,
});
export const FinanceService = {
  async getTransactionRecords(storeId:string):Promise<FinanceTransaction[]> {
    if (!isSupabaseConfigured || !storeId) return [];
    const {data,error}=await supabase.from('financial_transactions')
      .select('id,store_id,type,category,description,amount,status,reference_type,reference_id,due_date,paid_at,created_at,updated_at')
      .eq('store_id',storeId).eq('is_active',true).order('created_at',{ascending:false});
    if (error) throw error;
    return ((data||[]) as TransactionRow[]).map(toTransaction);
  },
  async getExpenseRecords(storeId:string):Promise<FinanceFixedExpense[]> {
    if (!isSupabaseConfigured || !storeId) return [];
    const {data,error}=await supabase.from('fixed_expenses')
      .select('id,store_id,description,amount,due_date,category,recurring,paid,created_at,updated_at')
      .eq('store_id',storeId).order('due_date',{ascending:true});
    if (error) throw error;
    return ((data||[]) as ExpenseRow[]).map(toExpense);
  },
  async getTransactions(storeId?:string):Promise<FinancialTransaction[]> {
    if (!storeId) return [];
    return (await this.getTransactionRecords(storeId)).map(toLegacyTransaction);
  },
  async getFixedExpenses(storeId?:string):Promise<FixedExpense[]> {
    if (!storeId) return [];
    return (await this.getExpenseRecords(storeId)).map(toLegacyExpense);
  },
  async toggleExpensePaid(uuid:string,currentPaidState:boolean):Promise<FinanceFixedExpense> {
    if (!isSupabaseConfigured || !uuid) throw new Error('Despesa inválida.');
    const {data,error}=await supabase.from('fixed_expenses')
      .update({paid:!currentPaidState}).eq('id',uuid)
      .select('id,store_id,description,amount,due_date,category,recurring,paid,created_at,updated_at')
      .single();
    if (error) throw error;
    return toExpense(data as ExpenseRow);
  },
};