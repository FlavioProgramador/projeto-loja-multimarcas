import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, LayoutDashboard, ShoppingCart, Package, DollarSign, ArrowLeftRight, Users, Truck, FileText, Zap } from 'lucide-react';
import { ActiveModule } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { HeaderAgenda } from './HeaderAgenda';

interface AppLayoutProps {
  currentModule: ActiveModule;
  onNavigate: (module: ActiveModule) => void;
  children: React.ReactNode;
}

const menuGroups = [
  {
    title: 'Visão geral',
    items: [{ id: 'dashboard' as ActiveModule, label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    title: 'Operações',
    items: [
      { id: 'pdv' as ActiveModule, label: 'PDV / Caixa', icon: ShoppingCart },
    ],
  },
  {
    title: 'Catálogo e estoque',
    items: [
      { id: 'estoque' as ActiveModule, label: 'Estoque & Produtos', icon: Package },
      { id: 'movimentacoes' as ActiveModule, label: 'Movimentações', icon: ArrowLeftRight },
    ],
  },
  {
    title: 'Relacionamento',
    items: [
      { id: 'clientes' as ActiveModule, label: 'Clientes', icon: Users },
      { id: 'fornecedores' as ActiveModule, label: 'Fornecedores', icon: Truck },
    ],
  },
  {
    title: 'Financeiro e relatórios',
    items: [
      { id: 'financeiro' as ActiveModule, label: 'Financeiro', icon: DollarSign },
      { id: 'relatorios' as ActiveModule, label: 'Relatórios', icon: FileText },
    ],
  },
  {
    title: 'Administração',
    items: [{ id: 'automacoes' as ActiveModule, label: 'Automações', icon: Zap }],
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

const moduleLabels: Record<ActiveModule, string> = {
  dashboard: 'Dashboard',
  pdv: 'PDV / Caixa',
  trocas: 'Trocas / Devoluções',
  estoque: 'Estoque & Produtos',
  financeiro: 'Financeiro',
  movimentacoes: 'Movimentações',
  clientes: 'Clientes',
  fornecedores: 'Fornecedores',
  relatorios: 'Relatórios',
  automacoes: 'Automações',
};

export const AppLayout: React.FC<AppLayoutProps> = ({ currentModule, onNavigate, children }) => {
  const { user, profile, role } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const displayName = profile?.full_name || (user?.email ? user.email.split('@')[0] : 'Administrador');
  const roleLabel = role === 'ADMIN'
    ? 'Administrador'
    : role === 'MANAGER'
      ? 'Gerente'
      : role === 'CASHIER'
        ? 'Caixa'
        : 'Colaborador';
  const initials = displayName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'CS';

  return (
    <div className="app-layout">
      <aside className={`sidebar ${isSidebarOpen ? 'is-open' : 'is-collapsed'}`}>
        <div className="brand-area">
          <div className="brand-mark" aria-hidden="true">CS</div>
          <div className="brand-copy">
            <span className="brand-name">CoreSys</span>
            <span className="brand-caption">ERP & PDV</span>
          </div>
        </div>

        <nav className="sidebar-navigation" aria-label="Navegação principal">
          {menuGroups.map(group => {
            const visibleItems = group.items.filter(item => !user || MODULE_PERMISSIONS[item.id].includes(role));
            if (visibleItems.length === 0) return null;

            return (
              <section key={group.title} className="nav-group">
                <h2 className="nav-group-title">{group.title}</h2>
                <div className="nav-group-items">
                  {visibleItems.map(item => {
                    const Icon = item.icon;
                    const active = currentModule === item.id;

                    return (
                      <button
                        key={item.id}
                        className={`nav-item ${active ? 'active' : ''}`}
                        onClick={() => {
                          onNavigate(item.id);
                          if (window.innerWidth <= 900) setIsSidebarOpen(false);
                        }}
                        aria-current={active ? 'page' : undefined}
                      >
                        <Icon size={18} strokeWidth={1.9} />
                        <span className="nav-label">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-account">
            <div className="avatar avatar-sm">{initials}</div>
            <div className="account-copy">
              <strong>{displayName}</strong>
              <span>{roleLabel}</span>
            </div>
          </div>
        </div>
      </aside>

      {isSidebarOpen === false && (
        <div className="mobile-nav-backdrop" onClick={() => setIsSidebarOpen(true)} aria-hidden="true" />
      )}

      <div className={`main-wrapper ${isSidebarOpen ? '' : 'sidebar-collapsed'}`}>
        <header className="header">
          <div className="header-left">
            <button
              className="icon-action menu-toggle"
              onClick={() => setIsSidebarOpen(prev => !prev)}
              aria-label={isSidebarOpen ? 'Recolher menu' : 'Expandir menu'}
              title={isSidebarOpen ? 'Recolher menu' : 'Expandir menu'}
            >
              {isSidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
            </button>

            <div className="breadcrumb">
              <span className="breadcrumb-overline">CoreSys</span>
              <span className="breadcrumb-divider">/</span>
              <strong>{moduleLabels[currentModule]}</strong>
            </div>
          </div>

          <div className="header-right">
            <HeaderAgenda />

            <button
              className="icon-action"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}
              aria-label="Alternar tema"
            >
              {theme === 'dark' ? '☼' : '◐' }
            </button>
          </div>
        </header>

        <main className="page-content">
          {children}
        </main>
      </div>
    </div>
  );
};
