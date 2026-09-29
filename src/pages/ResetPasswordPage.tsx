import React, { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { AuthShell } from '../components/auth/AuthShell';
import { useAuth } from '../contexts/AuthContext';
import { mapAuthError } from '../lib/auth-errors';
import { goToLogin } from '../lib/auth-routing';

const hasLowercase = (value: string) => /[a-z]/.test(value);
const hasUppercase = (value: string) => /[A-Z]/.test(value);
const hasDigit = (value: string) => /d/.test(value);
const hasSymbol = (value: string) => /[!@#$%^&*()_+\-=[\]{};':"\\|<>?,./`~]/.test(value);

function getPasswordStrength(value: string) {
  let score = 0;
  if (value.length >= 10) score++;
  if (hasLowercase(value)) score++;
  if (hasUppercase(value)) score++;
  if (hasDigit(value)) score++;
  if (hasSymbol(value)) score++;
  return score <= 1 ? 'Muito fraca' : score === 2 ? 'Fraca' : score === 3 ? 'Média' : 'Forte';
}

export const ResetPasswordPage: React.FC = () => {
  const { updatePassword, isPasswordRecovery, user, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const strength = useMemo(() => getPasswordStrength(password), [password]);
  const canReset = Boolean(user && isPasswordRecovery);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);

    if (!canReset) {
      setErrorMsg('Esta sessão de recuperação é inválida ou expirou. Solicite um novo link.');
      return;
    }

    if (password.length < 10) {
      setErrorMsg('A nova senha deve ter pelo menos 10 caracteres.');
      return;
    }

    if (!hasLowercase(password) || !hasUppercase(password) || !hasDigit(password) || !hasSymbol(password)) {
      setErrorMsg('A senha deve conter letras minúsculas, maiúsculas, números e símbolos.');
      return;
    }

    if (password !== confirm) {
      setErrorMsg('As senhas não coincidem.');
      return;
    }

    try {
      setLoading(true);
      await updatePassword({ newPassword: password });
      setDone(true);
      await signOut();
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

        {done && (
          <div className="auth-alert success" role="status">
            <CheckCircle2 size={16} />
            <span>Senha atualizada com sucesso. Redirecionando para o login...</span>
          </div>
        )}

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
          <form onSubmit={handleSubmit} noValidate>
            <div className="auth-field">
              <label htmlFor="new-password">Nova senha</label>
              <div className="auth-password-wrap">
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
                <button
                  type="button"
                  className="auth-password-toggle"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <div id="reset-password-help" className="auth-password-help">
                <span>10+ caracteres, com maiúscula, minúscula, número e símbolo.</span>
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
            disabled={loading}
            onClick={() => {
              if (user) {
                void signOut();
              } else {
                goToLogin(true);
              }
            }}
          >
            Voltar ao login
          </button>
        </div>
      </div>
    </AuthShell>
  );
};
