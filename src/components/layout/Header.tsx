import React, { useState } from 'react';
import { Menu, Bell, Moon, Sun, Search, LogIn, LogOut, Store } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { useStore } from '../../contexts/StoreContext';
import { useAuth } from '../../contexts/AuthContext';
import { AuthModal } from '../auth/AuthModal';

interface HeaderProps {
  onToggleSidebar: () => void;
  onOpenNotifications: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onToggleSidebar, onOpenNotifications }) => {
  const { theme, toggleTheme } = useTheme();
  const { notifications, userStores, activeStoreId, setActiveStoreId } = useStore();
  const { user, profile, signOut } = useAuth();
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  const displayName = profile?.full_name || (user?.email ? user.email.split('@')[0] : 'Admin');
  const initials = displayName
    .split(' ')
    .map(n => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase() || 'AD';

  return (
    <>
      <header className="header">
        <div className="header-left">
          <button
            className="hamburger-btn"
            onClick={onToggleSidebar}
            aria-label="Abrir menu lateral"
          >
            <Menu size={18} />
          </button>
          
          <div className="global-search">
            <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar produtos, vendas, clientes..."
              aria-label="Busca global"
            />
          </div>
        </div>

        <div className="header-right">
          {userStores.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 16 }}>
              <Store size={16} style={{ color: 'var(--text-muted)' }} />
              {userStores.length > 1 ? (
                <select
                  value={activeStoreId || ''}
                  onChange={(e) => setActiveStoreId(e.target.value)}
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    padding: '4px 8px',
                    color: 'var(--text)',
                    fontSize: '0.85rem'
                  }}
                >
                  {userStores.map(s => (
                    <option key={s.store_id} value={s.store_id}>{s.store_name}</option>
                  ))}
                </select>
              ) : (
                <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>
                  {userStores[0].store_name}
                </span>
              )}
            </div>
          )}

          <button
            className="icon-btn"
            onClick={onOpenNotifications}
            title="Notificações e Alertas"
            aria-label="Notificações"
          >
            <Bell size={18} />
            {notifications.length > 0 && <span className="badge-dot" />}
          </button>

          <button
            className="icon-btn"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Alternar para Modo Claro' : 'Alternar para Modo Escuro'}
            aria-label="Alternar tema"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {user ? (
            <button
              className="header-user-btn"
              onClick={() => {
                if (window.confirm('Deseja encerrar a sessão?')) {
                  signOut();
                }
              }}
              title="Clique para encerrar sessão"
            >
              <div className="user-avatar" style={{ width: 26, height: 26, fontSize: 11 }}>
                {initials}
              </div>
              <span style={{ maxWidth: 120, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {displayName}
              </span>
              <LogOut size={14} style={{ color: 'var(--text-muted)' }} />
            </button>
          ) : (
            <button
              className="btn btn-sm"
              onClick={() => setIsAuthModalOpen(true)}
            >
              <LogIn size={15} />
              <span>Entrar</span>
            </button>
          )}
        </div>
      </header>

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />
    </>
  );
};
