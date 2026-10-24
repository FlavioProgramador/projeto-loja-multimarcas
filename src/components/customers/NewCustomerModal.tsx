import React, { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useStore } from '../../contexts/StoreContext';
import { validateCPF } from '../../lib/validation';

interface NewCustomerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const formatCpfInput = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
};

export const formatPhoneInput = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits ? `(${digits}` : '';
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
};

export const validateEmail = (email: string): boolean => {
  if (!email.trim()) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
};

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

  const handleCpfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const masked = formatCpfInput(e.target.value);
    setCpf(masked);
    if (error) setError(null);
  };

  const handleTelefoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const masked = formatPhoneInput(e.target.value);
    setTelefone(masked);
    if (error) setError(null);
  };

  const handleSave = () => {
    if (!nome.trim() || !cpf.trim()) {
      setError('Os campos Nome e CPF são obrigatórios.');
      return;
    }

    if (!validateCPF(cpf)) {
      setError('O CPF informado não é válido. Digite 11 números no formato 000.000.000-00.');
      return;
    }

    if (!validateEmail(email)) {
      setError('O e-mail informado é inválido.');
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

  const hasNameError = Boolean(error && !nome.trim());
  const hasCpfError = Boolean(error && (!cpf.trim() || !validateCPF(cpf)));
  const hasEmailError = Boolean(error && !validateEmail(email));

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
          onChange={e => { setNome(e.target.value); if (error) setError(null); }}
          aria-invalid={hasNameError}
          aria-describedby={error ? 'customer-form-error' : undefined}
          style={{ borderColor: hasNameError ? 'var(--badge-red)' : undefined }}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <div className="form-group">
          <label htmlFor="customer-cpf">CPF *</label>
          <input
            id="customer-cpf"
            placeholder="000.000.000-00"
            value={cpf}
            onChange={handleCpfChange}
            aria-invalid={hasCpfError}
            aria-describedby={error ? 'customer-form-error' : undefined}
            style={{ borderColor: hasCpfError ? 'var(--badge-red)' : undefined }}
          />
        </div>
        <div className="form-group">
          <label htmlFor="customer-rg">RG</label>
          <input
            id="customer-rg"
            placeholder="00.000.000-0"
            value={rg}
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
            onChange={handleTelefoneChange}
          />
        </div>
        <div className="form-group">
          <label htmlFor="customer-email">E-mail</label>
          <input
            id="customer-email"
            type="email"
            placeholder="email@exemplo.com"
            value={email}
            onChange={e => { setEmail(e.target.value); if (error) setError(null); }}
            aria-invalid={hasEmailError}
            aria-describedby={error ? 'customer-form-error' : undefined}
            style={{ borderColor: hasEmailError ? 'var(--badge-red)' : undefined }}
          />
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="customer-endereco">Endereço</label>
        <input
          id="customer-endereco"
          placeholder="Rua, número, bairro, cidade"
          value={endereco}
          onChange={e => setEndereco(e.target.value)}
        />
      </div>

      {/* Mensagem de Erro Visual */}
      {error && (
        <div
          id="customer-form-error"
          role="alert"
          style={{
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
          }}
        >
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
