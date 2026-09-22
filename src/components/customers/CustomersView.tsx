import React, { useState, useEffect } from 'react';
import { UserPlus, Search, User, ShoppingBag, ArrowRight, Pencil, Trash2, X } from 'lucide-react';
import { useStore } from '../../contexts/StoreContext';
import { Customer } from '../../types';
import { formatMoeda } from '../../lib/utils';
import { Modal } from '../ui/Modal';
import { StatusBadge } from '../ui/StatusBadge';
import { NewCustomerModal } from './NewCustomerModal';

export const CustomersView: React.FC = () => {
  // Nota: Certifique-se de ter updateCustomer e deleteCustomer no seu StoreContext
  const { customers, updateCustomer, deleteCustomer } = useStore() as any;

  const [searchTerm, setSearchTerm] = useState('');
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [notificationBanner, setNotificationBanner] = useState<string | null>(null);

  // Estados para Edição e Exclusão
  const [customerToEdit, setCustomerToEdit] = useState<Customer | null>(null);
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);

  // Estado do formulário de edição
  const [editForm, setEditForm] = useState({ nome: '', cpf: '', rg: '', telefone: '', email: '', endereco: '', dataNascimento: '' });
  const [editError, setEditError] = useState<string | null>(null);

  // Carrega os dados do cliente para o form quando clica em Editar
  useEffect(() => {
    if (customerToEdit) {
      setEditForm({
        nome: customerToEdit.nome,
        cpf: customerToEdit.cpf,
        rg: customerToEdit.rg || '',
        telefone: customerToEdit.telefone || '',
        email: customerToEdit.email || '',
        endereco: customerToEdit.endereco || '',
        dataNascimento: customerToEdit.dataNascimento || ''
      });
      setEditError(null);
    }
  }, [customerToEdit]);

  const showBanner = (message: string) => {
    setNotificationBanner(message);
    setTimeout(() => setNotificationBanner(null), 4000);
  };

  const handleSaveEdit = () => {
    if (!editForm.nome.trim() || !editForm.cpf.trim()) {
      setEditError('Os campos Nome e CPF são obrigatórios.');
      return;
    }

    if (updateCustomer && customerToEdit) {
      updateCustomer(customerToEdit.id, editForm);
      showBanner('✅ Cliente atualizado com sucesso!');
    } else {
      showBanner('⚠️ Função de atualizar cliente não encontrada no StoreContext.');
    }

    setCustomerToEdit(null);
  };

  const handleConfirmDelete = () => {
    if (deleteCustomer && customerToDelete) {
      deleteCustomer(customerToDelete.id);
      showBanner('✅ Cliente excluído com sucesso!');
    } else {
      showBanner('⚠️ Função de excluir cliente não encontrada no StoreContext.');
    }
    setCustomerToDelete(null);
  };

  const filtered = customers.filter(
    c =>
      c.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.cpf.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="module-fade" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Banner de Notificação Superior */}
      {notificationBanner && (
        <div style={{
          background: notificationBanner.includes('⚠️') ? '#f59e0b' : 'var(--badge-green)',
          color: '#fff', padding: '12px 18px', borderRadius: 'var(--radius-lg)',
          marginBottom: '16px', fontSize: '13.5px', fontWeight: 600, boxShadow: 'var(--shadow-md)',
          animation: 'fadeIn 0.2s ease-out'
        }}>
          {notificationBanner}
        </div>
      )}

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
              <th>Crédito / Vale</th>
              <th>Frequência</th>
              <th style={{ textAlign: 'right' }}>Total Acumulado</th>
              <th style={{ textAlign: 'center' }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px' }}>
                  Nenhum cliente cadastrado ou correspondente à busca.
                </td>
              </tr>
            ) : (
              filtered.map(c => {
                const totalGasto = c.historico.reduce((acc, h) => acc + h.valor, 0);
                const saldo = c.saldoCredito || 0;
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
                      {saldo > 0 ? (
                        <span className="badge-status success" style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                          🏷️ {formatMoeda(saldo)}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>R$ 0,00</span>
                      )}
                    </td>
                    <td>
                      <span className="badge-status neutral">{c.historico.length} compras</span>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--badge-green)' }}>
                      {formatMoeda(totalGasto)}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: '8px' }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); setCustomerToEdit(c); }}
                          style={{ border: 'none', background: 'var(--bg-surface-subtle)', padding: '6px', borderRadius: '4px', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}
                          title="Editar Cliente"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setCustomerToDelete(c); }}
                          style={{ border: 'none', background: 'var(--badge-red-bg)', padding: '6px', borderRadius: '4px', cursor: 'pointer', color: 'var(--badge-red)', display: 'flex', alignItems: 'center' }}
                          title="Excluir Cliente"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
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
        onSuccess={() => showBanner('✅ Cliente cadastrado com sucesso!')}
      />

      {/* ── Modal de Edição de Cliente ────────────────────────── */}
      <Modal
        isOpen={!!customerToEdit}
        onClose={() => setCustomerToEdit(null)}
        title={
          <>
            <Pencil size={18} /> Editar Cliente
          </>
        }
        maxWidth="520px"
      >
        <div style={{ marginBottom: '6px' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Dados Pessoais
          </span>
        </div>

        <div className="form-group">
          <label>Nome Completo *</label>
          <input
            placeholder="Ex: Carlos Eduardo"
            value={editForm.nome}
            onChange={e => { setEditForm({ ...editForm, nome: e.target.value }); setEditError(null); }}
            style={{ borderColor: editError && !editForm.nome.trim() ? 'var(--badge-red)' : undefined }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div className="form-group">
            <label>CPF *</label>
            <input
              placeholder="000.000.000-00"
              value={editForm.cpf}
              onChange={e => { setEditForm({ ...editForm, cpf: e.target.value }); setEditError(null); }}
              style={{ borderColor: editError && !editForm.cpf.trim() ? 'var(--badge-red)' : undefined }}
            />
          </div>
          <div className="form-group">
            <label>RG</label>
            <input
              placeholder="00.000.000-0"
              value={editForm.rg}
              onChange={e => setEditForm({ ...editForm, rg: e.target.value })}
            />
          </div>
        </div>

        <div className="form-group">
          <label>Data de Nascimento</label>
          <input
            type="date"
            value={editForm.dataNascimento}
            onChange={e => setEditForm({ ...editForm, dataNascimento: e.target.value })}
            style={{ colorScheme: 'dark' }}
          />
        </div>

        <div style={{ margin: '14px 0 6px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Contato
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div className="form-group">
            <label>Telefone / WhatsApp</label>
            <input
              placeholder="(11) 99999-9999"
              value={editForm.telefone}
              onChange={e => setEditForm({ ...editForm, telefone: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>E-mail</label>
            <input
              type="email"
              placeholder="email@exemplo.com"
              value={editForm.email}
              onChange={e => setEditForm({ ...editForm, email: e.target.value })}
            />
          </div>
        </div>

        <div className="form-group">
          <label>Endereço</label>
          <input
            placeholder="Rua, número, bairro, cidade"
            value={editForm.endereco}
            onChange={e => setEditForm({ ...editForm, endereco: e.target.value })}
          />
        </div>

        {editError && (
          <div style={{
            marginTop: '12px', padding: '10px 12px', background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 'var(--radius-md)',
            color: 'var(--badge-red)', fontSize: '12.5px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px'
          }}>
            ⚠️ {editError}
          </div>
        )}

        <div style={{ display: 'flex', gap: '6px', marginTop: '14px' }}>
          <button type="button" className="btn" onClick={handleSaveEdit} style={{ flex: 1 }}>
            Salvar Alterações
          </button>
          <button type="button" className="btn btn-outline" onClick={() => setCustomerToEdit(null)} style={{ flex: 1 }}>
            Cancelar
          </button>
        </div>
      </Modal>

      {/* ── Modal de Confirmação de Exclusão ────────────────────────── */}
      {customerToDelete && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.4)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          animation: 'fadeIn 0.15s ease-out'
        }}>
          <div style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-xl)', padding: '24px', width: '100%', maxWidth: '380px',
            boxShadow: 'var(--shadow-lg)'
          }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Trash2 size={18} color="var(--badge-red)" /> Excluir Cliente
            </h3>
            <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: 1.5 }}>
              Tem certeza que deseja excluir o cliente <strong>{customerToDelete.nome}</strong>? Todo o histórico associado também poderá ser impactado. Esta ação não pode ser desfeita.
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                type="button" className="btn btn-outline"
                onClick={() => setCustomerToDelete(null)}
                style={{ fontSize: '13px', padding: '8px 14px' }}
              >
                Cancelar
              </button>
              <button
                type="button" className="btn"
                onClick={handleConfirmDelete}
                style={{ fontSize: '13px', padding: '8px 14px', background: 'var(--badge-red)', color: '#fff', border: 'none' }}
              >
                Sim, excluir
              </button>
            </div>
          </div>
        </div>
      )}

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
        maxWidth="580px"
      >
        {selectedCustomer && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ background: 'var(--bg-surface-subtle)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', fontSize: '12.5px' }}>
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '11px' }}>CPF:</span>
                  <strong style={{ fontFamily: 'var(--font-mono)' }}>{selectedCustomer.cpf}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '11px' }}>RG:</span>
                  <strong style={{ fontFamily: 'var(--font-mono)' }}>{selectedCustomer.rg || 'Não informado'}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '11px' }}>Data de Nascimento:</span>
                  <strong>{selectedCustomer.dataNascimento ? new Date(selectedCustomer.dataNascimento + 'T00:00:00').toLocaleDateString('pt-BR') : 'Não informado'}</strong>
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
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '11px' }}>Saldo de Crédito:</span>
                  <strong style={{ color: (selectedCustomer.saldoCredito || 0) > 0 ? 'var(--primary)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '13.5px' }}>
                    🏷️ {formatMoeda(selectedCustomer.saldoCredito || 0)}
                  </strong>
                </div>
              </div>
              {selectedCustomer.endereco && (
                <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-color)', fontSize: '12.5px' }}>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '11px' }}>Endereço:</span>
                  <strong>{selectedCustomer.endereco}</strong>
                </div>
              )}
            </div>

            {/* Credit Movements */}
            {selectedCustomer.movimentacoesCredito && selectedCustomer.movimentacoesCredito.length > 0 && (
              <div>
                <h4 style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  🏷️ Histórico de Créditos / Vales ({selectedCustomer.movimentacoesCredito.length})
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '120px', overflowY: 'auto' }}>
                  {selectedCustomer.movimentacoesCredito.map((mc, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '8px 10px',
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-sm)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '11.5px'
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{mc.descricao}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '10.5px' }}>{mc.data}</div>
                      </div>
                      <strong style={{ color: mc.tipo === 'entrada' ? 'var(--badge-green)' : 'var(--badge-red)', fontFamily: 'var(--font-mono)' }}>
                        {mc.tipo === 'entrada' ? '+' : '-'} {formatMoeda(mc.valor)}
                      </strong>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h4 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <ShoppingBag size={15} style={{ color: 'var(--primary)' }} /> Histórico de Compras ({selectedCustomer.historico.length})
              </h4>

              {selectedCustomer.historico.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', padding: '16px 0', fontSize: '12.5px', textAlign: 'center' }}>
                  Nenhuma compra registrada para este cliente ainda.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
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