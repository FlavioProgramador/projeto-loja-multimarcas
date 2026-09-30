import React from 'react';
import { Building2, Mail, MapPin, Pencil, Phone, Truck } from 'lucide-react';
import type { Supplier } from '../../types';
import { Modal } from '../ui/Modal';

interface Props {
  supplier: Supplier | null;
  onClose: () => void;
  onEdit: (supplier: Supplier) => void;
}

export const SupplierDetails: React.FC<Props> = ({ supplier, onClose, onEdit }) => {
  if (!supplier) return null;
  const initials = supplier.nome.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'FO';

  return <Modal isOpen={true} onClose={onClose} maxWidth="760px" title={<><Truck size={18} /> Perfil do fornecedor</>}>
    <div className="supplier-details">
      <header className="supplier-profile-head">
        <div className="supplier-profile-avatar">{initials}</div>
        <div className="supplier-profile-identity"><h2>{supplier.nome}</h2><span>{supplier.cnpj || 'CNPJ não informado'}</span></div>
        <button className="btn btn-sm" onClick={() => onEdit(supplier)}><Pencil size={14} /> Editar cadastro</button>
      </header>
      <div className="supplier-detail-grid">
        <section className="supplier-detail-panel">
          <h3><Building2 size={15} /> Empresa</h3>
          <div className="supplier-info-list">
            <div><span>CNPJ</span><strong>{supplier.cnpj || 'Não informado'}</strong></div>
            <div><span>Status</span><strong><span className="supplier-status-badge">Ativo</span></strong></div>
          </div>
        </section>
        <section className="supplier-detail-panel">
          <h3><Phone size={15} /> Contato comercial</h3>
          <div className="supplier-info-list">
            <div><span>Responsável / contato</span><strong>{supplier.contato || 'Não informado'}</strong></div>
            <div><span>E-mail</span><strong><Mail size={14} /> {supplier.email || 'Não informado'}</strong></div>
          </div>
        </section>
        <section className="supplier-detail-panel supplier-detail-panel-wide">
          <h3><MapPin size={15} /> Endereço</h3>
          <div className="supplier-address-value"><MapPin size={16} /><span>{supplier.endereco || 'Endereço não informado'}</span></div>
        </section>
      </div>
    </div>
  </Modal>;
};