import { calculateFinanceSummary, filterFinanceTransactions } from './finance.model';
import type { FinanceTransaction } from '../finance.service';

const tx=(p:Partial<FinanceTransaction>):FinanceTransaction=>({
  id:'id',storeId:'store',type:'INCOME',category:'Vendas',description:'Teste',amount:100,
  status:'PAID',referenceType:null,referenceId:null,dueDate:null,paidAt:null,
  createdAt:'2026-09-20T10:00:00Z',updatedAt:'2026-09-20T10:00:00Z',...p,
});

describe('finance.model',()=>{
  it('calcula entradas, saídas e saldo somente de lançamentos pagos',()=>{
    const summary=calculateFinanceSummary([
      tx({id:'1',amount:300,type:'INCOME'}),
      tx({id:'2',amount:100,type:'EXPENSE'}),
      tx({id:'3',amount:50,type:'INCOME',status:'PENDING'}),
      tx({id:'4',amount:20,type:'INCOME',status:'CANCELLED'}),
    ]);
    expect(summary).toEqual({income:300,expense:100,balance:200,pending:50});
  });

  it('filtra por tipo, status e texto de referência',()=>{
    const result=filterFinanceTransactions([
      tx({id:'sale-1',description:'Venda PDV #1050',referenceType:'SALE'}),
      tx({id:'expense-1',type:'EXPENSE',status:'PENDING',category:'Aluguel'}),
    ],{type:'EXPENSE',status:'PENDING',query:'aluguel'});
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('expense-1');
  });

  it('aplica a data inicial de forma determinística',()=>{
    const result=filterFinanceTransactions([
      tx({id:'old',createdAt:'2026-09-01T10:00:00Z'}),
      tx({id:'new',createdAt:'2026-09-20T10:00:00Z'}),
    ],{startDate:new Date('2026-09-10T00:00:00Z')});
    expect(result.map(item=>item.id)).toEqual(['new']);
  });
});