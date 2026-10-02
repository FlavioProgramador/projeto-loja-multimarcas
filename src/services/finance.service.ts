import { supabase, isSupabaseConfigured } from '../lib/supabase/client';
import { FinancialTransaction, FixedExpense } from '../types';

export type FinanceTransactionStatus = 'PENDING' | 'PAID' | 'CANCELLED';

export interface FinanceTransaction {
  id:string;
  storeId:string;
  type:'INCOME'|'EXPENSE';
  category:string|null;
  description:string;
  amount:number;
  status:FinanceTransactionStatus;
  referenceType:string|null;
  referenceId:string|null;
  dueDate:string|null;
  paidAt:string|null;
  createdAt:string;
  updatedAt:string;
}

export interface FinanceFixedExpense {
  id:string;
  storeId:string;
  description:string;
  amount:number;
  dueDate:string;
  category:string|null;
  recurring:boolean;
  paid:boolean;
  createdAt:string;
  updatedAt:string;
}

export interface FinanceSummary {
  income:number;
  expense:number;
  balance:number;
  pending:number;
}

export interface FinancePage {
  rows:FinanceTransaction[];
  total:number;
  summary:FinanceSummary;
}

interface TransactionRow {
  id:string;
  store_id:string;
  type:'INCOME'|'EXPENSE';
  category:string|null;
  description:string;
  amount:number|string;
  status:FinanceTransactionStatus;
  reference_type:string|null;
  reference_id:string|null;
  due_date:string|null;
  paid_at:string|null;
  created_at:string;
  updated_at:string;
}

interface ExpenseRow {
  id:string;
  store_id:string;
  description:string;
  amount:number|string;
  due_date:string;
  category:string|null;
  recurring:boolean;
  paid:boolean;
  created_at:string;
  updated_at:string;
}

const toNumber=(value:unknown):number=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:0;
};

const toTransaction = (row: TransactionRow): FinanceTransaction => ({
  id:row.id,
  storeId:row.store_id,
  type:row.type,
  category:row.category,
  description:row.description,
  amount:toNumber(row.amount),
  status:row.status,
  referenceType:row.reference_type,
  referenceId:row.reference_id,
  dueDate:row.due_date,
  paidAt:row.paid_at,
  createdAt:row.created_at,
  updatedAt:row.updated_at,
});

const toExpense = (row: ExpenseRow): FinanceFixedExpense => ({
  id:row.id,
  storeId:row.store_id,
  description:row.description,
  amount:toNumber(row.amount),
  dueDate:row.due_date,
  category:row.category,
  recurring:row.recurring,
  paid:row.paid,
  createdAt:row.created_at,
  updatedAt:row.updated_at,
});

const toLegacyTransaction = (row:FinanceTransaction): FinancialTransaction => ({
  id:0,
  uuid:row.id,
  tipo:row.type,
  descricao:row.description,
  valor:row.amount,
  data:(row.createdAt || row.paidAt || '').slice(0,10),
});

const toLegacyExpense = (row:FinanceFixedExpense): FixedExpense => ({
  id:0,
  uuid:row.id,
  descricao:row.description,
  valor:row.amount,
  dataVencimento:row.dueDate,
  categoria:row.category || 'Geral',
  pago:row.paid,
});

function isMissingFinancePageRpc(error:{code?:string;message?:string}):boolean{
  const message=error.message||'';
  return error.code==='PGRST202'
    || (message.includes('Could not find the function') && message.includes('get_finance_page'));
}

function legacyFilter(
  rows:FinanceTransaction[],
  options:{
    startDate?:string|null;
    type?:'ALL'|'INCOME'|'EXPENSE';
    status?:'ALL'|'PENDING'|'PAID'|'CANCELLED';
    search?:string;
  }
):FinanceTransaction[]{
  const needle=options.search?.trim().toLowerCase()||'';
  return rows.filter(row=>{
    if(options.startDate && new Date(row.createdAt)<new Date(options.startDate)) return false;
    if(options.type && options.type!=='ALL' && row.type!==options.type) return false;
    if(options.status && options.status!=='ALL' && row.status!==options.status) return false;
    if(!needle) return true;
    return [
      row.description,
      row.category,
      row.referenceType,
      row.referenceId,
      row.id,
    ].filter(Boolean).some(value=>String(value).toLowerCase().includes(needle));
  });
}

function summarize(rows:FinanceTransaction[]):FinanceSummary{
  const income=rows
    .filter(row=>row.status==='PAID'&&row.type==='INCOME')
    .reduce((sum,row)=>sum+row.amount,0);
  const expense=rows
    .filter(row=>row.status==='PAID'&&row.type==='EXPENSE')
    .reduce((sum,row)=>sum+row.amount,0);
  const pending=rows
    .filter(row=>row.status==='PENDING')
    .reduce((sum,row)=>sum+row.amount,0);
  return {income,expense,balance:income-expense,pending};
}

export const FinanceService = {
  async getPage(params:{
    storeId:string;
    page?:number;
    pageSize?:number;
    startDate?:string|null;
    type?:'ALL'|'INCOME'|'EXPENSE';
    status?:'ALL'|'PENDING'|'PAID'|'CANCELLED';
    search?:string;
  }):Promise<FinancePage>{
    if(!isSupabaseConfigured||!params.storeId){
      return {rows:[],total:0,summary:{income:0,expense:0,balance:0,pending:0}};
    }

    const page=Math.max(1,params.page||1);
    const pageSize=Math.min(100,Math.max(1,params.pageSize||15));
    const offset=(page-1)*pageSize;

    const {data,error}=await supabase.rpc('get_finance_page',{
      p_store_id:params.storeId,
      p_start_date:params.startDate||null,
      p_type:params.type||'ALL',
      p_status:params.status||'ALL',
      p_search:params.search?.trim()||null,
      p_limit:pageSize,
      p_offset:offset,
    });

    if(!error){
      const payload=(data||{}) as {
        rows?:TransactionRow[];
        total?:number|string;
        summary?:Partial<Record<keyof FinanceSummary,number|string>>;
      };
      return {
        rows:(payload.rows||[]).map(toTransaction),
        total:toNumber(payload.total),
        summary:{
          income:toNumber(payload.summary?.income),
          expense:toNumber(payload.summary?.expense),
          balance:toNumber(payload.summary?.balance),
          pending:toNumber(payload.summary?.pending),
        },
      };
    }

    if(!isMissingFinancePageRpc(error)) throw error;

    const all=await this.getTransactionRecords(params.storeId);
    const filtered=legacyFilter(all,params);
    return {
      rows:filtered.slice(offset,offset+pageSize),
      total:filtered.length,
      summary:summarize(filtered),
    };
  },

  async getTransactionRecords(
    storeId:string,
    options?:{startDate?:string|null}
  ):Promise<FinanceTransaction[]> {
    if (!isSupabaseConfigured || !storeId) return [];

    let query=supabase.from('financial_transactions')
      .select('id,store_id,type,category,description,amount,status,reference_type,reference_id,due_date,paid_at,created_at,updated_at')
      .eq('store_id',storeId)
      .order('created_at',{ascending:false});

    if(options?.startDate){
      query=query.gte('created_at',options.startDate);
    }

    const {data,error}=await query;
    if (error) throw error;
    return ((data||[]) as TransactionRow[]).map(toTransaction);
  },

  async getExpenseRecords(storeId:string):Promise<FinanceFixedExpense[]> {
    if (!isSupabaseConfigured || !storeId) return [];
    const {data,error}=await supabase.from('fixed_expenses')
      .select('id,store_id,description,amount,due_date,category,recurring,paid,created_at,updated_at')
      .eq('store_id',storeId)
      .order('due_date',{ascending:true});
    if (error) throw error;
    return ((data||[]) as ExpenseRow[]).map(toExpense);
  },

  async getTransactions(
    storeId?:string,
    options?:{startDate?:string|null}
  ):Promise<FinancialTransaction[]> {
    if (!storeId) return [];
    return (await this.getTransactionRecords(storeId,options)).map(toLegacyTransaction);
  },

  async getFixedExpenses(storeId?:string):Promise<FixedExpense[]> {
    if (!storeId) return [];
    return (await this.getExpenseRecords(storeId)).map(toLegacyExpense);
  },

  async toggleExpensePaid(uuid:string,currentPaidState:boolean):Promise<FinanceFixedExpense> {
    if (!isSupabaseConfigured || !uuid) throw new Error('Despesa inválida.');
    const {data,error}=await supabase.from('fixed_expenses')
      .update({paid:!currentPaidState})
      .eq('id',uuid)
      .select('id,store_id,description,amount,due_date,category,recurring,paid,created_at,updated_at')
      .single();
    if (error) throw error;
    return toExpense(data as ExpenseRow);
  },
};
