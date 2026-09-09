import React from 'react';
import { useStore } from '../../contexts/StoreContext';
import { formatMoeda } from '../../lib/utils';
import { ArrowDownLeft, ArrowUpRight, Wallet, Check, RotateCcw, Calendar, FileText } from 'lucide-react';
import { StatCard } from '../ui/StatCard';
import { StatusBadge } from '../ui/StatusBadge';

export const FinanceView: React.FC = () => {
  const { transactions, fixedExpenses, toggleExpensePaid } = useStore();

  const entradas = transactions.filter(t => t.tipo === 'INCOME');
  const saidas = transactions.filter(t => t.tipo === 'EXPENSE');

  const totalEntradas = entradas.reduce((a, t) => a + t.valor, 0);
  const totalSaidas = saidas.reduce((a, t) => a + t.valor, 0);
  const saldo = totalEntradas - totalSaidas;

  const sortedTransactions = [...transactions].sort(
    (a, b) => new Date(b.data).getTime() - new Date(a.data).getTime()
  );

  return (
    <div className="module-fade">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Financeiro & Fluxo de Caixa</h1>
          <p className="page-subtitle">Acompanhe entradas de vendas, despesas operacionais, contas a pagar e saldo consolidado.</p>
        </div>
      </div>

      {/* 3 Metric Cards */}
      <div className="grid-cards" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <StatCard
          label="Total de Entradas"
          value={formatMoeda(totalEntradas)}
          icon={<ArrowDownLeft size={18} />}
          iconBg="var(--badge-green-bg)"
          iconColor="var(--badge-green)"
          delta={`${entradas.length} vendas registradas`}
          deltaType="positive"
          deltaLabel="fluxo de caixa"
        />

        <StatCard
          label="Total de Saídas"
          value={formatMoeda(totalSaidas)}
          icon={<ArrowUpRight size={18} />}
          iconBg="var(--badge-red-bg)"
          iconColor="var(--badge-red)"
          delta={`${saidas.length} despesas/custos`}
          deltaType="negative"
          deltaLabel="saídas liquidadas"
        />

        <StatCard
          label="Saldo Operacional"
          value={formatMoeda(saldo)}
          icon={<Wallet size={18} />}
          iconBg={saldo >= 0 ? "var(--badge-blue-bg)" : "var(--badge-red-bg)"}
          iconColor={saldo >= 0 ? "var(--primary)" : "var(--badge-red)"}
          delta={saldo >= 0 ? "Balanço positivo" : "Atenção ao fluxo"}
          deltaType={saldo >= 0 ? "positive" : "negative"}
          deltaLabel="resultado líquido"
        />
      </div>

      {/* Extrato Table */}
      <div className="table-wrap" style={{ marginBottom: '20px' }}>
        <div className="table-header-bar">
          <div>
            <span className="table-header-title">Extrato Financeiro Unificado</span>
            <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Histórico em tempo real de entradas e saídas de caixa</p>
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>
            {sortedTransactions.length} movimentações
          </span>
        </div>

        <table>
          <thead>
            <tr>
              <th>Data / Horário</th>
              <th>Tipo</th>
              <th>Origem / Descrição</th>
              <th style={{ textAlign: 'right' }}>Valor Líquido</th>
            </tr>
          </thead>
          <tbody>
            {sortedTransactions.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '28px' }}>
                  Nenhuma transação registrada no período.
                </td>
              </tr>
            ) : (
              sortedTransactions.map(t => {
                const isEntrada = t.tipo === 'INCOME';
                return (
                  <tr key={t.id}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{t.data}</td>
                    <td>
                      <StatusBadge status={isEntrada ? 'Entrada' : 'Saída'} />
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t.descricao}</div>
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontWeight: 600,
                        fontFamily: 'var(--font-mono)',
                        color: isEntrada ? 'var(--badge-green)' : 'var(--badge-red)'
                      }}
                    >
                      {isEntrada ? '+' : '-'} {formatMoeda(t.valor)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Despesas Fixas & Contas a Receber */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '16px' }}>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
              Despesas Fixas & Recorrentes
            </h3>
            <span className="badge-status neutral">{fixedExpenses.length} contas</span>
          </div>

          {fixedExpenses.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '12.5px', padding: '16px 0', textAlign: 'center' }}>
              Nenhuma despesa fixa cadastrada no sistema.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {fixedExpenses.map(d => (
                <div
                  key={d.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 12px',
                    background: 'var(--bg-surface-subtle)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    gap: '8px'
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>{d.descricao}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      Vencimento: dia {d.dataVencimento} • {d.categoria}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
                      {formatMoeda(d.valor)}
                    </span>
                    <StatusBadge status={d.pago ? 'Pago' : 'Pendente'} />
                    <button
                      className={`btn btn-sm ${d.pago ? 'btn-outline' : 'btn-success'}`}
                      onClick={() => toggleExpensePaid(d.id)}
                      style={{ padding: '4px 8px', fontSize: '11.5px' }}
                    >
                      {d.pago ? (
                        <>
                          <RotateCcw size={12} /> Desfazer
                        </>
                      ) : (
                        <>
                          <Check size={12} /> Pagar
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
              Contas a Receber (Varejo)
            </h3>
            <StatusBadge status="Normal" />
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5, padding: '8px 0' }}>
            Todas as transações realizadas no PDV (PIX, Dinheiro e Cartão de Crédito/Débito) estão liquidadas e sincronizadas com a adquirente.
          </div>
        </div>
      </div>
    </div>
  );
};
