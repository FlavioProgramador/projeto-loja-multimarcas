import React, { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useStore } from '../../contexts/StoreContext';

interface NewCustomerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NewCustomerModal: React.FC<NewCustomerModalProps> = ({ isOpen, onClose }) => {
  const { addCustomer } = useStore();

  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [rg, setRg] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [endereco, setEndereco] = useState('');
  const [dataNascimento, setDataNascimento] = useState('');

  const resetForm = () => {
    setNome('');
    setCpf('');
    setRg('');
    setTelefone('');
    setEmail('');
    setEndereco('');
    setDataNascimento('');
  };

  const handleSave = () => {
    if (!nome.trim() || !cpf.trim()) {
      alert('Nome e CPF são obrigatórios.');
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

    onClose();
    resetForm();
    alert('Cliente cadastrado com sucesso!');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
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
          onChange={e => setNome(e.target.value)}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <div className="form-group">
          <label>CPF *</label>
          <input
            placeholder="000.000.000-00"
            value={cpf}
            onChange={e => setCpf(e.target.value)}
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

      <div style={{ display: 'flex', gap: '6px', marginTop: '14px' }}>
        <button type="button" className="btn" onClick={handleSave} style={{ flex: 1 }}>
          Salvar Cliente
        </button>
        <button type="button" className="btn btn-outline" onClick={onClose} style={{ flex: 1 }}>
          Cancelar
        </button>
      </div>
    </Modal>
  );
};
