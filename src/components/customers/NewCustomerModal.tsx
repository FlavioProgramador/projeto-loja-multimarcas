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
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [endereco, setEndereco] = useState('');

  const handleSave = () => {
    if (!nome.trim() || !cpf.trim()) {
      alert('Nome e CPF são obrigatórios.');
      return;
    }

    addCustomer({
      nome: nome.trim(),
      cpf: cpf.trim(),
      telefone: telefone.trim(),
      email: email.trim(),
      endereco: endereco.trim()
    });

    onClose();
    setNome('');
    setCpf('');
    setTelefone('');
    setEmail('');
    setEndereco('');
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
    >
      <div className="form-group">
        <label>Nome Completo *</label>
        <input
          placeholder="Ex: Carlos Eduardo"
          value={nome}
          onChange={e => setNome(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label>CPF *</label>
        <input
          placeholder="000.000.000-00"
          value={cpf}
          onChange={e => setCpf(e.target.value)}
        />
      </div>

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
