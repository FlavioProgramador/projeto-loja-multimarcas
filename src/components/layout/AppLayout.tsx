import React, { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  ShoppingCart,
  Package,
  RotateCcw,
  DollarSign,
  ArrowLeftRight,
  Users,
  Truck,
  FileText,
  Zap,
  Moon,
  Sun,
  Search,
  Bell,
  UserRound,
} from 'lucide-react';
import { ActiveModule } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { HeaderAgenda } from './HeaderAgenda';

interface AppLayoutProps {
  currentModule: ActiveModule;
  onNavigate: (module: ActiveModule) => void;
  children: React.ReactNode;
}

const moduleLabels: Record<ActiveModule, string> = {
  dashboard: 'Dashboard',
  pdv: 'PDV / Caixa',
  estoque: 'Estoque & Produtos',
  trocas: 'Trocas & Devoluções',
  financeiro: 'Financeiro',
  movimentacoes: 'Movimentações',
  clientes: 'Clientes',
  fornecedores: 'Fornecedores',
  relatorios: 'Relatórios',
  automacoes: 'Automações',
};

const menuGroups = [
  {
    label: 'Principal',
    items: [
      { id: 'dashboard' as ActiveModule, label: 'Dashboard', icon: LayoutDashboard },
      { id: 'pdv' as ActiveModule, label: 'Vendas', icon: ShoppingCart },
    ],
  },
  {
    label: 'Catálogo',
    items: [
      { id: 'estoque' as ActiveModule, label: 'Estoque & Produtos', icon: Package },
      { id: 'trocas' as ActiveModule, label: 'Trocas & Devoluções', icon: RotateCcw },
      { id: 'movimentacoes' as ActiveModule, label: 'Movimentações', icon: ArrowLeftRight },
    ],
  },
  {
    label: 'Relacionamento',
    items: [
      { id: 'clientes' as ActiveModule, label: 'Clientes', icon: Users },
      { id: 'fornecedores' as ActiveModule, label: 'Fornecedores', icon: Truck },
    ],
  },
  {
    label: 'Gestão',
    items: [
      { id: 'financeiro' as ActiveModule, label: 'Financeiro', icon: DollarSign },
      { id: 'relatorios' as ActiveModule, label: 'Relatórios', icon: FileText },
      { id: 'automacoes' as ActiveModule, label: 'Automações', icon: Zap },
    ],
  },
];

const MODULE_PERMISSIONS: Record<ActiveModule, string[]> = {
  dashboard: ['ADMIN', 'MANAGER', 'CASHIER', 'EMPLOYEE'],
  pdv: ['ADMIN', 'MANAGER', 'CASHIER', 'EMPLOYEE'],
  estoque: ['ADMIN', 'MANAGER'],
  trocas: ['ADMIN', 'MANAGER'],
  financeiro: ['ADMIN', 'MANAGER'],
  movimentacoes: ['ADMIN', 'MANAGER'],
  clientes: ['ADMIN', 'MANAGER', 'CASHIER', 'EMPLOYEE'],
  fornecedores: ['ADMIN', 'MANAGER'],
  relatorios: ['ADMIN', 'MANAGER'],
  automacoes: ['ADMIN'],
};

export const AppLayout: React.FC<AppLayoutProps> = ({ currentModule, onNavigate, children }) => {
  const { user, profile, role } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const displayName = profile?.full_name || (user?.email ? user.email.split('@')[0] : 'Administrador');
  const roleLabel =
    role === 'ADMIN' ? 'Administrador' :
    role === 'MANAGER' ? 'Gerente' :
    role === 'CASHIER' ? 'Caixa' :
    'Colaborador';
  const initials = displayName.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase() || 'CS';

  return (
    <div className="app-layout">
      <aside className={`sidebar ${sidebarOpen ? 'open' : 'collapsed'}`}>
        <div className="logo-area">
          <div className="coresys-logo-mark">CS</div>
          <div className="coresys-brand-copy">
            <strong>CoreSys</strong>
            <span>Retail OS</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Menu principal">
          {menuGroups.map(group => {
            const visibleItems = group.items.filter(item => !user || MODULE_PERMISSIONS[item.id].includes(role));
            if (!visibleItems.length) return null;

            return (
              <section className="nav-group" key={group.label}>
                <div className="nav-section-title">{group.label}</div>
                <div className="nav-group-items">
                  {visibleItems.map(item => {
                    const Icon = item.icon;
                    const active = currentModule === item.id;

                    return (
                      <button
                        key={item.id}
                        className={`nav-item ${active ? 'active' : ''}`}
                        onClick={() => onNavigate(item.id)}
                        aria-current={active ? 'page' : undefined}
                      >
                        <Icon size={18} strokeWidth={1.9} />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user-card">
            <div className="user-avatar">{initials}</div>
            <div className="sidebar-user-copy">
              <strong>{displayName}</strong>
              <span>{roleLabel}</span>
            </div>
            <ChevronRight size={15} className="sidebar-user-chevron" />
          </div>
        </div>
      </aside>

      <div className={`main-wrapper ${sidebarOpen ? 'with-sidebar' : 'without-sidebar'}`}>
        <header className="header">
          <div className="header-left">
            <button
              className="icon-btn header-menu-btn"
              onClick={() => setSidebarOpen(open => !open)}
              aria-label={sidebarOpen ? 'Recolher menu' : 'Expandir menu'}
              title={sidebarOpen ? 'Recolher menu' : 'Expandir menu'}
            >
              {sidebarOpen ? <ChevronLeft size={17} /> : <ChevronRight size={17} />}
            </button>

            <div className="header-breadcrumb">
              <LayoutDashboard size={14} />
              <ChevronRight size={13} />
              <span>{currentModule === 'estoque' ? 'Produtos' : 'CoreSys'}</span>
              <ChevronRight size={13} />
              <strong>{moduleLabels[currentModule]}</strong>
            </div>
          </div>

          <div className="header-center-search">
            <Search size={16} />
            <input placeholder="Buscar no sistema..." aria-label="Buscar no sistema" />
            <span className="search-shortcut">⌘ K</span>
          </div>

          <div className="header-right">
            <HeaderAgenda />
            <button className="icon-btn" onClick={toggleTheme} aria-label="Alternar tema" title="Alternar tema">
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button className="icon-btn notification-btn" aria-label="Notificações">
              <Bell size={16} />
              <span className="notification-dot" />
            </button>
            <div className="header-profile">
              <div className="header-avatar">{initials}</div>
              <div className="header-profile-copy">
                <strong>{displayName}</strong>
                <span>{roleLabel}</span>
              </div>
              <UserRound size={14} />
            </div>
          </div>
        </header>

        <main className="page-content">
          {children}
        </main>
      </div>
    </div>
  );
};
