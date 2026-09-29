import { FinanceTransaction } from '../finance.service';
export interface FinanceSummary { income:number; expense:number; balance:number; pending:number; }
export const calculateFinanceSummary=(transactions:FinanceTransaction[]):FinanceSummary=>{
  const paid=transactions.filter(t=>t.status==='PAID');
  const income=paid.filter(t=>t.type==='INCOME').reduce((s,t)=>s+t.amount,0);
  const expense=paid.filter(t=>t.type==='EXPENSE').reduce((s,t)=>s+t.amount,0);
  const pending=transactions.filter(t=>t.status==='PENDING').reduce((s,t)=>s+t.amount,0);
  return {income,expense,balance:income-expense,pending};
};
export const filterFinanceTransactions=(transactions:FinanceTransaction[],options:{type?:'ALL'|'INCOME'|'EXPENSE';status?:'ALL'|'PENDING'|'PAID'|'CANCELLED';query?:string;startDate?:Date|null;})=>{
  const needle=options.query?.trim().toLowerCase()||'';
  return transactions.filter(t=>{
    if(options.type&&options.type!=='ALL'&&t.type!==options.type)return false;
    if(options.status&&options.status!=='ALL'&&t.status!==options.status)return false;
    if(options.startDate&&new Date(t.createdAt)<options.startDate)return false;
    if(!needle)return true;
    return [t.description,t.category,t.referenceType,t.referenceId,t.id].filter(Boolean).some(v=>v!.toLowerCase().includes(needle));
  });
};