import React from 'react';
import { Bell, AlertTriangle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useStore } from '../../contexts/StoreContext';

interface NotificationsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NotificationsModal: React.FC<NotificationsModalProps> = ({ isOpen, onClose }) => {
  const { notifications } = useStore();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Bell size={18} style={{ color: 'var(--primary)' }} />
          <span>Notificações do Sistema ({notifications.length})</span>
        </div>
      }
      maxWidth="480px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflowY: 'auto' }}>
        {notifications.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', padding: '24px 0', fontSize: '13px', textAlign: 'center' }}>
            Nenhuma notificação ou alerta pendente no momento.
          </div>
        ) : (
          notifications.map((notif, index) => (
            <div
              key={index}
              style={{
                padding: '10px 12px',
                background: 'var(--bg-surface-subtle)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                fontSize: '12.5px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                color: 'var(--text-primary)'
              }}
            >
              <AlertTriangle size={15} style={{ color: 'var(--badge-yellow)', flexShrink: 0, marginTop: 2 }} />
              <span>{notif}</span>
            </div>
          ))
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
        <button className="btn btn-outline" onClick={onClose}>
          Fechar
        </button>
      </div>
    </Modal>
  );
};
