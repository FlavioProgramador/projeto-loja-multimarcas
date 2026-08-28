import React from 'react';
import { DollarSign, ShoppingBag, TrendingUp, AlertTriangle, Sparkles, CheckCircle2, ArrowRight, Clock, Plus } from 'lucide-react';
import { useStore } from '../../contexts/StoreContext';
import { formatMoeda, hoje, mesAtual } from '../../lib/utils';
import { StatCard } from '../ui/StatCard';
import { StatusBadge } from '../ui/StatusBadge';
import { RevenueChart } from './RevenueChart';
import { TopProductsChart } from './TopProductsChart';

// Helpers
const getLast7Days = () => {
  const dates = [];
  const labels = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
    labels.push(d.toLocaleDateString('pt-BR', { weekday: 'short' }));
  }
  return { dates, labels };
};

export const DashboardView: React.FC = () => {
  const { transactions, movements, products, notifications } = useStore();

  const mesAtualStr = mesAtual();
  const transacoesMes = transactions.filter(t => t.data?.startsWith(mesAtualStr));
  const totalVendasMes = transacoesMes
    .filter(t => t.tipo === 'entrada')
    .reduce((acc, t) => acc + t.valor, 0);

  const totalVendas = transactions
    .filter(t => t.tipo === 'entrada')
    .reduce((acc, t) => acc + t.valor, 0);

  const totalSaidas = transactions
    .filter(t => t.tipo === 'saida')
    .reduce((acc, t) => acc + t.valor, 0);

  const lucro = totalVendas - totalSaidas;
  const entradasCount = transactions.filter(t => t.tipo === 'entrada').length || 1;
  const ticketMedio = totalVendas / entradasCount;

  const movHoje = movements.filter(m => m.data === hoje());

  // Count low stock skus
  let lowStockCount = 0;
  products.forEach(p => {
    p.skus.forEach(s => {
      if (s.qtd <= 2) {
        lowStockCount++;
      }
    });
  });

  const recentSales = movements.slice(0, 6);

  // --- Real Data for Revenue Chart (Last 7 Days) ---
  const { dates: last7Dates, labels: last7Labels } = getLast7Days();
  const revenueData = last7Dates.map(date => {
    return transactions
      .filter(t => t.data === date && t.tipo === 'entrada')
      .reduce((sum, t) => sum + t.valor, 0);
  });
  
  // Calculate delta between last week and previous week? Simple fallback for now
  const last7Total = revenueData.reduce((a, b) => a + b, 0);
  // Just a placeholder delta since we don't have 14 days history easily here, or we can just say "Ativo"
  const revenueDelta = `R$ ${formatMoeda(last7Total)}`;

  // --- Real Data for Top Products by Category ---
  const categoryCount: Record<string, number> = {};
  movements.forEach(m => {
    m.produtos.split(',').forEach(pItem => {
      const parts = pItem.split('x');
      const pName = parts[0].trim();
      const pQtd = parseInt(parts[1]) || 1;
      
      const prod = products.find(p => p.nome === pName);
      const cat = prod?.categoria || 'Outros';
      
      categoryCount[cat] = (categoryCount[cat] || 0) + pQtd;
    });
  });
  
  const categoryLabels = Object.keys(categoryCount);
  const categoryData = Object.values(categoryCount);

  return (
    <div className="module-fade">
      {/* Page Title & Actions */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Visão Geral</h1>
          <p className="page-subtitle">Acompanhe os principais indicadores da sua operação varejista em tempo real.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <a href="#/pdv" className="btn">
            <Plus size={16} />
            <span>Nova Venda</span>
          </a>
        </div>
      </div>

      {/* Bento Grid: 4 Top KPI Cards */}
      <div className="grid-cards">
        <StatCard
          label="Faturamento Mensal"
          value={formatMoeda(totalVendasMes || totalVendas)}
          icon={<DollarSign size={18} />}
          iconBg="var(--badge-blue-bg)"
          iconColor="var(--primary)"
          delta="+12.5%"
          deltaType="positive"
          deltaLabel="vs. mês anterior"
        />

        <StatCard
          label="Vendas Hoje"
          value={`${movHoje.length} pedidos`}
          icon={<ShoppingBag size={18} />}
          iconBg="var(--badge-green-bg)"
          iconColor="var(--badge-green)"
          delta="Fluxo estável"
          deltaType="positive"
          deltaLabel="movimentação contínua"
        />

        <StatCard
          label="Ticket Médio"
          value={formatMoeda(ticketMedio)}
          icon={<TrendingUp size={18} />}
          iconBg="var(--bg-surface-subtle)"
          iconColor="var(--text-secondary)"
          delta="+4.8%"
          deltaType="positive"
          deltaLabel="vendas premium"
        />

        <StatCard
          label="Itens em Baixa"
          value={`${lowStockCount} SKUs`}
          icon={<AlertTriangle size={18} />}
          iconBg={lowStockCount > 0 ? "var(--badge-red-bg)" : "var(--badge-green-bg)"}
          iconColor={lowStockCount > 0 ? "var(--badge-red)" : "var(--badge-green)"}
          delta={lowStockCount > 0 ? "Atenção necessária" : "Estoque seguro"}
          deltaType={lowStockCount > 0 ? "negative" : "positive"}
          deltaLabel={lowStockCount > 0 ? "repor estoque" : "todos os SKUs ok"}
        />
      </div>

      {/* Chart Row */}
      <div className="chart-row">
        <RevenueChart labels={last7Labels} data={revenueData} delta={revenueDelta} />
        <TopProductsChart labels={categoryLabels} data={categoryData} />
      </div>

      {/* Two Column Section */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: '20px',
          marginTop: '20px'
        }}
      >
        {/* Recent Sales Table */}
        <div className="table-wrap">
          <div className="table-header-bar">
            <div>
              <span className="table-header-title">Vendas Recentes</span>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Últimas transações realizadas no caixa</p>
            </div>
            <a
              href="#/movimentacoes"
              style={{
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--primary)',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              Ver todas <ArrowRight size={13} />
            </a>
          </div>
          <table>
            <thead>
              <tr>
                <th>Produto / Venda</th>
                <th>Cliente</th>
                <th>Valor</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recentSales.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '28px' }}>
                    Nenhuma venda registrada recentemente.
                  </td>
                </tr>
              ) : (
                recentSales.map(m => (
                  <tr key={m.id} className="clickable-row">
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{m.produtos}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {m.vendaId} • {m.formaPagamento}
                      </div>
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>{m.comprador || 'Consumidor Final'}</td>
                    <td style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                      {formatMoeda(m.valor)}
                    </td>
                    <td>
                      <StatusBadge status="Pago" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Right Sidebar Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Smart Insights Card */}
          <div className="card" style={{ flex: 1 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '14px',
                borderBottom: '1px solid var(--border-subtle)',
                paddingBottom: '10px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: 28, height: 28, borderRadius: 'var(--radius-md)', background: 'var(--primary-light)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Sparkles size={16} />
                </div>
                <div>
                  <h3 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>Smart Insights</h3>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Análise automática da operação</p>
                </div>
              </div>
              <span className="badge-status neutral">Tempo Real</span>
            </div>

            <div>
              {notifications.slice(0, 3).map((n, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '10px 0',
                    borderBottom: '1px solid var(--border-subtle)',
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                    color: 'var(--text-primary)'
                  }}
                >
                  <AlertTriangle size={15} style={{ color: 'var(--badge-yellow)', flexShrink: 0, marginTop: 2 }} />
                  <span>{n}</span>
                </div>
              ))}
              {notifications.length === 0 && (
                <div
                  style={{
                    color: 'var(--badge-green)',
                    fontSize: '12.5px',
                    padding: '16px 0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <CheckCircle2 size={16} /> Todos os parâmetros operacionais estão balanceados.
                </div>
              )}
            </div>
          </div>

          {/* Automation Feature Card */}
          <div className="card" style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)', color: '#ffffff', border: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', background: 'rgba(255,255,255,0.2)', padding: '2px 8px', borderRadius: '4px' }}>
                Retail Intelligence
              </span>
            </div>
            <h4 style={{ fontSize: '15px', fontWeight: 700, lineHeight: 1.3, marginBottom: '6px' }}>
              Automações Preditivas Ativas
            </h4>
            <p style={{ fontSize: '12px', opacity: 0.9, marginBottom: '14px', lineHeight: 1.4 }}>
              Alertas inteligentes para reposição de estoque, fluxo de caixa e fechamento de turno com total precisão.
            </p>
            <a
              href="#/automacoes"
              className="btn btn-sm"
              style={{
                backgroundColor: '#ffffff',
                color: '#1e3a8a',
                fontWeight: 700,
                border: 'none'
              }}
            >
              Configurar Automações <ArrowRight size={13} />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
