import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, LayoutDashboard, ShoppingCart, Package, RotateCcw, DollarSign, ArrowLeftRight, Users, Truck, FileText, Zap, Moon, Sun, LogIn } from 'lucide-react';
import { ActiveModule } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { HeaderAgenda } from './HeaderAgenda';

interface AppLayoutProps {
  currentModule: ActiveModule;
  onNavigate: (module: ActiveModule) => void;
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ currentModule, onNavigate, children }) => {
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'pdv', label: 'PDV / Caixa', icon: ShoppingCart },
    { id: 'estoque', label: 'Estoque & Produtos', icon: Package },
    { id: 'trocas', label: 'Trocas & Devoluções', icon: RotateCcw },
    { id: 'financeiro', label: 'Financeiro', icon: DollarSign },
    { id: 'movimentacoes', label: 'Movimentações', icon: ArrowLeftRight },
    { id: 'clientes', label: 'Clientes', icon: Users },
    { id: 'fornecedores', label: 'Fornecedores', icon: Truck },
    { id: 'relatorios', label: 'Relatórios', icon: FileText },
    { id: 'automacoes', label: 'Automações', icon: Zap },
  ];

  return (
    <div className="app-layout" style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-canvas)', position: 'relative' }}>

      {/* Sidebar Retrátil */}
      <aside style={{
        width: '260px',
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        position: 'fixed',
        top: 0,
        bottom: 0,
        left: isSidebarOpen ? 0 : '-260px',
        zIndex: 50,
        transition: 'left 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
      }}>
        {/* Logo / Header da Sidebar (Limpo, sem botão de fechar antigo) */}
        <div style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: 'var(--radius-md)', background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '14px' }}>
            V
          </div>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.1 }}>VESTRA</div>
            <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>Retail Management</div>
          </div>
        </div>

        {/* Navegação */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ fontSize: '10.5px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', padding: '8px 10px', letterSpacing: '0.05em' }}>
            Menu Principal
          </div>
          {menuItems.map(item => {
            const Icon = item.icon;
            const isActive = currentModule === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id as ActiveModule)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background: isActive ? 'var(--primary-light)' : 'transparent',
                  color: isActive ? 'var(--primary)' : 'var(--text-secondary)',
                  fontSize: '13px',
                  fontWeight: isActive ? 600 : 500,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.15s ease'
                }}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Utilizador / Rodapé da Sidebar */}
        <div style={{ padding: '16px', borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--bg-surface-subtle)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user?.email || 'Admin Vestra'}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Gestão Ativa</div>
            </div>
            {user && (
              <button onClick={signOut} style={{ border: 'none', background: 'transparent', color: 'var(--badge-red)', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}>
                Sair
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Botão de Seta Centralizado na Borda (Toggle Flutuante) */}
      <button
        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        style={{
          position: 'fixed',
          top: '50%',
          left: isSidebarOpen ? '246px' : '12px',
          transform: 'translateY(-50%)',
          width: '28px',
          height: '28px',
          borderRadius: '50%',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          color: 'var(--text-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: '0 2px 5px rgba(0,0,0,0.08)',
          zIndex: 60,
          transition: 'left 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
        title={isSidebarOpen ? "Minimizar menu" : "Expandir menu"}
      >
        {isSidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
      </button>

      {/* Conteúdo Principal */}
      <div style={{ flex: 1, marginLeft: isSidebarOpen ? '260px' : '0', display: 'flex', flexDirection: 'column', minHeight: '100vh', transition: 'margin-left 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }}>

        {/* Header Superior Limpo */}
        <header style={{
          height: '64px',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          position: 'sticky',
          top: 0,
          zIndex: 40
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
              {currentModule}
            </span>
          </div>

          {/* Ações do Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <HeaderAgenda />

            <button
              onClick={toggleTheme}
              style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '8px', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              title="Alternar tema"
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            {!user && (
              <button className="btn btn-sm" style={{ gap: '6px' }}>
                <LogIn size={14} /> Entrar
              </button>
            )}
          </div>
        </header>

        {/* Corpo da Página */}
        <main style={{ flex: 1, padding: '24px 32px', maxWidth: '1440px', width: '100%', margin: '0 auto' }}>
          {children}
        </main>
      </div>

    </div>
  );
};