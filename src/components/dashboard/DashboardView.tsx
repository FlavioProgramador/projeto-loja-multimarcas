import React, { useState, useMemo } from 'react';
import {
  DollarSign, ShoppingBag, TrendingUp, AlertTriangle,
  ArrowRight, Plus, Calendar, Trophy, CreditCard,
  Package, Hash
} from 'lucide-react';
import { useStore } from '../../contexts/StoreContext';
import { formatMoeda, hoje } from '../../lib/utils';
import { StatCard } from '../ui/StatCard';
import { StatusBadge } from '../ui/StatusBadge';
import { RevenueChart } from './RevenueChart';
import { TopProductsChart } from './TopProductsChart';

// ─── Date Period Helpers ────────────────────────────────────────────────────────

type PeriodKey = 'hoje' | '7dias' | 'mes' | 'ano';

const PERIOD_LABELS: Record<PeriodKey, string> = {
  hoje: 'Hoje',
  '7dias': '7 Dias',
  mes: 'Este Mês',
  ano: 'Este Ano'
};


// Returns "YYYY-MM-DD" in the browser's LOCAL timezone — avoids UTC drift at GMT-3
function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getDateRange(period: PeriodKey): { start: string; end: string } {
  const now = new Date();
  const end = localDateStr(now);

  switch (period) {
    case 'hoje':
      return { start: end, end };
    case '7dias': {
      const d = new Date();
      d.setDate(d.getDate() - 6);
      return { start: localDateStr(d), end };
    }
    case 'mes': {
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      return { start: `${y}-${m}-01`, end };
    }
    case 'ano': {
      return { start: `${now.getFullYear()}-01-01`, end };
    }
  }
}

function getDatesInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  // Parse as local midnight to avoid DST/UTC shifting
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const current = new Date(sy, sm - 1, sd);
  const endDate = new Date(ey, em - 1, ed);
  while (current <= endDate) {
    dates.push(localDateStr(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}


function formatDateLabel(dateStr: string, period: PeriodKey): string {
  const d = new Date(dateStr + 'T12:00:00');
  if (period === 'hoje') return 'Hoje';
  if (period === '7dias') return d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric' });
  if (period === 'mes') return d.toLocaleDateString('pt-BR', { day: '2-digit' });
  // ano: group by month label
  return d.toLocaleDateString('pt-BR', { month: 'short' });
}

// ─── Product name parsing from movement string ────────────────────────────────

function parseProductEntries(prodString: string): { name: string; qty: number }[] {
  if (!prodString) return [];
  return prodString.split(',').map(segment => {
    const trimmed = segment.trim();
    // Format: "NomeProduto (Tamanho/Cor) x2"
    const xMatch = trimmed.match(/^(.+?)\s+x(\d+)$/);
    if (xMatch) {
      return { name: xMatch[1].trim(), qty: parseInt(xMatch[2]) || 1 };
    }
    return { name: trimmed, qty: 1 };
  });
}

function extractBaseProductName(entry: string): string {
  // "Camisa Polo (M/Azul) x2" -> "Camisa Polo"
  const parenIdx = entry.indexOf('(');
  if (parenIdx > 0) return entry.slice(0, parenIdx).trim();
  const xIdx = entry.lastIndexOf(' x');
  if (xIdx > 0) return entry.slice(0, xIdx).trim();
  return entry.trim();
}

// ─── Normalize payment method ──────────────────────────────────────────────────

function normalizePaymentMethod(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.startsWith('pix')) return 'PIX';
  if (lower.startsWith('cartão') || lower.startsWith('cartao') || lower.startsWith('crédito') || lower.startsWith('débito') || lower.startsWith('credito') || lower.startsWith('debito')) return 'Cartão';
  if (lower.startsWith('dinheiro')) return 'Dinheiro';
  if (lower.startsWith('boleto')) return 'Boleto';
  return raw.split(' ')[0]; // First word as fallback
}

// ─── Component ──────────────────────────────────────────────────────────────────

export const DashboardView: React.FC = () => {
  const { transactions, movements, products, notifications } = useStore();
  const [period, setPeriod] = useState<PeriodKey>('mes');

  const { start, end } = useMemo(() => getDateRange(period), [period]);

  // ── Filtered data ────────────────────────────────────────────────────────

  const filteredMovements = useMemo(
    () => movements.filter(m => m.data >= start && m.data <= end),
    [movements, start, end]
  );

  const filteredTransactions = useMemo(
    () => transactions.filter(t => t.data >= start && t.data <= end),
    [transactions, start, end]
  );

  // ── KPI Calculations ────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const income = filteredTransactions
      .filter(t => t.tipo === 'INCOME')
      .reduce((acc, t) => acc + t.valor, 0);

    const expenses = filteredTransactions
      .filter(t => t.tipo === 'EXPENSE')
      .reduce((acc, t) => acc + t.valor, 0);

    const salesCount = filteredMovements.length;
    const ticketMedio = salesCount > 0 ? income / salesCount : 0;

    // PA (Peças por Atendimento)
    let totalItemsSold = 0;
    filteredMovements.forEach(m => {
      const entries = parseProductEntries(m.produtos);
      entries.forEach(e => { totalItemsSold += e.qty; });
    });
    const pa = salesCount > 0 ? totalItemsSold / salesCount : 0;

    // Low stock count
    let lowStockCount = 0;
    products.forEach(p => {
      p.skus.forEach(s => {
        if (s.qtd <= 2) lowStockCount++;
      });
    });

    // Sales today
    const todayStr = hoje();
    const salesToday = movements.filter(m => m.data === todayStr).length;

    return { income, expenses, salesCount, ticketMedio, pa, totalItemsSold, lowStockCount, salesToday };
  }, [filteredTransactions, filteredMovements, products, movements]);

  // ── Revenue chart data ───────────────────────────────────────────────────

  const revenueChartData = useMemo(() => {
    if (period === 'ano') {
      // Group by month for the year
      const monthMap: Record<string, number> = {};
      const now = new Date();
      for (let m = 0; m <= now.getMonth(); m++) {
        const key = `${now.getFullYear()}-${String(m + 1).padStart(2, '0')}`;
        monthMap[key] = 0;
      }
      filteredTransactions
        .filter(t => t.tipo === 'INCOME')
        .forEach(t => {
          const monthKey = t.data.slice(0, 7);
          if (monthMap[monthKey] !== undefined) {
            monthMap[monthKey] += t.valor;
          }
        });
      const sortedKeys = Object.keys(monthMap).sort();
      return {
        labels: sortedKeys.map(k => {
          const d = new Date(k + '-15');
          return d.toLocaleDateString('pt-BR', { month: 'short' });
        }),
        data: sortedKeys.map(k => monthMap[k])
      };
    }

    const allDates = getDatesInRange(start, end);
    const dateMap: Record<string, number> = {};
    allDates.forEach(d => { dateMap[d] = 0; });

    filteredTransactions
      .filter(t => t.tipo === 'INCOME')
      .forEach(t => {
        if (dateMap[t.data] !== undefined) {
          dateMap[t.data] += t.valor;
        }
      });

    // For "mes" with many days, show last 15 max for readability
    let sortedDates = Object.keys(dateMap).sort();
    if (period === 'mes' && sortedDates.length > 15) {
      sortedDates = sortedDates.slice(-15);
    }

    return {
      labels: sortedDates.map(d => formatDateLabel(d, period)),
      data: sortedDates.map(d => dateMap[d])
    };
  }, [filteredTransactions, period, start, end]);

  // ── Category distribution (from actual product categories) ───────────────

  const categoryChartData = useMemo(() => {
    const categoryCount: Record<string, number> = {};

    filteredMovements.forEach(m => {
      const entries = parseProductEntries(m.produtos);
      entries.forEach(entry => {
        const baseName = extractBaseProductName(entry.name);
        const product = products.find(p =>
          p.nome.toLowerCase() === baseName.toLowerCase() ||
          baseName.toLowerCase().includes(p.nome.toLowerCase()) ||
          p.nome.toLowerCase().includes(baseName.toLowerCase())
        );
        const category = product?.categoria?.trim() || 'Sem Categoria';
        categoryCount[category] = (categoryCount[category] || 0) + entry.qty;
      });
    });

    // Sort by value descending
    const sorted = Object.entries(categoryCount).sort((a, b) => b[1] - a[1]);
    return {
      labels: sorted.map(([label]) => label),
      data: sorted.map(([, value]) => value)
    };
  }, [filteredMovements, products]);

  // ── Payment method distribution ──────────────────────────────────────────

  const paymentChartData = useMemo(() => {
    const paymentMap: Record<string, number> = {};

    filteredMovements.forEach(m => {
      const method = normalizePaymentMethod(m.formaPagamento);
      paymentMap[method] = (paymentMap[method] || 0) + m.valor;
    });

    const sorted = Object.entries(paymentMap).sort((a, b) => b[1] - a[1]);
    return {
      labels: sorted.map(([label]) => label),
      data: sorted.map(([, value]) => value)
    };
  }, [filteredMovements]);

  // ── Top 5 Products (Curva ABC) ───────────────────────────────────────────

  const top5Products = useMemo(() => {
    const productCount: Record<string, number> = {};

    filteredMovements.forEach(m => {
      const entries = parseProductEntries(m.produtos);
      entries.forEach(entry => {
        const baseName = extractBaseProductName(entry.name);
        productCount[baseName] = (productCount[baseName] || 0) + entry.qty;
      });
    });

    return Object.entries(productCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, qty], idx) => ({ rank: idx + 1, name, qty }));
  }, [filteredMovements]);

  // ── Recent sales for table ───────────────────────────────────────────────

  const recentSales = movements.slice(0, 6);

  // Helper to format product column cleanly
  const formatProductColumn = (prodString: string) => {
    const items = prodString.split(',').map(s => s.trim());
    if (items.length === 0) return { primary: 'Venda', extra: 0 };

    const firstName = extractBaseProductName(items[0]);
    return { primary: firstName, extra: items.length - 1 };
  };

  // ── Revenue total for delta badge ────────────────────────────────────────

  const revenueDelta = `R$ ${(kpis.income || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

  return (
    <div className="module-fade">
      {/* Page Header + Period Filter */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Visão Geral</h1>
          <p className="page-subtitle">Acompanhe os principais indicadores da sua operação varejista em tempo real.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* Period Selector */}
          <div style={{
            display: 'flex',
            background: 'var(--bg-surface-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '3px',
            gap: '2px',
            border: '1px solid var(--border-subtle)'
          }}>
            {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map(key => (
              <button
                key={key}
                onClick={() => setPeriod(key)}
                style={{
                  padding: '6px 14px',
                  fontSize: '12px',
                  fontWeight: period === key ? 700 : 500,
                  color: period === key ? 'var(--primary)' : 'var(--text-secondary)',
                  background: period === key ? 'var(--bg-surface)' : 'transparent',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  boxShadow: period === key ? 'var(--shadow-sm)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  whiteSpace: 'nowrap'
                }}
              >
                {key === period && <Calendar size={12} />}
                {PERIOD_LABELS[key]}
              </button>
            ))}
          </div>

          <a href="#/pdv" className="btn">
            <Plus size={16} />
            <span>Nova Venda</span>
          </a>
        </div>
      </div>

      {/* KPI Cards - 5 cards */}
      <div className="grid-cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
        <StatCard
          label="Faturamento no Período"
          value={formatMoeda(kpis.income)}
          icon={<DollarSign size={18} />}
          iconBg="var(--badge-blue-bg)"
          iconColor="var(--primary)"
          delta={`${kpis.salesCount} vendas`}
          deltaType="positive"
          deltaLabel={PERIOD_LABELS[period].toLowerCase()}
        />

        <StatCard
          label="Vendas Hoje"
          value={`${kpis.salesToday} pedidos`}
          icon={<ShoppingBag size={18} />}
          iconBg="var(--badge-green-bg)"
          iconColor="var(--badge-green)"
          delta={kpis.salesToday > 0 ? 'Ativo' : 'Nenhuma'}
          deltaType={kpis.salesToday > 0 ? 'positive' : 'neutral'}
          deltaLabel="movimentação do dia"
        />

        <StatCard
          label="Ticket Médio"
          value={formatMoeda(kpis.ticketMedio)}
          icon={<TrendingUp size={18} />}
          iconBg="var(--bg-surface-subtle)"
          iconColor="var(--text-secondary)"
          delta={`${kpis.totalItemsSold} itens`}
          deltaType="positive"
          deltaLabel="vendidos no período"
        />

        <StatCard
          label="PA (Peças/Atend.)"
          value={kpis.pa.toFixed(1)}
          icon={<Package size={18} />}
          iconBg="var(--badge-blue-bg)"
          iconColor="var(--primary)"
          delta={kpis.pa >= 2 ? 'Bom desempenho' : 'Pode melhorar'}
          deltaType={kpis.pa >= 2 ? 'positive' : 'neutral'}
          deltaLabel="itens por venda"
        />

        <StatCard
          label="Itens em Baixa"
          value={`${kpis.lowStockCount} SKUs`}
          icon={<AlertTriangle size={18} />}
          iconBg={kpis.lowStockCount > 0 ? "var(--badge-red-bg)" : "var(--badge-green-bg)"}
          iconColor={kpis.lowStockCount > 0 ? "var(--badge-red)" : "var(--badge-green)"}
          delta={kpis.lowStockCount > 0 ? "Atenção necessária" : "Estoque seguro"}
          deltaType={kpis.lowStockCount > 0 ? "negative" : "positive"}
          deltaLabel={kpis.lowStockCount > 0 ? "repor estoque" : "todos os SKUs ok"}
        />
      </div>

      {/* Chart Row: Revenue + Category */}
      <div className="chart-row">
        <RevenueChart
          labels={revenueChartData.labels}
          data={revenueChartData.data}
          delta={revenueDelta}
          title={`Faturamento Diário — ${PERIOD_LABELS[period]}`}
          subtitle="Receita por dia no período selecionado"
        />
        <TopProductsChart
          labels={categoryChartData.labels}
          data={categoryChartData.data}
          title="Distribuição por Categoria"
          subtitle="Volume vendido por categoria real"
        />
      </div>

      {/* Second Row: Payment Chart + Top 5 */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: '16px',
        marginBottom: '24px'
      }}>
        <TopProductsChart
          labels={paymentChartData.labels}
          data={paymentChartData.data}
          title="Faturamento por Forma de Pagamento"
          subtitle="Distribuição do valor recebido"
          colors={['#00674f', '#3ebb9e', '#73E6CB', '#0a3c30', '#8ab8ac']}
        />

        {/* Top 5 Card */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '280px', overflow: 'hidden' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '12px',
            paddingBottom: '10px',
            borderBottom: '1px solid var(--border-subtle)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: 28, height: 28, borderRadius: 'var(--radius-md)',
                background: 'var(--brand-primary)',
                color: 'var(--text-primary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <Trophy size={14} />
              </div>
              <div>
                <h3 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Top 5 Produtos
                </h3>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Mais vendidos — {PERIOD_LABELS[period]}
                </p>
              </div>
            </div>
            <span className="badge-status neutral" style={{ fontSize: '10px' }}>Curva ABC</span>
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0' }}>
            {top5Products.length === 0 ? (
              <div style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-muted)', fontSize: '12px'
              }}>
                Nenhuma venda no período selecionado.
              </div>
            ) : (
              top5Products.map((item, idx) => {
                const maxQty = top5Products[0]?.qty || 1;
                const barWidth = Math.max(8, (item.qty / maxQty) * 100);
                const medals = ['🥇', '🥈', '🥉'];
                return (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '8px 0',
                      borderBottom: idx < top5Products.length - 1 ? '1px solid var(--border-subtle)' : 'none'
                    }}
                  >
                    <span style={{
                      fontSize: idx < 3 ? '16px' : '12px',
                      width: '24px',
                      textAlign: 'center',
                      fontWeight: 700,
                      color: idx >= 3 ? 'var(--text-muted)' : undefined
                    }}>
                      {idx < 3 ? medals[idx] : `#${item.rank}`}
                    </span>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '12.5px',
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {item.name}
                      </div>
                      <div style={{
                        height: '4px',
                        borderRadius: '2px',
                        background: 'var(--bg-surface-subtle)',
                        marginTop: '4px',
                        overflow: 'hidden'
                      }}>
                        <div style={{
                          height: '100%',
                          width: `${barWidth}%`,
                          borderRadius: '2px',
                          background: idx === 0 ? 'var(--primary)' : idx === 1 ? 'var(--brand-secondary)' : idx === 2 ? 'var(--brand-accent)' : 'var(--primary)',
                          transition: 'width 0.3s ease'
                        }} />
                      </div>
                    </div>

                    <span style={{
                      fontSize: '12px',
                      fontWeight: 700,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-secondary)',
                      whiteSpace: 'nowrap'
                    }}>
                      {item.qty} und
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Bottom Section: Sales Table + Alerts */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: '20px'
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
                recentSales.map(m => {
                  const { primary, extra } = formatProductColumn(m.produtos);
                  return (
                    <tr key={m.id} className="clickable-row">
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '180px' }}>
                            {primary}
                          </span>
                          {extra > 0 && (
                            <span style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              color: 'var(--primary)',
                              background: 'var(--badge-blue-bg)',
                              padding: '2px 7px',
                              borderRadius: '10px',
                              whiteSpace: 'nowrap',
                              flexShrink: 0
                            }}>
                              +{extra} {extra === 1 ? 'item' : 'itens'}
                            </span>
                          )}
                        </div>
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
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Right Sidebar: Alerts + CTA */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Alerts Card */}
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
                <div style={{
                  width: 28, height: 28, borderRadius: 'var(--radius-md)',
                  background: 'var(--badge-red-bg)', color: 'var(--badge-red)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <AlertTriangle size={16} />
                </div>
                <div>
                  <h3 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>Alertas de Operação</h3>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Estoque baixo e vencimentos</p>
                </div>
              </div>
              <span className="badge-status neutral">{notifications.length > 0 ? `${notifications.length} alertas` : 'OK'}</span>
            </div>

            <div>
              {notifications.slice(0, 4).map((n, idx) => (
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
                  <Hash size={14} /> Todos os parâmetros operacionais estão balanceados.
                </div>
              )}
            </div>
          </div>

          {/* CTA Card */}
          <div className="card" style={{ background: 'var(--brand-deep)', color: 'var(--text-primary)', border: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', background: 'rgba(255,255,255,0.2)', padding: '2px 8px', borderRadius: '4px' }}>
                Retail Intelligence
              </span>
            </div>
            <h4 style={{ fontSize: '15px', fontWeight: 700, lineHeight: 1.3, marginBottom: '6px' }}>
              Análise Completa de Desempenho
            </h4>
            <p style={{ fontSize: '12px', opacity: 0.9, marginBottom: '14px', lineHeight: 1.4 }}>
              Acompanhe Curva ABC, ticket médio e PA em tempo real. Alertas inteligentes para reposição de estoque e fluxo de caixa.
            </p>
            <a
              href="#/relatorios"
              className="btn btn-sm"
              style={{
                backgroundColor: 'var(--text-primary)',
                color: 'var(--brand-deep)',
                fontWeight: 700,
                border: 'none'
              }}
            >
              Ver Relatórios <ArrowRight size={13} />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
