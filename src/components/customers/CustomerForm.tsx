import React, { useEffect, useState } from 'react';
import { Mail, MapPin, Phone, Save, UserRound } from 'lucide-react';
import type { Customer } from '../../types';
import { Modal } from '../ui/Modal';

export type CustomerFormData = {
  nome: string;
  cpf: string;
  rg: string;
  telefone: string;
  email: string;
  endereco: string;
  dataNascimento: string;
};

interface CustomerFormProps {
  isOpen: boolean;
  customer?: Customer | null;
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (data: CustomerFormData) => Promise<void>;
}

const digits = (value: string) => value.replace(/\D/g, '');
const formatCpf = (value: string) => {
  const v = digits(value).slice(0, 11);
  if (v.length <= 3) return v;
  if (v.length <= 6) return `${v.slice(0, 3)}.${v.slice(3)}`;
  if (v.length <= 9) return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6)}`;
  return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}`;
};
const formatPhone = (value: string) => {
  const v = digits(value).slice(0, 11);
  if (v.length <= 2) return v ? `(${v}` : '';
  if (v.length <= 6) return `(${v.slice(0, 2)}) ${v.slice(2)}`;
  if (v.length <= 10) return `(${v.slice(0, 2)}) ${v.slice(2, 6)}-${v.slice(6)}`;
  return `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}`;
};
const isValidEmail = (value: string) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const isValidCpf = (value: string) => {
  const cpf = digits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(cpf[i]) * (10 - i);
  let check = (sum * 10) % 11;
  if (check === 10) check = 0;
  if (check !== Number(cpf[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(cpf[i]) * (11 - i);
  check = (sum * 10) % 11;
  if (check === 10) check = 0;
  return check === Number(cpf[10]);
};

const emptyForm: CustomerFormData = {
  nome: '', cpf: '', rg: '', telefone: '', email: '', endereco: '', dataNascimento: '',
};

export const CustomerForm: React.FC<CustomerFormProps> = ({
  isOpen, customer, saving = false, error, onClose, onSubmit,
}) => {
  const [form, setForm] = useState<CustomerFormData>(emptyForm);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setForm(customer ? {
      nome: customer.nome,
      cpf: customer.cpf === 'Não informado' ? '' : customer.cpf,
      rg: customer.rg || '',
      telefone: customer.telefone || '',
      email: customer.email || '',
      endereco: customer.endereco || '',
      dataNascimento: customer.dataNascimento || '',
    } : emptyForm);
    setValidationError(null);
  }, [isOpen, customer]);

  const update = (field: keyof CustomerFormData, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setValidationError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.nome.trim()) return setValidationError('Informe o nome completo.');
    if (!isValidCpf(form.cpf)) return setValidationError('Informe um CPF válido.');
    if (!isValidEmail(form.email)) return setValidationError('Informe um e-mail válido.');
    await onSubmit({
      ...form,
      nome: form.nome.trim(),
      cpf: digits(form.cpf),
      rg: form.rg.trim(),
      telefone: digits(form.telefone),
      email: form.email.trim(),
      endereco: form.endereco.trim(),
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="620px" title={<><UserRound size={18}/> {customer ? 'Editar cliente' : 'Novo cliente'}</>}>
      <form onSubmit={submit} className="customer-form">
        <div className="customer-form-intro">
          <strong>{customer ? 'Atualize o cadastro' : 'Cadastre um novo cliente'}</strong>
          <span>Os dados ficam vinculados à loja ativa e são sincronizados com o banco.</span>
        </div>
        <div className="customer-form-section">
          <h3>Dados pessoais</h3>
          <div className="customer-form-grid">
            <div className="form-group customer-field-wide"><label>Nome completo *</label><input autoFocus value={form.nome} onChange={e => update('nome', e.target.value)} placeholder="Nome completo"/></div>
            <div className="form-group"><label>CPF *</label><input inputMode="numeric" value={formatCpf(form.cpf)} onChange={e => update('cpf', e.target.value)} placeholder="000.000.000-00"/></div>
            <div className="form-group"><label>RG</label><input value={form.rg} onChange={e => update('rg', e.target.value)} placeholder="RG"/></div>
            <div className="form-group"><label>Data de nascimento</label><input type="date" value={form.dataNascimento} onChange={e => update('dataNascimento', e.target.value)}/></div>
          </div>
        </div>
        <div className="customer-form-section">
          <h3>Contato e endereço</h3>
          <div className="customer-form-grid">
            <div className="form-group"><label><Phone size={12}/> Telefone / WhatsApp</label><input inputMode="tel" value={formatPhone(form.telefone)} onChange={e => update('telefone', e.target.value)} placeholder="(21) 99999-9999"/></div>
            <div className="form-group"><label><Mail size={12}/> E-mail</label><input type="email" value={form.email} onChange={e => update('email', e.target.value)} placeholder="cliente@exemplo.com"/></div>
            <div className="form-group customer-field-wide"><label><MapPin size={12}/> Endereço</label><input value={form.endereco} onChange={e => update('endereco', e.target.value)} placeholder="Rua, número, bairro, cidade"/></div>
          </div>
        </div>
        {(error || validationError) && <div className="customer-form-error">{error || validationError}</div>}
        <div className="customer-form-actions">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="btn" disabled={saving}>{saving ? 'Salvando...' : <><Save size={15}/> Salvar cliente</>}</button>
        </div>
      </form>
    </Modal>
  );
};
