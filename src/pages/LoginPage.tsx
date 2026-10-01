import React, { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { AuthShell } from '../components/auth/AuthShell';
import { useAuth } from '../contexts/AuthContext';
import { mapAuthError, AUTH_ACCESS_DENIED, AUTH_SESSION_EXPIRED } from '../lib/auth-errors';
import { goToForgotPassword, goToPrivacy, goToRegister } from '../lib/auth-routing';
import { getRememberAccess } from '../lib/auth-storage';

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export const LoginPage: React.FC = () => {
  const { signIn, isConfigured, denialReason } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(getRememberAccess());
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const denialMessage = useMemo(() => {
    if (denialReason === 'unauthenticated') return null;
    if (denialReason === 'no_store_access') {
      return 'Sua conta foi criada, mas ainda não está vinculada a uma loja ativa.';
    }
    if (denialReason === 'no_profile') {
      return 'Sua conta foi autenticada, mas o perfil ainda não foi provisionado.';
    }
    if (denialReason === 'inactive_profile') {
      return 'Seu perfil está inativo. Procure um administrador.';
    }
    if (denialReason) return AUTH_ACCESS_DENIED;
    return null;
  }, [denialReason]);

  const expiredFromQuery = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('expired') === '1';
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);
    setEmailError(null);
    setPasswordError(null);

    const trimmedEmail = email.trim();
    let hasError = false;

    if (!trimmedEmail) {
      setEmailError('Informe o e-mail.');
      hasError = true;
    } else if (!isValidEmail(trimmedEmail)) {
      setEmailError('Informe um e-mail válido.');
      hasError = true;
    }

    if (!password) {
      setPasswordError('Informe a senha.');
      hasError = true;
    }

    if (hasError) return;

    if (!isConfigured) {
      setErrorMsg('O sistema de autenticação não está configurado neste ambiente.');
      return;
    }

    try {
      setLoading(true);
      await signIn(trimmedEmail, password, remember);
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <div className="auth-card">
        <div className="auth-card-kicker">Acesso seguro</div>
        <h2>Bem-vindo de volta</h2>
        <p className="auth-lead">Entre com sua conta corporativa para acessar o CoreSys.</p>

        {(errorMsg || denialMessage) && (
          <div className="auth-alert error" role="alert">
            <AlertCircle size={16} />
            <span>{errorMsg || denialMessage}</span>
          </div>
        )}

        {!errorMsg && !denialMessage && expiredFromQuery && (
          <div className="auth-alert error" role="alert">
            <AlertCircle size={16} />
            <span>{AUTH_SESSION_EXPIRED}</span>
          </div>
        )}

        {!isConfigured && (
          <div className="auth-alert error" role="status">
            <AlertCircle size={16} />
            <span>O sistema de autenticação não está configurado neste ambiente.</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="auth-field">
            <label htmlFor="auth-email">E-mail</label>
            <input
              id="auth-email"
              name="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={loading}
              aria-invalid={Boolean(emailError)}
              aria-describedby={emailError ? 'auth-email-error' : undefined}
            />
            {emailError && (
              <span id="auth-email-error" className="auth-alert error" style={{ margin: 0, padding: '6px 10px' }}>
                {emailError}
              </span>
            )}
          </div>

          <div className="auth-field">
            <label htmlFor="auth-password">Senha</label>
            <div className="auth-password-wrap">
              <input
                id="auth-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={loading}
                aria-invalid={Boolean(passwordError)}
                aria-describedby={passwordError ? 'auth-password-error' : undefined}
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {passwordError && (
              <span id="auth-password-error" className="auth-alert error" style={{ margin: 0, padding: '6px 10px' }}>
                {passwordError}
              </span>
            )}
          </div>

          <div className="auth-row">
            <label>
              <input
                type="checkbox"
                checked={remember}
                onChange={e => setRemember(e.target.checked)}
                disabled={loading}
              />
              Lembrar acesso
            </label>
            <button type="button" className="auth-link" onClick={goToForgotPassword}>
              Esqueci minha senha
            </button>
          </div>

          <button type="submit" className="auth-submit" disabled={loading || !isConfigured}>
            {loading ? <span className="auth-spinner" aria-hidden="true" /> : null}
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <div className="auth-card-footer">
          <span>Ainda não possui uma conta?</span>
          <button type="button" className="auth-link" onClick={goToRegister}>
            Criar conta
          </button>
          <button type="button" className="auth-link" onClick={goToPrivacy}>
            Privacidade
          </button>
        </div>
      </div>
    </AuthShell>
  );
};

export const AuthBootScreen: React.FC<{ label?: string }> = ({ label = 'Inicializando sessão' }) => (
  <div className="auth-boot" data-theme="light">
    <span className="auth-spinner" aria-hidden="true" />
    {label}
  </div>
);

export const AuthSuccessNotice: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="auth-alert success" role="status">
    <CheckCircle2 size={16} />
    <span>{children}</span>
  </div>
);
