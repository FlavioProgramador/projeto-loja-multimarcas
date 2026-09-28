import React from 'react';
import './auth-pages.css';

interface AuthShellProps {
  children: React.ReactNode;
}

export const AuthShell: React.FC<AuthShellProps> = ({ children }) => {
  return (
    <div className="auth-shell" data-theme="light">
      <aside className="auth-brand" aria-label="Identidade COREsys">
        <div>
          <div className="auth-brand-mark">
            <div className="auth-brand-logo" aria-hidden="true">CS</div>
            <div>
              <h1>COREsys</h1>
              <p>ERP e PDV para lojas de moda multimarcas.</p>
            </div>
          </div>
        </div>
        <div className="auth-brand-foot">Acesso restrito a usuários autorizados.</div>
      </aside>
      <main className="auth-main">{children}</main>
    </div>
  );
};
