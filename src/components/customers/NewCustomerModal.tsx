import React, { useState } from 'react';
import { UserPlus, Loader2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useStore } from '../../contexts/StoreContext';

interface NewCustomerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const NewCustomerModal: React.FC<NewCustomerModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const { addCustomer } = useStore();

  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [rg, setRg] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [endereco, setEndereco] = useState('');
  const [dataNascimento, setDataNascimento] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setNome('');
    setCpf('');
    setRg('');
    setTelefone('');
    setEmail('');
    setEndereco('');
    setDataNascimento('');
    setError(null);
    setSaving(false);
  };

  const handleSave = async () => {
    if (!nome.trim() || !cpf.trim()) {
      setError('Os campos Nome e CPF são obrigatórios.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await addCustomer({
        nome: nome.trim(),
        cpf: cpf.trim(),
        rg: rg.trim(),
        telefone: telefone.trim(),
        email: email.trim(),
        endereco: endereco.trim(),
        dataNascimento: dataNascimento || ''
      });

      if (onSuccess) {
        onSuccess();
      }

      onClose();
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cadastrar cliente.');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (saving) return;
    onClose();
    resetForm();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={
        <>
          <UserPlus size={18} /> Novo Cliente
        </>
      }
      maxWidth="520px"
    >
      {/* ── Dados Pessoais ────────────────────────── */}
      <div style={{ marginBottom: '6px' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Dados Pessoais
        </span>
      </div>

      <div className="form-group">
        <label htmlFor="customer-nome">Nome Completo *</label>
        <input
          id="customer-nome"
          placeholder="Ex: Carlos Eduardo"
          value={nome}
          disabled={saving}
          onChange={e => { setNome(e.target.value); setError(null); }}
          style={{ borderColor: error && !nome.trim() ? 'var(--badge-red)' : undefined }}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <div className="form-group">
          <label htmlFor="customer-cpf">CPF *</label>
          <input
            id="customer-cpf"
            placeholder="000.000.000-00"
            value={cpf}
            disabled={saving}
            onChange={e => { setCpf(e.target.value); setError(null); }}
            style={{ borderColor: error && !cpf.trim() ? 'var(--badge-red)' : undefined }}
          />
        </div>
        <div className="form-group">
          <label htmlFor="customer-rg">RG</label>
          <input
            id="customer-rg"
            placeholder="00.000.000-0"
            value={rg}
            disabled={saving}
            onChange={e => setRg(e.target.value)}
          />
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="customer-data-nascimento">Data de Nascimento</label>
        <input
          id="customer-data-nascimento"
          type="date"
          value={dataNascimento}
          disabled={saving}
          onChange={e => setDataNascimento(e.target.value)}
          style={{ colorScheme: 'dark' }}
        />
      </div>

      {/* ── Contato ────────────────────────── */}
      <div style={{ margin: '14px 0 6px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Contato
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <div className="form-group">
          <label htmlFor="customer-telefone">Telefone / WhatsApp</label>
          <input
            id="customer-telefone"
            placeholder="(11) 99999-9999"
            value={telefone}
            disabled={saving}
            onChange={e => setTelefone(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="customer-email">E-mail</label>
          <input
            id="customer-email"
            type="email"
            placeholder="email@exemplo.com"
            value={email}
            disabled={saving}
            onChange={e => setEmail(e.target.value)}
          />
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="customer-endereco">Endereço</label>
        <input
          id="customer-endereco"
          placeholder="Rua, número, bairro, cidade"
          value={endereco}
          disabled={saving}
          onChange={e => setEndereco(e.target.value)}
        />
      </div>

      {/* Mensagem de Erro Visual */}
      {error && (
        <div style={{
          marginTop: '12px',
          padding: '10px 12px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--badge-red)',
          fontSize: '12.5px',
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          ⚠️ {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: '6px', marginTop: '14px' }}>
        <button
          type="button"
          className="btn"
          onClick={handleSave}
          disabled={saving}
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
        >
          {saving ? (
            <>
              <Loader2 size={16} className="spin" /> Salvando...
            </>
          ) : (
            'Salvar Cliente'
          )}
        </button>
        <button type="button" className="btn btn-outline" onClick={handleClose} disabled={saving} style={{ flex: 1 }}>
          Cancelar
        </button>
      </div>
    </Modal>
  );
};