import React, { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useStore } from '../../contexts/StoreContext';

interface NewCustomerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void; // Prop adicionada para disparar o aviso de sucesso sem alert()
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
  const [error, setError] = useState<string | null>(null); // Estado para o erro visual

  const resetForm = () => {
    setNome('');
    setCpf('');
    setRg('');
    setTelefone('');
    setEmail('');
    setEndereco('');
    setDataNascimento('');
    setError(null);
  };

  const handleSave = () => {
    if (!nome.trim() || !cpf.trim()) {
      setError('Os campos Nome e CPF são obrigatórios.');
      return;
    }

    addCustomer({
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
  };

  const handleClose = () => {
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
        <label>Nome Completo *</label>
        <input
          placeholder="Ex: Carlos Eduardo"
          value={nome}
          onChange={e => { setNome(e.target.value); setError(null); }}
          style={{ borderColor: error && !nome.trim() ? 'var(--badge-red)' : undefined }}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <div className="form-group">
          <label>CPF *</label>
          <input
            placeholder="000.000.000-00"
            value={cpf}
            onChange={e => { setCpf(e.target.value); setError(null); }}
            style={{ borderColor: error && !cpf.trim() ? 'var(--badge-red)' : undefined }}
          />
        </div>
        <div className="form-group">
          <label>RG</label>
          <input
            placeholder="00.000.000-0"
            value={rg}
            onChange={e => setRg(e.target.value)}
          />
        </div>
      </div>

      <div className="form-group">
        <label>Data de Nascimento</label>
        <input
          type="date"
          value={dataNascimento}
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
          <label>Telefone / WhatsApp</label>
          <input
            placeholder="(11) 99999-9999"
            value={telefone}
            onChange={e => setTelefone(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label>E-mail</label>
          <input
            type="email"
            placeholder="email@exemplo.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </div>
      </div>

      <div className="form-group">
        <label>Endereço</label>
        <input
          placeholder="Rua, número, bairro, cidade"
          value={endereco}
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
        <button type="button" className="btn" onClick={handleSave} style={{ flex: 1 }}>
          Salvar Cliente
        </button>
        <button type="button" className="btn btn-outline" onClick={handleClose} style={{ flex: 1 }}>
          Cancelar
        </button>
      </div>
    </Modal>
  );
};