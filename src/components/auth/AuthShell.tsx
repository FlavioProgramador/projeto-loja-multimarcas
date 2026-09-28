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
          <div className="auth-brand-logo-wrap">
            <img className="auth-brand-full-logo" src="/logo_completa.png" alt="CoreSys" />
          </div>
          <blockquote className="auth-brand-quote">
            “Mais controle para sua operação. Mais tempo para fazer seu negócio crescer.”
          </blockquote>
        </div>
        <div className="auth-brand-foot">Acesso restrito a usuários autorizados.</div>
      </aside>
      <main className="auth-main">{children}</main>
    </div>
  );
};
