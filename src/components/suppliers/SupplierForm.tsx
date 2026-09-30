import React, { useEffect, useState } from 'react';
import { Building2, Mail, MapPin, Phone, Save, Truck } from 'lucide-react';
import type { Supplier } from '../../types';
import { Modal } from '../ui/Modal';

export type SupplierFormData = {
  nome: string;
  cnpj: string;
  contato: string;
  email: string;
  endereco: string;
};

interface Props {
  isOpen: boolean;
  supplier?: Supplier | null;
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (data: SupplierFormData) => Promise<void>;
}

const emptyForm: SupplierFormData = { nome: '', cnpj: '', contato: '', email: '', endereco: '' };
const formatCnpj = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return digits.slice(0, 2) + '.' + digits.slice(2);
  if (digits.length <= 8) return digits.slice(0, 2) + '.' + digits.slice(2, 5) + '.' + digits.slice(5);
  if (digits.length <= 12) return digits.slice(0, 2) + '.' + digits.slice(2, 5) + '.' + digits.slice(5, 8) + '/' + digits.slice(8);
  return digits.slice(0, 2) + '.' + digits.slice(2, 5) + '.' + digits.slice(5, 8) + '/' + digits.slice(8, 12) + '-' + digits.slice(12);
};
const formatPhone = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return '(' + digits.slice(0, 2) + ') ' + digits.slice(2);
  if (digits.length <= 10) return '(' + digits.slice(0, 2) + ') ' + digits.slice(2, 6) + '-' + digits.slice(6);
  return '(' + digits.slice(0, 2) + ') ' + digits.slice(2, 7) + '-' + digits.slice(7);
};

export const SupplierForm: React.FC<Props> = ({ isOpen, supplier, saving = false, error, onClose, onSubmit }) => {
  const [form, setForm] = useState<SupplierFormData>(emptyForm);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setForm(supplier ? {
      nome: supplier.nome || '',
      cnpj: supplier.cnpj === 'Não informado' ? '' : supplier.cnpj || '',
      contato: supplier.contato || '',
      email: supplier.email || '',
      endereco: supplier.endereco || '',
    } : emptyForm);
    setValidationError(null);
  }, [isOpen, supplier]);

  const update = (field: keyof SupplierFormData, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setValidationError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (form.nome.trim().length < 2) return setValidationError('Informe a razão social ou nome fantasia.');
    if (form.cnpj.replace(/\D/g, '').length !== 14) return setValidationError('Informe um CNPJ válido com 14 dígitos.');
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) return setValidationError('Informe um e-mail comercial válido.');
    await onSubmit({
      nome: form.nome.trim(),
      cnpj: form.cnpj.replace(/\D/g, ''),
      contato: form.contato.replace(/\D/g, ''),
      email: form.email.trim(),
      endereco: form.endereco.trim(),
    });
  };

  return <Modal isOpen={isOpen} onClose={onClose} maxWidth="640px" title={<><Truck size={18} /> {supplier ? 'Editar fornecedor' : 'Novo fornecedor'}</>}>
    <form className="supplier-form" onSubmit={submit}>
      <div className="supplier-form-intro">
        <strong>{supplier ? 'Atualize os dados comerciais' : 'Cadastre um fornecedor'}</strong>
        <span>Os dados são persistidos no Supabase e o UUID do banco é preservado.</span>
      </div>
      <div className="supplier-form-section">
        <h3><Building2 size={15} /> Empresa</h3>
        <div className="supplier-form-grid">
          <div className="form-group supplier-field-wide"><label>Razão social / nome fantasia *</label><input autoFocus value={form.nome} onChange={e => update('nome', e.target.value)} placeholder="Ex.: Confecções Alpha Ltda" /></div>
          <div className="form-group"><label>CNPJ *</label><input inputMode="numeric" value={formatCnpj(form.cnpj)} onChange={e => update('cnpj', e.target.value)} placeholder="00.000.000/0000-00" /></div>
        </div>
      </div>
      <div className="supplier-form-section">
        <h3><Phone size={15} /> Contato comercial</h3>
        <div className="supplier-form-grid">
          <div className="form-group supplier-field-wide"><label>Contato / responsável / telefone</label><input value={form.contato} onChange={e => update('contato', e.target.value)} placeholder="Nome do responsável ou telefone" /></div>
          <div className="form-group supplier-field-wide"><label><Mail size={12} /> E-mail comercial</label><input type="email" value={form.email} onChange={e => update('email', e.target.value)} placeholder="comercial@fornecedor.com" /></div>
        </div>
      </div>
      <div className="supplier-form-section">
        <h3><MapPin size={15} /> Endereço</h3>
        <div className="form-group"><label>Endereço comercial</label><textarea rows={3} value={form.endereco} onChange={e => update('endereco', e.target.value)} placeholder="Rua, número, bairro, cidade - UF" /></div>
      </div>
      {(error || validationError) && <div className="supplier-form-error">{error || validationError}</div>}
      <div className="supplier-form-actions">
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>Cancelar</button>
        <button type="submit" className="btn" disabled={saving}>{saving ? 'Salvando...' : <><Save size={15} /> Salvar fornecedor</>}</button>
      </div>
    </form>
  </Modal>;
};