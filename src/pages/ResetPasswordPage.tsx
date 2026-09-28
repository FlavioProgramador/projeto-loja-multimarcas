import React, { useMemo, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { AuthShell } from '../components/auth/AuthShell';
import { AuthSuccessNotice } from './LoginPage';
import { useAuth } from '../contexts/AuthContext';
import { mapAuthError } from '../lib/auth-errors';
import { goToApp, goToLogin } from '../lib/auth-routing';

export const ResetPasswordPage: React.FC = () => {
  const { updatePassword, isPasswordRecovery, user, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const strength = useMemo(() => {
    let score = 0;
    if (password.length >= 10) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[!@#$%^&*()_+\-=[\]{};':"\\|<>?,./`~]/.test(password)) score++;
    return score <= 1 ? 'Muito fraca' : score === 2 ? 'Fraca' : score === 3 ? 'Média' : 'Forte';
  }, [password]);

  const isAuthenticatedPasswordChange = Boolean(user && !isPasswordRecovery);
  const canReset = Boolean(user && (isPasswordRecovery || isAuthenticatedPasswordChange));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);

    if (password.length < 10) {
      setErrorMsg('A nova senha deve ter pelo menos 10 caracteres.');
      return;
    }
    if (password !== confirm) {
      setErrorMsg('As senhas não coincidem.');
      return;
    }

    try {
      setLoading(true);
      await updatePassword(password);
      setDone(true);
      window.setTimeout(() => goToApp(true), 800);
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <div className="auth-card">
        <h2>Nova senha</h2>
        <p className="auth-lead">Defina uma nova senha para a sua conta.</p>

        {done && <AuthSuccessNotice>Senha atualizada. Redirecionando...</AuthSuccessNotice>}

        {!canReset && !done && (
          <div className="auth-alert error" role="alert">
            <AlertCircle size={16} />
            <span>Este link de recuperação é inválido ou expirou. Solicite um novo.</span>
          </div>
        )}

        {errorMsg && (
          <div className="auth-alert error" role="alert">
            <AlertCircle size={16} />
            <span>{errorMsg}</span>
          </div>
        )}

        {canReset && !done && (
          <form onSubmit={handleSubmit}>
            <div className="auth-field">
              <label htmlFor="new-password">Nova senha</label>
              <input
                id="new-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={loading}
                aria-describedby="reset-password-help"
              />
              <div id="reset-password-help" className="auth-password-help">
                <span>Mínimo de 10 caracteres.</span>
                {password && <strong>{strength}</strong>}
              </div>
            </div>
            <div className="auth-field">
              <label htmlFor="confirm-password">Confirmar senha</label>
              <input
                id="confirm-password"
                name="confirm-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="auth-row">
              <label>
                <input
                  type="checkbox"
                  checked={showPassword}
                  onChange={e => setShowPassword(e.target.checked)}
                />
                Mostrar senha
              </label>
            </div>
            <button type="submit" className="auth-submit" disabled={loading}>
              {loading ? <span className="auth-spinner" aria-hidden="true" /> : null}
              {loading ? 'Salvando...' : 'Salvar senha'}
            </button>
          </form>
        )}

        <div className="auth-row" style={{ marginTop: 18, justifyContent: 'flex-start' }}>
          <button
            type="button"
            className="auth-link"
            onClick={() => {
              if (user) signOut();
              else goToLogin(true);
            }}
          >
            Voltar ao login
          </button>
        </div>
      </div>
    </AuthShell>
  );
};
