import React from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Boxes,
  Coins,
  ListOrdered,
  Users,
  Truck,
  FileText,
  Bot,
  Store
} from 'lucide-react';
import { ActiveModule } from '../../types';
import { useAuth } from '../../contexts/AuthContext';

interface SidebarProps {
  currentModule: ActiveModule;
  onNavigate: (module: ActiveModule) => void;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

interface NavItemConfig {
  id: ActiveModule;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItemConfig[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { id: 'pdv', label: 'PDV / Caixa', icon: <ShoppingCart size={18} /> },
  { id: 'estoque', label: 'Estoque & Produtos', icon: <Boxes size={18} /> },
  { id: 'financeiro', label: 'Financeiro', icon: <Coins size={18} /> },
  { id: 'movimentacoes', label: 'Movimentações', icon: <ListOrdered size={18} /> },
  { id: 'clientes', label: 'Clientes', icon: <Users size={18} /> },
  { id: 'fornecedores', label: 'Fornecedores', icon: <Truck size={18} /> },
  { id: 'relatorios', label: 'Relatórios', icon: <FileText size={18} /> },
  { id: 'automacoes', label: 'Automações', icon: <Bot size={18} /> }
];

export const Sidebar: React.FC<SidebarProps> = ({
  currentModule,
  onNavigate,
  isOpen,
  onClose
}) => {
  const { user, profile, role } = useAuth();

  const handleItemClick = (module: ActiveModule) => {
    onNavigate(module);
    if (window.innerWidth <= 768) {
      onClose();
    }
  };

  const displayName = profile?.full_name || (user?.email ? user.email.split('@')[0] : 'Admin Vestra');
  const roleName = `${role.toUpperCase()} • Gestão`;
  const initials = displayName
    .split(' ')
    .map(n => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase() || 'VT';

  return (
    <>
      <div
        className={`sidebar-overlay ${isOpen ? 'active' : ''}`}
        onClick={onClose}
      />
      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="logo-area">
          <div className="logo-icon-box">
            <Store size={20} />
          </div>
          <div>
            <h1 className="logo-title">VESTRA</h1>
            <p className="logo-subtitle">Retail Management</p>
          </div>
        </div>

        <div className="nav-section-title">Menu Principal</div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              className={`nav-item ${currentModule === item.id ? 'active' : ''}`}
              onClick={() => handleItemClick(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user-card">
            <div className="user-avatar">{initials}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {displayName}
              </p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {roleName}
              </p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
