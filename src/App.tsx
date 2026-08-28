import React, { useState, useEffect } from 'react';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import { StoreProvider } from './contexts/StoreContext';
import { CartProvider } from './contexts/CartContext';
import { AppLayout } from './components/layout/AppLayout';
import { DashboardView } from './components/dashboard/DashboardView';
import { PdvView } from './components/pdv/PdvView';
import { InventoryView } from './components/inventory/InventoryView';
import { FinanceView } from './components/finance/FinanceView';
import { MovementsView } from './components/movements/MovementsView';
import { CustomersView } from './components/customers/CustomersView';
import { SuppliersView } from './components/suppliers/SuppliersView';
import { ReportsView } from './components/reports/ReportsView';
import { AutomationsView } from './components/automations/AutomationsView';
import { AuthModal } from './components/auth/AuthModal';
import { useAuth } from './contexts/AuthContext';
import { ActiveModule } from './types';

const VALID_MODULES: ActiveModule[] = [
  'dashboard',
  'pdv',
  'estoque',
  'financeiro',
  'movimentacoes',
  'clientes',
  'fornecedores',
  'relatorios',
  'automacoes'
];

function getInitialModule(): ActiveModule {
  if (typeof window !== 'undefined') {
    const hash = window.location.hash.replace('#/', '').replace('#', '');
    if (VALID_MODULES.includes(hash as ActiveModule)) {
      return hash as ActiveModule;
    }
  }
  return 'dashboard';
}

const MODULE_PERMISSIONS: Record<ActiveModule, string[]> = {
  dashboard: ['ADMIN', 'MANAGER', 'CASHIER', 'EMPLOYEE'],
  pdv: ['ADMIN', 'MANAGER', 'CASHIER', 'EMPLOYEE'],
  estoque: ['ADMIN', 'MANAGER'],
  financeiro: ['ADMIN', 'MANAGER'],
  movimentacoes: ['ADMIN', 'MANAGER'],
  clientes: ['ADMIN', 'MANAGER', 'CASHIER', 'EMPLOYEE'],
  fornecedores: ['ADMIN', 'MANAGER'],
  relatorios: ['ADMIN', 'MANAGER'],
  automacoes: ['ADMIN']
};

export function AppContent() {
  const { user, loading, isConfigured, role } = useAuth();
  const [currentModule, setCurrentModule] = useState<ActiveModule>(getInitialModule);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#/', '').replace('#', '');
      if (VALID_MODULES.includes(hash as ActiveModule)) {
        setCurrentModule(hash as ActiveModule);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleNavigate = (module: ActiveModule) => {
    setCurrentModule(module);
    window.location.hash = `#/${module}`;
  };

  // ─── Auth Guard ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-main)', color: 'var(--text-secondary)', fontSize: '14px', gap: '10px' }}>
        <div className="spinner" style={{ width: 20, height: 20, border: '2px solid var(--border-color)', borderTop: '2px solid var(--primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        Carregando...
      </div>
    );
  }

  if (isConfigured && !user) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg-main)' }}>
        <AuthModal isOpen={true} onClose={() => {}} />
      </div>
    );
  }
  // ──────────────────────────────────────────────────────────────────────────

  // RBAC Guard
  const hasPermission = user ? MODULE_PERMISSIONS[currentModule]?.includes(role) : true;
  const safeModule = hasPermission ? currentModule : 'dashboard';
  if (!hasPermission && window.location.hash !== '#/dashboard') {
     window.location.hash = '#/dashboard';
  }

  const renderCurrentModule = () => {
    switch (safeModule) {
      case 'dashboard': return <DashboardView />;
      case 'pdv': return <PdvView />;
      case 'estoque': return <InventoryView />;
      case 'financeiro': return <FinanceView />;
      case 'movimentacoes': return <MovementsView />;
      case 'clientes': return <CustomersView />;
      case 'fornecedores': return <SuppliersView />;
      case 'relatorios': return <ReportsView />;
      case 'automacoes': return <AutomationsView />;
      default: return <DashboardView />;
    }
  };

  return (
    <AppLayout currentModule={safeModule} onNavigate={handleNavigate}>
      {renderCurrentModule()}
    </AppLayout>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <StoreProvider>
          <CartProvider>
            <AppContent />
          </CartProvider>
        </StoreProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

