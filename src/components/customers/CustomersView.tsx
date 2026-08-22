import React, { useState } from 'react';
import { UserPlus, Search, User, ShoppingBag, ArrowRight } from 'lucide-react';
import { useStore } from '../../contexts/StoreContext';
import { Customer } from '../../types';
import { formatMoeda } from '../../lib/utils';
import { Modal } from '../ui/Modal';
import { StatusBadge } from '../ui/StatusBadge';
import { NewCustomerModal } from './NewCustomerModal';

export const CustomersView: React.FC = () => {
  const { customers } = useStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  const filtered = customers.filter(
    c =>
      c.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.cpf.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="module-fade">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Gestão de Clientes</h1>
          <p className="page-subtitle">Cadastro de clientes, histórico completo de compras e pontuação de fidelidade.</p>
        </div>
        <button className="btn" onClick={() => setIsNewModalOpen(true)}>
          <UserPlus size={16} /> Novo Cliente
        </button>
      </div>

      {/* Main Table Card */}
      <div className="table-wrap">
        <div className="table-header-bar">
          <div style={{ position: 'relative', width: '100%', maxWidth: '380px' }}>
            <Search
              size={15}
              style={{
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)'
              }}
            />
            <input
              placeholder="Buscar por nome, CPF ou e-mail..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{ paddingLeft: '36px', fontSize: '13px' }}
            />
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>
            {filtered.length} {filtered.length === 1 ? 'cliente cadastrado' : 'clientes cadastrados'}
          </span>
        </div>

        <table>
          <thead>
            <tr>
              <th>Cliente / Contato</th>
              <th>Documento (CPF)</th>
              <th>Telefone</th>
              <th>Frequência</th>
              <th style={{ textAlign: 'right' }}>Total Acumulado</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px' }}>
                  Nenhum cliente cadastrado ou correspondente à busca.
                </td>
              </tr>
            ) : (
              filtered.map(c => {
                const totalGasto = c.historico.reduce((acc, h) => acc + h.valor, 0);
                return (
                  <tr
                    key={c.id}
                    className="clickable-row"
                    onClick={() => setSelectedCustomer(c)}
                    title="Clique para ver o histórico detalhado"
                  >
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{c.nome}</div>
                      {c.email && (
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{c.email}</div>
                      )}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{c.cpf}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{c.telefone || '—'}</td>
                    <td>
                      <span className="badge-status neutral">{c.historico.length} compras</span>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--badge-green)' }}>
                      {formatMoeda(totalGasto)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <NewCustomerModal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
      />

      {/* Customer Purchase History Modal */}
      <Modal
        isOpen={!!selectedCustomer}
        onClose={() => setSelectedCustomer(null)}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <User size={18} style={{ color: 'var(--primary)' }} />
            <span>Perfil do Cliente: {selectedCustomer?.nome}</span>
          </div>
        }
        maxWidth="540px"
      >
        {selectedCustomer && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ background: 'var(--bg-surface-subtle)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '12.5px' }}>
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '11px' }}>CPF:</span>
                  <strong style={{ fontFamily: 'var(--font-mono)' }}>{selectedCustomer.cpf}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '11px' }}>Telefone:</span>
                  <strong>{selectedCustomer.telefone || 'Não informado'}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '11px' }}>E-mail:</span>
                  <strong>{selectedCustomer.email || 'Não informado'}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '11px' }}>Total Gasto:</span>
                  <strong style={{ color: 'var(--badge-green)', fontFamily: 'var(--font-mono)' }}>
                    {formatMoeda(selectedCustomer.historico.reduce((acc, h) => acc + h.valor, 0))}
                  </strong>
                </div>
              </div>
            </div>

            <div>
              <h4 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <ShoppingBag size={15} style={{ color: 'var(--primary)' }} /> Histórico de Compras ({selectedCustomer.historico.length})
              </h4>

              {selectedCustomer.historico.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', padding: '16px 0', fontSize: '12.5px', textAlign: 'center' }}>
                  Nenhuma compra registrada para este cliente ainda.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '220px', overflowY: 'auto' }}>
                  {selectedCustomer.historico.map((h, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '10px 12px',
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-md)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: '13px' }}>
                        <span style={{ color: 'var(--text-primary)' }}>{h.data} • {h.vendaId}</span>
                        <span style={{ color: 'var(--badge-green)', fontFamily: 'var(--font-mono)' }}>{formatMoeda(h.valor)}</span>
                      </div>
                      <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                        {h.itens}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
              <button className="btn btn-outline" onClick={() => setSelectedCustomer(null)}>
                Fechar
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
