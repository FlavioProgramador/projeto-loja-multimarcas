import React, { useState } from 'react';
import { Bot, RefreshCw, FileText, CheckCircle2, AlertTriangle, XCircle, DollarSign, Zap } from 'lucide-react';
import { useStore } from '../../contexts/StoreContext';
import { formatMoeda, hoje } from '../../lib/utils';
import { StatusBadge } from '../ui/StatusBadge';

export const AutomationsView: React.FC = () => {
  const { products, fixedExpenses, transactions, movements, customers, checkAlerts } = useStore();
  const [showAutoReport, setShowAutoReport] = useState(false);
  const [lastCheckMessage, setLastCheckMessage] = useState<string | null>(null);

  const alertas: { type: 'warning' | 'danger' | 'finance'; text: string }[] = [];

  products.forEach(p => {
    p.skus.forEach(s => {
      if (s.qtd <= 2 && s.qtd > 0) {
        alertas.push({
          type: 'warning',
          text: `${p.nome} (${s.tamanho}/${s.cor}) - Baixo estoque: ${s.qtd} un restantes`
        });
      }
      if (s.qtd === 0) {
        alertas.push({
          type: 'danger',
          text: `${p.nome} (${s.tamanho}/${s.cor}) - ESGOTADO (Reposição necessária)`
        });
      }
    });
  });

  fixedExpenses
    .filter(d => !d.pago)
    .forEach(d => {
      const dias = Math.ceil(
        (new Date(d.dataVencimento).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
      );
      if (dias <= 3 && dias >= 0) {
        alertas.push({
          type: 'finance',
          text: `Conta a pagar: ${d.descricao} vence em ${dias} dias - ${formatMoeda(d.valor)}`
        });
      }
    });

  const totalVendas = transactions
    .filter(t => t.tipo === 'entrada')
    .reduce((acc, t) => acc + t.valor, 0);
  const lucro =
    totalVendas -
    transactions.filter(t => t.tipo === 'saida').reduce((acc, t) => acc + t.valor, 0);

  const handleVerify = () => {
    checkAlerts();
    setLastCheckMessage('Verificação preditiva concluída. Alertas sincronizados.');
    setTimeout(() => setLastCheckMessage(null), 4000);
  };

  return (
    <div className="module-fade">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Automações & Inteligência Preditiva</h1>
          <p className="page-subtitle">Monitoramento de estoque mínimo, vencimento de duplicatas e relatórios executivos.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-outline" onClick={handleVerify}>
            <RefreshCw size={16} /> Sincronizar Regras
          </button>
          <button className="btn" onClick={() => setShowAutoReport(prev => !prev)}>
            <FileText size={16} /> {showAutoReport ? 'Ocultar Relatório' : 'Relatório Executivo'}
          </button>
        </div>
      </div>

      {lastCheckMessage && (
        <div
          style={{
            background: 'var(--badge-green)',
            color: '#ffffff',
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            marginBottom: '16px',
            fontSize: '13px',
            fontWeight: 600
          }}
        >
          {lastCheckMessage}
        </div>
      )}

      {/* Main Card */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: 32, height: 32, borderRadius: 'var(--radius-md)', background: 'var(--primary-light)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Bot size={18} />
            </div>
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                Fila de Alertas & Diagnósticos
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Regras ativas de verificação contínua</p>
            </div>
          </div>
          <span className="badge-status neutral">{alertas.length} avisos</span>
        </div>

        <div>
          {alertas.length === 0 ? (
            <div
              style={{
                color: 'var(--badge-green)',
                padding: '24px 0',
                fontSize: '13.5px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              <CheckCircle2 size={18} /> Excelente! Todos os produtos e pagamentos estão 100% regulares.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {alertas.map((a, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '12px 14px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-surface-subtle)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                  }}
                >
                  {a.type === 'warning' && (
                    <AlertTriangle size={16} style={{ color: 'var(--badge-yellow)', flexShrink: 0 }} />
                  )}
                  {a.type === 'danger' && (
                    <XCircle size={16} style={{ color: 'var(--badge-red)', flexShrink: 0 }} />
                  )}
                  {a.type === 'finance' && (
                    <DollarSign size={16} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                  )}
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{a.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Auto Executive Report */}
      {showAutoReport && (
        <div
          className="card"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--primary)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px',
            boxShadow: 'var(--shadow-md)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
            <Zap size={18} style={{ color: 'var(--primary)' }} />
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
              Relatório Executivo Automático — {hoje()}
            </h3>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '12px'
            }}
          >
            <div style={{ background: 'var(--bg-surface-subtle)', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', fontWeight: 600 }}>Faturamento Total</span>
              <div style={{ fontWeight: 700, fontSize: '18px', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', marginTop: '2px' }}>
                {formatMoeda(totalVendas)}
              </div>
            </div>

            <div style={{ background: 'var(--bg-surface-subtle)', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', fontWeight: 600 }}>Lucro Líquido</span>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: '18px',
                  fontFamily: 'var(--font-mono)',
                  color: lucro >= 0 ? 'var(--badge-green)' : 'var(--badge-red)',
                  marginTop: '2px'
                }}
              >
                {formatMoeda(lucro)}
              </div>
            </div>

            <div style={{ background: 'var(--bg-surface-subtle)', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', fontWeight: 600 }}>Total de Pedidos</span>
              <div style={{ fontWeight: 700, fontSize: '18px', fontFamily: 'var(--font-mono)', color: 'var(--primary)', marginTop: '2px' }}>
                {movements.length} vendas
              </div>
            </div>

            <div style={{ background: 'var(--bg-surface-subtle)', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', fontWeight: 600 }}>Base de Clientes</span>
              <div style={{ fontWeight: 700, fontSize: '18px', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', marginTop: '2px' }}>
                {customers.length} cadastrados
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
