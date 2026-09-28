import React, { useEffect, useState } from 'react';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
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
import { ReturnsView } from './components/returns/ReturnsView';
import { ActiveModule } from './types';
import { AuthBootScreen, LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { getAuthScreen, goToApp, goToLogin, goToResetPassword, AuthScreen } from './lib/auth-routing';

const VALID_MODULES: ActiveModule[] = [
  'dashboard',
  'pdv',
  'estoque',
  'trocas',
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
  trocas: ['ADMIN', 'MANAGER'],
  financeiro: ['ADMIN', 'MANAGER'],
  movimentacoes: ['ADMIN', 'MANAGER'],
  clientes: ['ADMIN', 'MANAGER', 'CASHIER', 'EMPLOYEE'],
  fornecedores: ['ADMIN', 'MANAGER'],
  relatorios: ['ADMIN', 'MANAGER'],
  automacoes: ['ADMIN']
};

function useAuthScreen(): AuthScreen {
  const [screen, setScreen] = useState<AuthScreen>(getAuthScreen);

  useEffect(() => {
    const sync = () => setScreen(getAuthScreen());
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, []);

  return screen;
}

export function AppContent() {
  const { loading, isAuthorized, isPasswordRecovery, role } = useAuth();
  const screen = useAuthScreen();
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

  useEffect(() => {
    if (loading) return;

    if (isPasswordRecovery && screen !== 'reset-password') {
      goToResetPassword(true);
      return;
    }

    if (!isAuthorized && screen === 'app') {
      goToLogin(true);
      return;
    }

    if (isAuthorized && !isPasswordRecovery && (screen === 'login' || screen === 'forgot-password')) {
      goToApp(true);
    }
  }, [loading, isAuthorized, isPasswordRecovery, screen]);

  const handleNavigate = (module: ActiveModule) => {
    setCurrentModule(module);
    window.location.hash = `#/${module}`;
  };

  if (loading) {
    return <AuthBootScreen />;
  }

  if (screen === 'forgot-password') {
    return <ForgotPasswordPage />;
  }

  if (screen === 'reset-password' || isPasswordRecovery) {
    return <ResetPasswordPage />;
  }

  if (!isAuthorized) {
    return <LoginPage />;
  }

  const hasPermission = role ? MODULE_PERMISSIONS[currentModule]?.includes(role) : false;
  const safeModule = hasPermission ? currentModule : 'dashboard';
  if (!hasPermission && window.location.hash !== '#/dashboard') {
    window.location.hash = '#/dashboard';
  }

  const renderCurrentModule = () => {
    switch (safeModule) {
      case 'dashboard':
        return <DashboardView />;
      case 'pdv':
        return <PdvView />;
      case 'estoque':
        return <InventoryView />;
      case 'trocas':
        return <ReturnsView />;
      case 'financeiro':
        return <FinanceView />;
      case 'movimentacoes':
        return <MovementsView />;
      case 'clientes':
        return <CustomersView />;
      case 'fornecedores':
        return <SuppliersView />;
      case 'relatorios':
        return <ReportsView />;
      case 'automacoes':
        return <AutomationsView />;
      default:
        return <DashboardView />;
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
