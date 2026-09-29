import React from 'react';
import { Download, FileSpreadsheet, TrendingUp, Trophy, CreditCard, DollarSign, ShoppingBag } from 'lucide-react';
import { useStore } from '../../contexts/StoreContext';
import {
  formatMoeda,
  hoje,
  mesAtual,
  mesAnterior,
  calcVariacao,
  downloadCSV
} from '../../lib/utils';
import { StatCard } from '../ui/StatCard';
import { downloadSalesReportPdf } from '../../lib/pdf/reports-pdf';

export const ReportsView: React.FC = () => {
  const { transactions, movements, userStores, activeStoreId } = useStore();

  const mesAtualStr = mesAtual();
  const mesAntStr = mesAnterior();
  const pertenceAoMes = (data: string | undefined, mes: string) =>
    typeof data === 'string' && data.startsWith(mes);

  const transacoesMes = transactions.filter(t => pertenceAoMes(t.data, mesAtualStr));
  const totalVendasMes = transacoesMes
    .filter(t => t.tipo === 'INCOME')
    .reduce((acc, t) => acc + t.valor, 0);
  const totalSaidasMes = transacoesMes
    .filter(t => t.tipo === 'EXPENSE')
    .reduce((acc, t) => acc + t.valor, 0);
  const lucroMes = totalVendasMes - totalSaidasMes;
  const vendasMes = movements.filter(m => pertenceAoMes(m.data, mesAtualStr));
  const qtdVendasMes = vendasMes.length;
  const ticketMedioMes = qtdVendasMes > 0 ? totalVendasMes / qtdVendasMes : 0;

  const transacoesAnt = transactions.filter(t => pertenceAoMes(t.data, mesAntStr));
  const totalVendasAnt = transacoesAnt
    .filter(t => t.tipo === 'INCOME')
    .reduce((acc, t) => acc + t.valor, 0);
  const totalSaidasAnt = transacoesAnt
    .filter(t => t.tipo === 'EXPENSE')
    .reduce((acc, t) => acc + t.valor, 0);
  const lucroAnt = totalVendasAnt - totalSaidasAnt;
  const qtdVendasAnt = movements.filter(m => pertenceAoMes(m.data, mesAntStr)).length;
  const ticketMedioAnt = qtdVendasAnt > 0 ? totalVendasAnt / qtdVendasAnt : 0;

  const compVendas = calcVariacao(totalVendasMes, totalVendasAnt);
  const compLucro = calcVariacao(lucroMes, lucroAnt);
  const compQtd = calcVariacao(qtdVendasMes, qtdVendasAnt);
  const compTicket = calcVariacao(ticketMedioMes, ticketMedioAnt);

  const vendasPorProduto: Record<string, number> = {};
  vendasMes.forEach(m => {
    (m.produtos || '').split(',').forEach(item => {
      const clean = item.trim();
      if (!clean) return;
      const match = clean.match(/^(.*)\s+x(\d+)$/i);
      const nome = (match?.[1] || clean).trim();
      const qtd = Number(match?.[2]) || 1;
      vendasPorProduto[nome] = (vendasPorProduto[nome] || 0) + qtd;
    });
  });

  const topProdutos = Object.entries(vendasPorProduto)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const paymentTotals = new Map<string, number>();
  vendasMes.forEach(m => {
    const method = (m.formaPagamento || 'Nao informado')
      .replace(/\s+\d+x\b/i, '')
      .replace(/\s+\(.*$/i, '')
      .trim() || 'Nao informado';
    paymentTotals.set(method, (paymentTotals.get(method) || 0) + m.valor);
  });

  const receitaPorPagamento = Array.from(paymentTotals.entries())
    .map(([method, amount]) => ({ method, amount }))
    .sort((a, b) => b.amount - a.amount);

  const storeName =
    userStores.find(store => store.store_id === activeStoreId)?.store_name ||
    'Loja';

  const handleExportCSV = () => {
    let csv = 'Data,Venda,Comprador,CPF,Valor,Pagamento,Produtos\n';
    movements.forEach(m => {
      csv += `"${m.data}","${m.vendaId}","${m.comprador}","${m.cpf}","${m.valor.toFixed(2).replace('.', ',')}","${m.formaPagamento}","${m.produtos.replace(/"/g, '""')}"\n`;
    });
    downloadCSV(`relatorio_vendas_${hoje()}.csv`, csv);
  };

  const handleExportPdf = () => {
    downloadSalesReportPdf({
      storeName,
      currentMonth: mesAtualStr,
      previousMonth: mesAntStr,
      generatedAt: new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date()),
      metrics: [
        { label: 'Faturamento', value: formatMoeda(totalVendasMes), comparison: `${compVendas.texto} vs ${mesAntStr}` },
        { label: 'Lucro operacional', value: formatMoeda(lucroMes), comparison: `${compLucro.texto} vs ${mesAntStr}` },
        { label: 'Volume de pedidos', value: `${qtdVendasMes} vendas`, comparison: `${compQtd.texto} vs ${mesAntStr}` },
        { label: 'Ticket medio', value: formatMoeda(ticketMedioMes), comparison: `${compTicket.texto} vs ${mesAntStr}` },
      ],
      revenueByPayment: receitaPorPagamento,
      topProducts: topProdutos.map(([name, quantity]) => ({ name, quantity })),
      sales: vendasMes.map(m => ({
        date: m.data,
        sale: m.vendaId,
        customer: m.comprador || 'Consumidor Final',
        payment: m.formaPagamento || 'Nao informado',
        amount: m.valor,
        products: m.produtos || 'Venda sem itens',
      })),
    });
  };

  return (
    <div className="module-fade">
      <div className="page-header">
        <div>
          <h1 className="page-title">Relatorios & Inteligencia de Vendas</h1>
          <p className="page-subtitle">Analise consolidada de faturamento, margem operacional, meios de pagamento e produtos vendidos.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn" onClick={handleExportPdf}>
            <Download size={16} /> Baixar PDF
          </button>
          <button className="btn btn-outline" onClick={handleExportCSV}>
            <FileSpreadsheet size={16} /> Exportar CSV
          </button>
        </div>
      </div>

      <div className="grid-cards">
        <StatCard
          label="Faturamento (Mês Atual)"
          value={formatMoeda(totalVendasMes)}
          icon={<DollarSign size={18} />}
          iconBg="var(--badge-blue-bg)"
          iconColor="var(--primary)"
          delta={compVendas.texto}
          deltaType={compVendas.classe === 'positivo' ? 'positive' : 'negative'}
          deltaLabel={`vs ${mesAntStr}`}
        />
        <StatCard
          label="Lucro Operacional"
          value={formatMoeda(lucroMes)}
          icon={<TrendingUp size={18} />}
          iconBg={lucroMes >= 0 ? "var(--badge-green-bg)" : "var(--badge-red-bg)"}
          iconColor={lucroMes >= 0 ? "var(--badge-green)" : "var(--badge-red)"}
          delta={compLucro.texto}
          deltaType={compLucro.classe === 'positivo' ? 'positive' : 'negative'}
          deltaLabel={`vs ${mesAntStr}`}
        />
        <StatCard
          label="Volume de Pedidos"
          value={`${qtdVendasMes} vendas`}
          icon={<ShoppingBag size={18} />}
          iconBg="var(--bg-surface-subtle)"
          iconColor="var(--text-secondary)"
          delta={compQtd.texto}
          deltaType={compQtd.classe === 'positivo' ? 'positive' : 'negative'}
          deltaLabel={`vs ${mesAntStr}`}
        />
        <StatCard
          label="Ticket Medio"
          value={formatMoeda(ticketMedioMes)}
          icon={<CreditCard size={18} />}
          iconBg="var(--badge-blue-bg)"
          iconColor="var(--primary)"
          delta={compTicket.texto}
          deltaType={compTicket.classe === 'positivo' ? 'positive' : 'negative'}
          deltaLabel={`vs ${mesAntStr}`}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '16px' }}>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Trophy size={16} style={{ color: 'var(--badge-yellow)' }} /> Mais Vendidos no Mes
            </h3>
            <span className="badge-status neutral">{mesAtualStr}</span>
          </div>
          {topProdutos.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '12.5px', padding: '16px 0', textAlign: 'center' }}>
              Nenhuma venda registrada no mes atual.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {topProdutos.slice(0, 5).map(([nome, qtd], idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--bg-surface-subtle)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
                  <span style={{ fontWeight: 500, fontSize: '13px', color: 'var(--text-primary)' }}>#{idx + 1} {nome}</span>
                  <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--primary)', fontSize: '13px' }}>{qtd} un</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CreditCard size={16} style={{ color: 'var(--primary)' }} /> Receita por Meio de Pagamento
            </h3>
            <span className="badge-status neutral">{mesAtualStr}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {(receitaPorPagamento.length ? receitaPorPagamento : [{ method: 'Nenhum', amount: 0 }]).map(({ method, amount }) => (
              <div key={method} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'var(--bg-surface-subtle)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
                <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>{method}</span>
                <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--badge-green)', fontSize: '13.5px' }}>{formatMoeda(amount)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
