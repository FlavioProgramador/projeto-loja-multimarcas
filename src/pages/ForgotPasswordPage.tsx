import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { AuthShell } from '../components/auth/AuthShell';
import { AuthSuccessNotice } from './LoginPage';
import { useAuth } from '../contexts/AuthContext';
import { AUTH_RESET_GENERIC, mapAuthError } from '../lib/auth-errors';
import { goToLogin } from '../lib/auth-routing';

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export const ForgotPasswordPage: React.FC = () => {
  const { requestPasswordReset, isConfigured } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);

    if (!email.trim() || !isValidEmail(email)) {
      setErrorMsg('Informe um e-mail válido.');
      return;
    }

    if (!isConfigured) {
      setErrorMsg('O sistema de autenticação não está configurado neste ambiente.');
      return;
    }

    try {
      setLoading(true);
      await requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      console.error('Falha ao solicitar recuperação de senha.');
      setErrorMsg(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <div className="auth-card">
        <h2>Recuperar senha</h2>
        <p className="auth-lead">Informe o e-mail da sua conta. Enviaremos um link seguro de redefinição.</p>

        {sent ? (
          <AuthSuccessNotice>{AUTH_RESET_GENERIC}</AuthSuccessNotice>
        ) : (
          <>
            {errorMsg && (
              <div className="auth-alert error" role="alert">
                <AlertCircle size={16} />
                <span>{errorMsg}</span>
              </div>
            )}
            <form onSubmit={handleSubmit} noValidate>
              <div className="auth-field">
                <label htmlFor="reset-email">E-mail</label>
                <input
                  id="reset-email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  disabled={loading}
                />
              </div>
              <button type="submit" className="auth-submit" disabled={loading || !isConfigured}>
                {loading ? <span className="auth-spinner" aria-hidden="true" /> : null}
                {loading ? 'Enviando...' : 'Enviar instruções'}
              </button>
            </form>
          </>
        )}

        <div className="auth-row" style={{ marginTop: 18, justifyContent: 'flex-start' }}>
          <button type="button" className="auth-link" onClick={() => goToLogin()}>
            Voltar ao login
          </button>
        </div>
      </div>
    </AuthShell>
  );
};
