import React from 'react';
import { Archive, XCircle } from 'lucide-react';
import type { Customer } from '../../types';
import { Modal } from '../ui/Modal';

interface CustomerDeleteModalProps {
  customer: Customer | null;
  deleting?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export const CustomerDeleteModal: React.FC<CustomerDeleteModalProps> = ({
  customer, deleting = false, error, onClose, onConfirm,
}) => {
  if (!customer) return null;
  return (
    <Modal isOpen={true} onClose={onClose} maxWidth="460px" title={<><Archive size={18} /> Arquivar cliente</>}>
      <div className="customer-delete-dialog">
        <div className="customer-delete-icon"><XCircle size={22}/></div>
        <h3>Arquivar {customer.nome}?</h3>
        <p>O cadastro será inativado e removido da lista de clientes ativos. O histórico de vendas permanece preservado no banco.</p>
        {error && <div className="customer-form-error">{error}</div>}
        <div className="customer-form-actions">
          <button className="btn btn-outline" onClick={onClose} disabled={deleting}>Cancelar</button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={deleting}>
            {deleting ? 'Arquivando...' : 'Confirmar arquivamento'}
          </button>
        </div>
      </div>
    </Modal>
  );
};