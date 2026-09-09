import React from 'react';
import { FileSpreadsheet, Printer, TrendingUp, Trophy, CreditCard, DollarSign, ShoppingBag } from 'lucide-react';
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

export const ReportsView: React.FC = () => {
  const { transactions, movements } = useStore();

  const mesAtualStr = mesAtual();
  const mesAntStr = mesAnterior();

  // Current month stats
  const transacoesMes = transactions.filter(t => t.data.startsWith(mesAtualStr));
  const totalVendasMes = transacoesMes
    .filter(t => t.tipo === 'INCOME')
    .reduce((acc, t) => acc + t.valor, 0);
  const totalSaidasMes = transacoesMes
    .filter(t => t.tipo === 'EXPENSE')
    .reduce((acc, t) => acc + t.valor, 0);
  const lucroMes = totalVendasMes - totalSaidasMes;
  const qtdVendasMes = movements.filter(m => m.data.startsWith(mesAtualStr)).length;
  const ticketMedioMes = qtdVendasMes > 0 ? totalVendasMes / qtdVendasMes : 0;

  // Previous month stats
  const transacoesAnt = transactions.filter(t => t.data.startsWith(mesAntStr));
  const totalVendasAnt = transacoesAnt
    .filter(t => t.tipo === 'INCOME')
    .reduce((acc, t) => acc + t.valor, 0);
  const totalSaidasAnt = transacoesAnt
    .filter(t => t.tipo === 'EXPENSE')
    .reduce((acc, t) => acc + t.valor, 0);
  const lucroAnt = totalVendasAnt - totalSaidasAnt;
  const qtdVendasAnt = movements.filter(m => m.data.startsWith(mesAntStr)).length;
  const ticketMedioAnt = qtdVendasAnt > 0 ? totalVendasAnt / qtdVendasAnt : 0;

  // Comparisons
  const compVendas = calcVariacao(totalVendasMes, totalVendasAnt);
  const compLucro = calcVariacao(lucroMes, lucroAnt);
  const compQtd = calcVariacao(qtdVendasMes, qtdVendasAnt);
  const compTicket = calcVariacao(ticketMedioMes, ticketMedioAnt);

  // Top products of the current month
  const vendasPorProduto: Record<string, number> = {};
  movements
    .filter(m => m.data.startsWith(mesAtualStr))
    .forEach(m => {
      m.produtos.split(',').forEach(item => {
        const clean = item.trim();
        if (!clean) return;
        const nome = clean.split(' x')[0];
        const qtd = parseInt(clean.split('x')[1]) || 1;
        vendasPorProduto[nome] = (vendasPorProduto[nome] || 0) + qtd;
      });
    });

  const topProdutos = Object.entries(vendasPorProduto)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const handleExportCSV = () => {
    let csv = 'Data,Venda,Comprador,CPF,Valor,Pagamento,Produtos\n';
    movements.forEach(m => {
      csv += `"${m.data}","${m.vendaId}","${m.comprador}","${m.cpf}","${m.valor.toFixed(2).replace('.', ',')}","${m.formaPagamento}","${m.produtos.replace(/"/g, '""')}"\n`;
    });
    downloadCSV(`relatorio_vendas_${hoje()}.csv`, csv);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="module-fade">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Relatórios & Inteligência de Vendas</h1>
          <p className="page-subtitle">Comparativo mensal consolidado de faturamento, margem de lucro e canais de receita.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-outline" onClick={handlePrint}>
            <Printer size={16} /> Imprimir Relatório
          </button>
          <button className="btn" onClick={handleExportCSV}>
            <FileSpreadsheet size={16} /> Exportar CSV
          </button>
        </div>
      </div>

      {/* Bento Grid: 4 Top KPI Cards */}
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
          label="Ticket Médio"
          value={formatMoeda(ticketMedioMes)}
          icon={<CreditCard size={18} />}
          iconBg="var(--badge-blue-bg)"
          iconColor="var(--primary)"
          delta={compTicket.texto}
          deltaType={compTicket.classe === 'positivo' ? 'positive' : 'negative'}
          deltaLabel={`vs ${mesAntStr}`}
        />
      </div>

      {/* Two Column Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '16px' }}>
        {/* Top Sold Products */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Trophy size={16} style={{ color: 'var(--badge-yellow)' }} /> Mais Vendidos no Mês
            </h3>
            <span className="badge-status neutral">{mesAtualStr}</span>
          </div>

          {topProdutos.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '12.5px', padding: '16px 0', textAlign: 'center' }}>
              Nenhuma venda registrada no mês atual.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {topProdutos.map(([nome, qtd], idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px',
                    background: 'var(--bg-surface-subtle)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)'
                  }}
                >
                  <span style={{ fontWeight: 500, fontSize: '13px', color: 'var(--text-primary)' }}>
                    #{idx + 1} {nome}
                  </span>
                  <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--primary)', fontSize: '13px' }}>
                    {qtd} un
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Payment Methods Breakdown */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CreditCard size={16} style={{ color: 'var(--primary)' }} /> Receita por Meio de Pagamento
            </h3>
            <span className="badge-status neutral">{mesAtualStr}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {['PIX', 'Cartão', 'Dinheiro'].map(method => {
              const total = movements
                .filter(m => m.formaPagamento.includes(method) && m.data.startsWith(mesAtualStr))
                .reduce((acc, mov) => acc + mov.valor, 0);

              return (
                <div
                  key={method}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 12px',
                    background: 'var(--bg-surface-subtle)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)'
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>{method}</span>
                  <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--badge-green)', fontSize: '13.5px' }}>
                    {formatMoeda(total)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
