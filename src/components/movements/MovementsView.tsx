import React, { useState } from 'react';
import { Inbox, User, ShoppingBag, ListOrdered, Calendar } from 'lucide-react';
import { useStore } from '../../contexts/StoreContext';
import { formatMoeda } from '../../lib/utils';
import { Modal } from '../ui/Modal';
import { StatusBadge } from '../ui/StatusBadge';

export const MovementsView: React.FC = () => {
  const { movements } = useStore();
  const [selectedBuyer, setSelectedBuyer] = useState<string | null>(null);

  const sortedMovements = [...movements].sort(
    (a, b) => new Date(b.data).getTime() - new Date(a.data).getTime()
  );

  const buyerHistory = selectedBuyer
    ? movements.filter(m => m.comprador === selectedBuyer)
    : [];

  const buyerTotalSpent = buyerHistory.reduce((acc, m) => acc + m.valor, 0);

  // Group purchased items
  const buyerProducts: Record<string, number> = {};
  if (selectedBuyer) {
    buyerHistory.forEach(m => {
      m.produtos.split(',').forEach(p => {
        const clean = p.trim();
        if (!clean) return;
        const parts = clean.split(' x');
        const name = parts[0];
        const qty = parseInt(parts[1]) || 1;
        buyerProducts[name] = (buyerProducts[name] || 0) + qty;
      });
    });
  }

  return (
    <div className="module-fade">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Histórico de Movimentações</h1>
          <p className="page-subtitle">Registro de vendas efetuadas, produtos expedidos e canais de pagamento.</p>
        </div>
      </div>

      {movements.length === 0 ? (
        <div
          className="card"
          style={{
            padding: '48px 24px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px'
          }}
        >
          <div style={{ width: 48, height: 48, borderRadius: 'var(--radius-full)', background: 'var(--bg-surface-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            <Inbox size={24} />
          </div>
          <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>Nenhuma movimentação registrada</h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', maxWidth: '400px' }}>
            Realize uma venda no módulo PDV para que os registros de saída e transação apareçam automaticamente aqui.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <div className="table-header-bar">
            <div>
              <span className="table-header-title">Vendas & Saídas Registradas</span>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Clique em uma linha para ver o detalhamento do cliente</p>
            </div>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>
              {sortedMovements.length} registros
            </span>
          </div>

          <table>
            <thead>
              <tr>
                <th>Data / Venda ID</th>
                <th>Cliente / Comprador</th>
                <th>Valor Total</th>
                <th>Forma de Pagamento</th>
                <th>Itens Comprados</th>
              </tr>
            </thead>
            <tbody>
              {sortedMovements.map(m => (
                <tr
                  key={m.id}
                  className="clickable-row"
                  onClick={() => setSelectedBuyer(m.comprador)}
                  title="Ver detalhes de compras deste cliente"
                >
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{m.data}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{m.vendaId}</div>
                  </td>
                  <td>
                    <strong style={{ color: 'var(--text-primary)' }}>{m.comprador || 'Consumidor Final'}</strong>
                  </td>
                  <td style={{ color: 'var(--badge-green)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                    {formatMoeda(m.valor)}
                  </td>
                  <td>
                    <StatusBadge status={m.formaPagamento} />
                  </td>
                  <td
                    style={{
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                      maxWidth: '260px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                    title={m.produtos}
                  >
                    {m.produtos}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Buyer Details Modal */}
      <Modal
        isOpen={!!selectedBuyer}
        onClose={() => setSelectedBuyer(null)}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <User size={18} style={{ color: 'var(--primary)' }} />
            <span>Histórico de Compras: {selectedBuyer}</span>
          </div>
        }
        maxWidth="500px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ background: 'var(--bg-surface-subtle)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Total de Pedidos:</span>
              <strong>{buyerHistory.length}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Total Gasto Acumulado:</span>
              <strong style={{ color: 'var(--badge-green)', fontFamily: 'var(--font-mono)' }}>{formatMoeda(buyerTotalSpent)}</strong>
            </div>
          </div>

          <div>
            <h4
              style={{
                fontSize: '13px',
                fontWeight: 700,
                color: 'var(--text-primary)',
                marginBottom: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <ShoppingBag size={15} style={{ color: 'var(--primary)' }} /> Itens mais comprados:
            </h4>
            <div
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden'
              }}
            >
              {Object.entries(buyerProducts).map(([name, qty]) => (
                <div
                  key={name}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    fontSize: '12.5px',
                    borderBottom: '1px solid var(--border-subtle)'
                  }}
                >
                  <span style={{ color: 'var(--text-primary)' }}>{name}</span>
                  <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{qty} un</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
            <button className="btn btn-outline" onClick={() => setSelectedBuyer(null)}>
              Fechar
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
