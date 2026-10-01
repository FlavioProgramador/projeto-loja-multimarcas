import React, { lazy, Suspense, useEffect, useState } from 'react';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { StoreProvider, useStore } from './contexts/StoreContext';
import { CartProvider } from './contexts/CartContext';
import { AppLayout } from './components/layout/AppLayout';
import { ActiveModule } from './types';
import { AuthBootScreen, LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { getAuthScreen, goToApp, goToLogin, goToResetPassword, AuthScreen } from './lib/auth-routing';
import { canAccessModule } from './lib/permissions';


const DashboardView = lazy(() => import('./components/dashboard/DashboardView').then(m => ({ default: m.DashboardView })));
const PdvView = lazy(() => import('./components/pdv/PdvView').then(m => ({ default: m.PdvView })));
const InventoryView = lazy(() => import('./components/inventory/InventoryView').then(m => ({ default: m.InventoryView })));
const FinanceView = lazy(() => import('./components/finance/FinanceView').then(m => ({ default: m.FinanceView })));
const MovementsView = lazy(() => import('./components/movements/MovementsView').then(m => ({ default: m.MovementsView })));
const CustomersView = lazy(() => import('./components/customers/CustomersView').then(m => ({ default: m.CustomersView })));
const SuppliersView = lazy(() => import('./components/suppliers/SuppliersView').then(m => ({ default: m.SuppliersView })));
const ReportsView = lazy(() => import('./components/reports/ReportsView').then(m => ({ default: m.ReportsView })));
const AutomationsView = lazy(() => import('./components/automations/AutomationsView').then(m => ({ default: m.AutomationsView })));
const ReturnsView = lazy(() => import('./components/returns/ReturnsView').then(m => ({ default: m.ReturnsView })));

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
  const { loading, isAuthorized, isPasswordRecovery } = useAuth();
  const { activeStoreId, activeStoreRole } = useStore();
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

    if (isAuthorized && !isPasswordRecovery && (screen === 'login' || screen === 'register' || screen === 'forgot-password')) {
      goToApp(true);
    }
  }, [loading, isAuthorized, isPasswordRecovery, screen]);

  const handleNavigate = (module: ActiveModule) => {
    const target = activeStoreRole && canAccessModule(activeStoreRole, module) ? module : 'dashboard';
    setCurrentModule(target);
    window.location.hash = `#/${target}`;
  };

  useEffect(() => {
    if (!isAuthorized || !activeStoreRole) return;
    if (canAccessModule(activeStoreRole, currentModule)) return;

    setCurrentModule('dashboard');
    if (window.location.hash !== '#/dashboard') {
      window.location.hash = '#/dashboard';
    }
  }, [activeStoreRole, currentModule, isAuthorized]);

  if (loading) {
    return <AuthBootScreen />;
  }

  if (screen === 'forgot-password') {
    return <ForgotPasswordPage />;
  }

  if (screen === 'register') {
    return <RegisterPage />;
  }

  if (screen === 'reset-password' || isPasswordRecovery) {
    return <ResetPasswordPage />;
  }

  if (screen === 'privacy') {
    return <PrivacyPage />;
  }

  if (!isAuthorized) {
    return <LoginPage />;
  }

  if (!activeStoreId || !activeStoreRole) {
    return <AuthBootScreen />;
  }

  const safeModule = canAccessModule(activeStoreRole, currentModule) ? currentModule : 'dashboard';

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
      <Suspense fallback={<AuthBootScreen label="Carregando módulo" />}>
        {renderCurrentModule()}
      </Suspense>
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
