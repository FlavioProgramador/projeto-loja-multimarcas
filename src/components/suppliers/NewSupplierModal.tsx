import React, { useState } from 'react';
import { Truck } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useStore } from '../../contexts/StoreContext';

interface NewSupplierModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NewSupplierModal: React.FC<NewSupplierModalProps> = ({ isOpen, onClose }) => {
  const { addSupplier } = useStore();

  const [nome, setNome] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [contato, setContato] = useState('');
  const [email, setEmail] = useState('');
  const [endereco, setEndereco] = useState('');

  const handleSave = () => {
    if (!nome.trim() || !cnpj.trim()) {
      alert('Nome e CNPJ são obrigatórios.');
      return;
    }

    addSupplier({
      nome: nome.trim(),
      cnpj: cnpj.trim(),
      contato: contato.trim(),
      email: email.trim(),
      endereco: endereco.trim()
    });

    onClose();
    setNome('');
    setCnpj('');
    setContato('');
    setEmail('');
    setEndereco('');
    alert('Fornecedor cadastrado com sucesso!');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <>
          <Truck size={18} /> Novo Fornecedor
        </>
      }
    >
      <div className="form-group">
        <label>Razão Social / Nome Fantasia *</label>
        <input
          placeholder="Ex: Confecções Alpha Ltda"
          value={nome}
          onChange={e => setNome(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label>CNPJ *</label>
        <input
          placeholder="00.000.000/0000-00"
          value={cnpj}
          onChange={e => setCnpj(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label>Telefone / Contato</label>
        <input
          placeholder="(11) 3333-4444"
          value={contato}
          onChange={e => setContato(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label>E-mail Comercial</label>
        <input
          type="email"
          placeholder="comercial@fornecedor.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label>Endereço Comercial</label>
        <input
          placeholder="Rua, número, bairro, cidade - UF"
          value={endereco}
          onChange={e => setEndereco(e.target.value)}
        />
      </div>

      <div style={{ display: 'flex', gap: '6px', marginTop: '14px' }}>
        <button type="button" className="btn" onClick={handleSave} style={{ flex: 1 }}>
          Salvar Fornecedor
        </button>
        <button type="button" className="btn btn-outline" onClick={onClose} style={{ flex: 1 }}>
          Cancelar
        </button>
      </div>
    </Modal>
  );
};
