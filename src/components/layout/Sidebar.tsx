import React from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Boxes,
  RotateCcw,
  Coins,
  ListOrdered,
  Users,
  Truck,
  FileText,
  Bot
} from 'lucide-react';
import { ActiveModule } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useStore } from '../../contexts/StoreContext';
import { canAccessModule, getRoleLabel } from '../../lib/permissions';

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
  { id: 'trocas', label: 'Trocas & Devoluções', icon: <RotateCcw size={18} /> },
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
  const { user, profile } = useAuth();
  const { activeStoreRole } = useStore();

  const handleItemClick = (module: ActiveModule) => {
    onNavigate(module);
    if (window.innerWidth <= 900) onClose();
  };

  const displayName = profile?.full_name || (user?.email ? user.email.split('@')[0] : 'Administrador');
  const initials = displayName
    .split(' ')
    .map(n => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'CS';

  const filteredNavItems = NAV_ITEMS.filter(item =>
    !user || canAccessModule(activeStoreRole, item.id)
  );

  return (
    <>
      <div className={`sidebar-overlay ${isOpen ? 'active' : ''}`} onClick={onClose} />
      <aside className={`sidebar ${isOpen ? 'is-open' : 'is-collapsed'}`}>
        <div className="brand-area">
          <div className="brand-mark" aria-hidden="true">CS</div>
          <div className="brand-copy">
            <span className="brand-name">CoreSys</span>
            <span className="brand-caption">ERP & PDV</span>
          </div>
        </div>

        <nav className="sidebar-navigation" aria-label="Navegação principal">
          <section className="nav-group">
            <h2 className="nav-group-title">Módulos</h2>
            <div className="nav-group-items">
              {filteredNavItems.map(item => (
                <button
                  key={item.id}
                  className={`nav-item ${currentModule === item.id ? 'active' : ''}`}
                  onClick={() => handleItemClick(item.id)}
                  aria-current={currentModule === item.id ? 'page' : undefined}
                >
                  <span className="nav-icon">{item.icon}</span>
                  <span className="nav-label">{item.label}</span>
                </button>
              ))}
            </div>
          </section>
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-account">
            <div className="avatar avatar-sm">{initials}</div>
            <div className="account-copy">
              <strong>{displayName}</strong>
              <span>{getRoleLabel(activeStoreRole)}</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
