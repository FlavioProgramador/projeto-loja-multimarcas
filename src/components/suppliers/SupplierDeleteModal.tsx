import React from 'react';
import { Archive, XCircle } from 'lucide-react';
import type { Supplier } from '../../types';
import { Modal } from '../ui/Modal';

interface Props {
  supplier: Supplier | null;
  deleting?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export const SupplierDeleteModal: React.FC<Props> = ({ supplier, deleting = false, error, onClose, onConfirm }) => {
  if (!supplier) return null;
  return <Modal isOpen={true} onClose={onClose} maxWidth="470px" title={<><Archive size={18} /> Arquivar fornecedor</>}>
    <div className="supplier-delete-dialog">
      <div className="supplier-delete-icon"><XCircle size={22} /></div>
      <h3>Arquivar {supplier.nome}?</h3>
      <p>O fornecedor ficará inativo e sairá da lista atual. O registro no Supabase será preservado com exclusão lógica.</p>
      {error && <div className="supplier-form-error">{error}</div>}
      <div className="supplier-form-actions">
        <button className="btn btn-outline" onClick={onClose} disabled={deleting}>Cancelar</button>
        <button className="btn btn-danger" onClick={onConfirm} disabled={deleting}>{deleting ? 'Arquivando...' : 'Confirmar arquivamento'}</button>
      </div>
    </div>
  </Modal>;
};