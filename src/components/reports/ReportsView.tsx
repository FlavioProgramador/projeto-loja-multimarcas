import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Download, FileText, Package, RefreshCw, ShoppingBag, TrendingUp, WalletCards } from 'lucide-react';
import { useStore } from '../../contexts/StoreContext';
import { formatMoeda } from '../../lib/utils';
import { ReportsService } from '../../services/reports.service';
import type { ReportMonthlySeries, ReportOverview, ReportPaymentBreakdown } from '../../services/reports.service';
import { SalesService } from '../../services/sales.service';
import { downloadSalesReportPdf } from '../../lib/pdf/reports-pdf';
import { formatMovementType, formatPaymentMethod } from '../../lib/display-labels';
import './reports.css';

type PeriodPreset = '7d' | '30d' | '90d' | 'year' | 'custom';
const pad = (v:number) => String(v).padStart(2,'0');
const dateText = (d:Date) => d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());

function presetRange(p:Exclude<PeriodPreset,'custom'>):[string,string] {
  const end = new Date(); const start = new Date(end);
  if (p === '7d') start.setDate(end.getDate()-6);
  if (p === '30d') start.setDate(end.getDate()-29);
  if (p === '90d') start.setDate(end.getDate()-89);
  if (p === 'year') start.setMonth(0,1);
  return [dateText(start),dateText(end)];
}

export const ReportsView: React.FC = () => {
  const { activeStoreId, userStores } = useStore();
  const [preset,setPreset] = useState<PeriodPreset>('30d');
  const [[startDate,endDate],setRange] = useState<[string,string]>(presetRange('30d'));
  const [data,setData] = useState<ReportOverview|null>(null);
  const [top,setTop] = useState<Awaited<ReturnType<typeof ReportsService.getTopProducts>>>([]);
  const [products,setProducts] = useState<Awaited<ReturnType<typeof ReportsService.getProfitabilityByProduct>>>([]);
  const [categories,setCategories] = useState<Awaited<ReturnType<typeof ReportsService.getProfitabilityByCategory>>>([]);
  const [stock,setStock] = useState<Awaited<ReturnType<typeof ReportsService.getStockStatus>>>([]);
  const [moves,setMoves] = useState<Awaited<ReturnType<typeof ReportsService.getMovementSummary>>>([]);
  const [payments,setPayments] = useState<ReportPaymentBreakdown[]>([]);
  const [series,setSeries] = useState<ReportMonthlySeries[]>([]);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');

  const storeName = userStores.find(s=>s.store_id===activeStoreId)?.store_name || 'Loja ativa';

  const load = useCallback(async()=>{
    if(!activeStoreId || startDate>endDate) return;
    setLoading(true); setError('');
    try{
      const [summary,t,p,c,s,m] = await Promise.all([
        ReportsService.getCommercialSummary(activeStoreId,startDate,endDate),
        ReportsService.getTopProducts(activeStoreId,10),
        ReportsService.getProfitabilityByProduct(activeStoreId,startDate,endDate),
        ReportsService.getProfitabilityByCategory(activeStoreId,startDate,endDate),
        ReportsService.getStockStatus(activeStoreId),
        ReportsService.getMovementSummary(activeStoreId,startDate,endDate)
      ]);
      setData(summary.overview);
      setPayments(summary.payments);
      setSeries(summary.series);
      setTop(t);
      setProducts(p);
      setCategories(c);
      setStock(s);
      setMoves(m);
    }catch(e){ setError(e instanceof Error?e.message:'Erro ao carregar relatórios.'); }
    finally{ setLoading(false); }
  },[activeStoreId,startDate,endDate]);

  useEffect(()=>{void load();},[load]);

  const lowStock = useMemo(()=>stock.filter(x=>x.status==='LOW_STOCK').length,[stock]);
  const outStock = useMemo(()=>stock.filter(x=>x.status==='OUT_OF_STOCK').length,[stock]);
  const totalIn = moves.filter(x=>['ENTRY','RETURN','TRANSFER_IN'].includes(x.movement_type)).reduce((s,x)=>s+x.total_quantity,0);
  const totalOut = moves.filter(x=>['SALE','LOSS','TRANSFER_OUT','ADJUSTMENT','CORRECTION'].includes(x.movement_type)).reduce((s,x)=>s+x.total_quantity,0);
  const maxRevenue = Math.max(...series.map(x=>x.revenue),1);
  const bestMargins = useMemo(()=>[...products].sort((a,b)=>b.margin_value-a.margin_value).slice(0,8),[products]);
  const bestCategories = useMemo(()=>[...categories].sort((a,b)=>b.margin_value-a.margin_value).slice(0,8),[categories]);

  const presetClick = (p:PeriodPreset)=>{setPreset(p); if(p!=='custom') setRange(presetRange(p));};

  const exportPdf = async () => {
    if (!data || !activeStoreId) return;
    setLoading(true);
    try {
      const salesRows = await SalesService.getMovements(activeStoreId, { startDate, endDate });
      const currentMonth = startDate.slice(0, 7);
      const previous = new Date(Number(currentMonth.slice(0, 4)), Number(currentMonth.slice(5, 7)) - 2, 1);
      const previousMonth = previous.getFullYear() + '-' + String(previous.getMonth() + 1).padStart(2, '0');
      downloadSalesReportPdf({
        storeName, currentMonth, previousMonth,
        generatedAt: new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date()),
        metrics: [
          { label: 'Faturamento', value: formatMoeda(data.revenue), comparison: `${data.salesCount} vendas concluÃ­das` },
          { label: 'Ticket mÃ©dio', value: formatMoeda(data.averageTicket), comparison: `${data.salesCount} pedidos no perÃ­odo` },
          { label: 'Resultado operacional', value: formatMoeda(data.operatingResult), comparison: `Despesas: ${formatMoeda(data.expenses)}` },
          { label: 'Estoque disponÃ­vel', value: `${data.inventoryUnits} un.`, comparison: `${lowStock} baixo estoque Â· ${outStock} sem estoque` },
        ],
        revenueByPayment: payments.map(x => ({ method: x.method, amount: x.amount })),
        topProducts: top.map(x => ({ name: x.product_name, quantity: x.total_quantity_sold })),
        sales: salesRows
          .filter(x => x.tipo === 'INCOME')
          .map(x => ({ date: x.data, sale: x.vendaId, customer: x.comprador, payment: x.formaPagamento, amount: x.valor, products: x.produtos })),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'NÃ£o foi possÃ­vel gerar o PDF.');
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = ()=>{
    const rows = [
      ['Relatório CoreSys',storeName],['Período',startDate+' a '+endDate],[],
      ['Vendas',data?.salesCount||0],['Faturamento',data?.revenue||0],['Descontos',data?.discounts||0],
      ['Despesas',data?.expenses||0],['Resultado',data?.operatingResult||0],['Ticket médio',data?.averageTicket||0],
      ['Unidades em estoque',data?.inventoryUnits||0],[],['Produto','Quantidade','Receita'],
      ...top.map(x=>[x.product_name,x.total_quantity_sold,x.total_revenue])
    ];
    const csv = rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(';')).join('\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a'); a.href=url; a.download='relatorio-'+startDate+'-'+endDate+'.csv'; a.click(); URL.revokeObjectURL(url);
  };

  if(!activeStoreId) return <div className="reports-empty">Nenhuma loja ativa disponível.</div>;

  return <div id="reports-print-area" className="reports-page module-fade">
    <header className="reports-header">
      <div><div className="reports-eyebrow"><BarChart3 size={15}/> Inteligência comercial</div><h1 className="page-title">Relatórios</h1><p className="page-subtitle">Dados sincronizados com o backend de {storeName}.</p></div>
      <div className="reports-actions"><button className="btn btn-outline" onClick={()=>void load()} disabled={loading}><RefreshCw size={16}/> Atualizar</button><button className="btn btn-outline" onClick={exportPdf} disabled={!data||loading}><FileText size={16}/> PDF</button><button className="btn" onClick={exportCsv} disabled={!data||loading}><Download size={16}/> CSV</button></div>
    </header>
    <section className="reports-filters card"><div className="reports-presets">
      {(['7d','30d','90d','year','custom'] as PeriodPreset[]).map(p=><button key={p} onClick={()=>presetClick(p)} className={preset===p?'reports-preset active':'reports-preset'}>{p==='7d'?'7 dias':p==='30d'?'30 dias':p==='90d'?'90 dias':p==='year'?'Ano':'Personalizado'}</button>)}
    </div>{preset==='custom'&&<div className="reports-date-fields"><label>Início<input type="date" value={startDate} onChange={e=>setRange([e.target.value,endDate])}/></label><label>Fim<input type="date" value={endDate} onChange={e=>setRange([startDate,e.target.value])}/></label></div>}</section>
    {error&&<div className="reports-error">{error}</div>}
    <section className="reports-kpis">
      <div className="card reports-kpi"><span><ShoppingBag size={18}/> Vendas</span><strong>{data?.salesCount||0}</strong><small>Pedidos concluídos</small></div>
      <div className="card reports-kpi"><span><WalletCards size={18}/> Faturamento</span><strong>{formatMoeda(data?.revenue||0)}</strong><small>Receita no período</small></div>
      <div className="card reports-kpi"><span><TrendingUp size={18}/> Resultado</span><strong>{formatMoeda(data?.operatingResult||0)}</strong><small>Receita menos despesas</small></div>
      <div className="card reports-kpi"><span><Package size={18}/> Estoque</span><strong>{data?.inventoryUnits||0}</strong><small>{lowStock} baixo · {outStock} sem estoque</small></div>
    </section>
    <section className="reports-grid two">
      <div className="card reports-panel"><div className="reports-panel-head"><div><h2>Evolução de faturamento</h2><p>Vendas concluídas por mês.</p></div></div><div className="reports-series">{series.length?series.map(x=><div className="reports-series-row" key={x.label}><span>{x.label}</span><div className="reports-bar"><i style={{width:Math.max(4,x.revenue/maxRevenue*100)+'%'}}/></div><strong>{formatMoeda(x.revenue)}</strong></div>):<div className="reports-muted">Sem vendas no período.</div>}</div></div>
      <div className="card reports-panel"><div className="reports-panel-head"><div><h2>Meios de pagamento</h2><p>Receita por método.</p></div></div><div className="reports-list">{payments.length?payments.map(x=><div className="reports-list-row" key={x.method}><span>{formatPaymentMethod(x.method)}</span><strong>{formatMoeda(x.amount)}</strong></div>):<div className="reports-muted">Sem pagamentos no período.</div>}</div></div>
    </section>
    <section className="reports-grid two">
      <div className="card reports-panel"><div className="reports-panel-head"><div><h2>Produtos mais vendidos</h2><p>Ranking calculado pelo banco.</p></div></div><div className="reports-table-wrap"><table><thead><tr><th>Produto</th><th>Qtd.</th><th>Receita</th></tr></thead><tbody>{top.map((x,i)=><tr key={x.product_id}><td><b>#{i+1}</b> {x.product_name}</td><td>{x.total_quantity_sold}</td><td>{formatMoeda(x.total_revenue)}</td></tr>)}{!top.length&&<tr><td colSpan={3} className="reports-muted">Sem vendas.</td></tr>}</tbody></table></div></div>
      <div className="card reports-panel"><div className="reports-panel-head"><div><h2>Rentabilidade por produto</h2><p>Custo e margem vindos do backend.</p></div></div><div className="reports-table-wrap"><table><thead><tr><th>Produto</th><th>Receita</th><th>Margem</th></tr></thead><tbody>{bestMargins.map(x=><tr key={x.product_id}><td>{x.product_name}</td><td>{formatMoeda(x.total_revenue)}</td><td>{formatMoeda(x.margin_value)} · {x.margin_percentage.toFixed(1)}%</td></tr>)}{!bestMargins.length&&<tr><td colSpan={3} className="reports-muted">Sem dados.</td></tr>}</tbody></table></div></div>
    </section>
    <section className="reports-grid two">
      <div className="card reports-panel"><div className="reports-panel-head"><div><h2>Rentabilidade por categoria</h2><p>Margem consolidada.</p></div></div><div className="reports-table-wrap"><table><thead><tr><th>Categoria</th><th>Receita</th><th>Margem</th></tr></thead><tbody>{bestCategories.map(x=><tr key={x.category_id||x.category_name}><td>{x.category_name}</td><td>{formatMoeda(x.total_revenue)}</td><td>{formatMoeda(x.margin_value)} · {x.margin_percentage.toFixed(1)}%</td></tr>)}{!bestCategories.length&&<tr><td colSpan={3} className="reports-muted">Sem dados.</td></tr>}</tbody></table></div></div>
      <div className="card reports-panel"><div className="reports-panel-head"><div><h2>Movimentação de estoque</h2><p>Resumo do período.</p></div></div><div className="reports-stock-summary"><div><span>Entradas</span><strong>{totalIn}</strong></div><div><span>Saídas</span><strong>{totalOut}</strong></div><div><span>Saldo</span><strong>{totalIn-totalOut}</strong></div></div><div className="reports-list">{moves.map(x=><div className="reports-list-row" key={x.movement_type}><span>{formatMovementType(x.movement_type)}</span><strong>{x.total_quantity}</strong></div>)}</div></div>
    </section>
  </div>;
};
