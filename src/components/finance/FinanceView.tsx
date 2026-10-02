import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, CircleDollarSign, CreditCard, Filter, Inbox, RefreshCw, Search, Wallet, X } from 'lucide-react';
import { useStore } from '../../contexts/StoreContext';
import { FinanceService, FinanceFixedExpense, FinanceTransaction, type FinanceSummary } from '../../services/finance.service';
import './finance.css';

type Period = 'today' | '7d' | '30d' | 'all';
type Status = 'ALL' | 'PENDING' | 'PAID' | 'CANCELLED';
type Type = 'ALL' | 'INCOME' | 'EXPENSE';
const PAGE_SIZE = 15;

const money = (value:number) => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value);
const dateTime = (value:string) => new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
const dateOnly = (value:string) => new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(value));
const num = (value:number) => new Intl.NumberFormat('pt-BR').format(value);

function startDate(period:Period){ const d=new Date(); if(period==='all') return null; if(period==='today'){d.setHours(0,0,0,0);return d;} d.setDate(d.getDate()-(period==='7d'?6:29)); d.setHours(0,0,0,0); return d; }
function statusLabel(status:Status){ return status==='ALL'?'Todos os status':status==='PAID'?'Pago':status==='PENDING'?'Pendente':'Cancelado'; }

export const FinanceView:React.FC = () => {
  const { activeStoreId } = useStore();
  const [transactions,setTransactions]=useState<FinanceTransaction[]>([]);
  const [expenses,setExpenses]=useState<FinanceFixedExpense[]>([]);
  const [total,setTotal]=useState(0);
  const [summary,setSummary]=useState<FinanceSummary>({income:0,expense:0,balance:0,pending:0});
  const [loading,setLoading]=useState(true);
  const [query,setQuery]=useState('');
  const [period,setPeriod]=useState<Period>('30d');
  const [type,setType]=useState<Type>('ALL');
  const [status,setStatus]=useState<Status>('ALL');
  const [page,setPage]=useState(1);
  const [selected,setSelected]=useState<FinanceTransaction|null>(null);

  const loadTransactions=async()=>{
    if(!activeStoreId){
      setTransactions([]);
      setTotal(0);
      setSummary({income:0,expense:0,balance:0,pending:0});
      setLoading(false);
      return;
    }
    setLoading(true);
    try{
      const start=startDate(period);
      const result=await FinanceService.getPage({
        storeId:activeStoreId,
        page,
        pageSize:PAGE_SIZE,
        startDate:start?.toISOString()||null,
        type,
        status,
        search:query,
      });
      setTransactions(result.rows);
      setTotal(result.total);
      setSummary(result.summary);
      const lastPage=Math.max(1,Math.ceil(result.total/PAGE_SIZE));
      if(page>lastPage)setPage(lastPage);
    }catch(error){
      console.error('Erro ao sincronizar financeiro:',error);
      setTransactions([]);
      setTotal(0);
      setSummary({income:0,expense:0,balance:0,pending:0});
    }finally{
      setLoading(false);
    }
  };

  const loadExpenses=async()=>{
    if(!activeStoreId){setExpenses([]);return;}
    try{
      setExpenses(await FinanceService.getExpenseRecords(activeStoreId));
    }catch(error){
      console.error('Erro ao carregar despesas fixas:',error);
      setExpenses([]);
    }
  };

  useEffect(()=>setPage(1),[activeStoreId,period,type,status,query]);

  useEffect(()=>{
    const timer=window.setTimeout(()=>{void loadTransactions();},query.trim()?250:0);
    return ()=>window.clearTimeout(timer);
  },[activeStoreId,page,period,type,status,query]);

  useEffect(()=>{void loadExpenses();},[activeStoreId]);

  const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
  const rows=transactions;
  const due=useMemo(()=>expenses.filter(e=>!e.paid).reduce((sum,e)=>sum+e.amount,0),[expenses]);

  const loadAll=async()=>{
    await Promise.all([loadTransactions(),loadExpenses()]);
  };

  return <div className="finance-page module-fade">
    <header className="finance-hero">
      <div><div className="finance-eyebrow"><Wallet size={14}/>Visão financeira</div><h1 className="page-title">Financeiro</h1><p className="page-subtitle">Fluxo de caixa, lançamentos e contas da loja em uma única visão.</p></div>
      <button className="btn btn-outline finance-refresh" onClick={()=>void loadAll()} disabled={loading}><RefreshCw size={15} className={loading?'spin':''}/>Atualizar</button>
    </header>

    <section className="finance-kpis">
      <Metric icon={<ArrowDownLeft size={18}/>} label="Entradas pagas" value={money(summary.income)} hint="Somente lançamentos liquidados" tone="in"/>
      <Metric icon={<ArrowUpRight size={18}/>} label="Saídas pagas" value={money(summary.expense)} hint="Custos e despesas liquidados" tone="out"/>
      <Metric icon={<CircleDollarSign size={18}/>} label="Saldo operacional" value={money(summary.balance)} hint={summary.balance>=0?'Resultado do período':'Resultado negativo no período'} tone={summary.balance>=0?'neutral':'out'}/>
      <Metric icon={<CalendarDays size={18}/>} label="Contas pendentes" value={money(due+summary.pending)} hint={num(expenses.filter(e=>!e.paid).length)+' despesas fixas + lançamentos pendentes'} tone="neutral"/>
    </section>

    <section className="finance-toolbar">
      <div className="finance-search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar descrição, categoria, referência ou ID..."/>{query&&<button onClick={()=>setQuery('')} aria-label="Limpar busca"><X size={15}/></button>}</div>
      <FilterControl icon={<CalendarDays size={14}/>} value={period} onChange={v=>setPeriod(v as Period)} options={[['today','Hoje'],['7d','7 dias'],['30d','30 dias'],['all','Todo período']]}/>
      <FilterControl icon={<ArrowDownLeft size={14}/>} value={type} onChange={v=>setType(v as Type)} options={[['ALL','Tipos'],['INCOME','Entradas'],['EXPENSE','Saídas']]}/>
      <FilterControl icon={<CreditCard size={14}/>} value={status} onChange={v=>setStatus(v as Status)} options={[[ 'ALL','Status'],['PAID','Pagos'],['PENDING','Pendentes'],['CANCELLED','Cancelados']]}/>
    </section>

    <section className="finance-table-card">
      <div className="finance-table-head"><div><strong>Lançamentos financeiros</strong><p>Registros sincronizados diretamente com a loja ativa.</p></div><span>{num(total)} resultados</span></div>
      {loading?<TableSkeleton/>:rows.length===0?<EmptyState/>:<>
        <div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Categoria</th><th>Status</th><th>Referência</th><th className="align-right">Valor</th></tr></thead>
        <tbody>{rows.map(t=><tr key={t.id} onClick={()=>setSelected(t)}>
          <td><strong>{dateOnly(t.createdAt)}</strong><small>{dateTime(t.createdAt).split(', ')[1]}</small></td>
          <td><span className={'finance-type '+(t.type==='INCOME'?'income':'expense')}>{t.type==='INCOME'?<ArrowDownLeft size={14}/>:<ArrowUpRight size={14}/>} {t.type==='INCOME'?'Entrada':'Saída'}</span></td>
          <td><strong>{t.description}</strong><small>{t.paidAt?'Liquidado em '+dateTime(t.paidAt):t.dueDate?'Vencimento '+dateOnly(t.dueDate):'Sem vencimento informado'}</small></td>
          <td><span className="finance-category">{t.category||'Sem categoria'}</span></td>
          <td><span className={'finance-status '+t.status.toLowerCase()}>{statusLabel(t.status)}</span></td>
          <td><span className="finance-reference">{t.referenceType||'—'}</span></td>
          <td className={'finance-value '+(t.type==='INCOME'?'income':'expense')}>{t.type==='INCOME'?'+':'-'} {money(t.amount)}</td>
        </tr>)}</tbody></table></div>
        <div className="finance-pagination"><span>Exibindo {((page-1)*PAGE_SIZE)+1}–{Math.min(page*PAGE_SIZE,total)} de {total}</span><div><button disabled={page===1} onClick={()=>setPage(v=>v-1)}><ChevronLeft size={16}/></button><strong>{page}/{pages}</strong><button disabled={page===pages} onClick={()=>setPage(v=>v+1)}><ChevronRight size={16}/></button></div></div>
      </>}
    </section>

    <section className="finance-expenses"><div className="finance-section-head"><div><strong>Despesas fixas</strong><p>Contas recorrentes da loja e seus vencimentos.</p></div><span>{num(expenses.length)} contas</span></div>
      {expenses.length===0?<EmptyState compact/>:<div className="finance-expense-list">{expenses.slice(0,8).map(e=><ExpenseRow key={e.id} expense={e} onToggle={async()=>{try{const updated=await FinanceService.toggleExpensePaid(e.id,e.paid);setExpenses(prev=>prev.map(x=>x.id===updated.id?updated:x));}catch(error){console.error(error);}}}/>)}</div>}
    </section>

    {selected&&<FinanceDetails transaction={selected} onClose={()=>setSelected(null)}/>}
  </div>;
};
const Metric:React.FC<{icon:React.ReactNode;label:string;value:string;hint:string;tone:'in'|'out'|'neutral'}>=({icon,label,value,hint,tone})=><article className="finance-kpi"><div className={'finance-kpi-icon '+tone}>{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{hint}</small></div></article>;

const FilterControl:React.FC<{icon:React.ReactNode;value:string;onChange:(v:string)=>void;options:string[][]}>=({icon,value,onChange,options})=><label className="finance-filter">{icon}<select value={value} onChange={e=>onChange(e.target.value)}>{options.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>;

const ExpenseRow:React.FC<{expense:FinanceFixedExpense;onToggle:()=>Promise<void>}>=({expense,onToggle})=><div className="finance-expense-row"><div className="finance-expense-icon"><CalendarDays size={16}/></div><div className="finance-expense-main"><strong>{expense.description}</strong><span>Dia {new Date(expense.dueDate+'T12:00:00').getDate()} · {expense.category||'Sem categoria'}{expense.recurring?' · Recorrente':''}</span></div><strong className="finance-expense-value">{money(expense.amount)}</strong><span className={'finance-status '+(expense.paid?'paid':'pending')}>{expense.paid?'Pago':'Pendente'}</span><button className="btn btn-outline btn-sm" onClick={()=>void onToggle()}>{expense.paid?'Desfazer':'Marcar pago'}</button></div>;

const FinanceDetails:React.FC<{transaction:FinanceTransaction;onClose:()=>void}>=({transaction,onClose})=><div className="finance-detail-backdrop" onClick={onClose}><div className="finance-detail" onClick={e=>e.stopPropagation()}><div className="finance-detail-head"><div><span>Lançamento financeiro</span><h2>{transaction.description}</h2></div><button onClick={onClose} aria-label="Fechar"><X size={18}/></button></div><div className="finance-detail-grid"><Detail label="Tipo" value={transaction.type==='INCOME'?'Entrada':'Saída'}/><Detail label="Valor" value={money(transaction.amount)}/><Detail label="Status" value={statusLabel(transaction.status)}/><Detail label="Categoria" value={transaction.category||'Sem categoria'}/><Detail label="Criado em" value={dateTime(transaction.createdAt)}/><Detail label="Pago em" value={transaction.paidAt?dateTime(transaction.paidAt):'—'}/><Detail label="Vencimento" value={transaction.dueDate?dateOnly(transaction.dueDate):'—'}/><Detail label="Referência" value={transaction.referenceType||'—'}/></div><div className="finance-detail-id"><span>ID</span><code>{transaction.id}</code></div></div></div>;

const Detail:React.FC<{label:string;value:string}>=({label,value})=><div className="finance-detail-item"><span>{label}</span><strong>{value}</strong></div>;

const TableSkeleton:React.FC=()=> <div className="finance-skeleton">{Array.from({length:7}).map((_,i)=><div key={i}><span/><span/><span/><span/><span/></div>)}</div>;
const EmptyState:React.FC<{compact?:boolean}>=({compact})=><div className={'finance-empty '+(compact?'compact':'')}><div><Inbox size={22}/></div><strong>Nenhum registro encontrado</strong>{!compact&&<p>Altere os filtros ou aguarde uma nova sincronização.</p>}</div>;
