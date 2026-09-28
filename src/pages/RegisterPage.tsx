import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { AuthShell } from '../components/auth/AuthShell';
import { AuthSuccessNotice } from './LoginPage';
import { useAuth } from '../contexts/AuthContext';
import { mapAuthError } from '../lib/auth-errors';
import { goToLogin } from '../lib/auth-routing';

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export const RegisterPage: React.FC = () => {
  const { signUp, isConfigured } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);

    if (!fullName.trim()) {
      setErrorMsg('Informe seu nome completo.');
      return;
    }
    if (!isValidEmail(email)) {
      setErrorMsg('Informe um e-mail válido.');
      return;
    }
    if (password.length < 6) {
      setErrorMsg('A senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (password !== passwordConfirmation) {
      setErrorMsg('As senhas não coincidem.');
      return;
    }
    if (!isConfigured) {
      setErrorMsg('O sistema de autenticação não está configurado neste ambiente.');
      return;
    }

    try {
      setLoading(true);
      await signUp(email.trim(), password, fullName.trim());
      setCreated(true);
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <div className="auth-card auth-card-register">
        <div className="auth-card-kicker">Novo acesso</div>
        <h2>Crie sua conta</h2>
        <p className="auth-lead">Cadastre seus dados para começar a usar o CoreSys.</p>

        {created ? (
          <>
            <AuthSuccessNotice>Cadastro realizado. Verifique seu e-mail, se necessário, e entre no sistema.</AuthSuccessNotice>
            <button type="button" className="auth-submit" onClick={() => goToLogin()}>
              Voltar ao login
            </button>
          </>
        ) : (
          <>
            {errorMsg && (
              <div className="auth-alert error" role="alert">
                <AlertCircle size={16} />
                <span>{errorMsg}</span>
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
                <label htmlFor="register-name">Nome completo</label>
                <input id="register-name" name="name" type="text" autoComplete="name" value={fullName} onChange={e => setFullName(e.target.value)} disabled={loading} />
              </div>

              <div className="auth-field">
                <label htmlFor="register-email">E-mail</label>
                <input id="register-email" name="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} disabled={loading} />
              </div>

              <div className="auth-field">
                <label htmlFor="register-password">Senha</label>
                <input id="register-password" name="password" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} disabled={loading} />
              </div>

              <div className="auth-field">
                <label htmlFor="register-password-confirmation">Confirme sua senha</label>
                <input id="register-password-confirmation" name="passwordConfirmation" type="password" autoComplete="new-password" value={passwordConfirmation} onChange={e => setPasswordConfirmation(e.target.value)} disabled={loading} />
              </div>

              <button type="submit" className="auth-submit" disabled={loading || !isConfigured}>
                {loading ? <span className="auth-spinner" aria-hidden="true" /> : null}
                {loading ? 'Criando conta...' : 'Criar conta'}
              </button>
            </form>
          </>
        )}

        {!created && (
          <div className="auth-card-footer">
            <span>Já possui uma conta?</span>
            <button type="button" className="auth-link" onClick={() => goToLogin()}>
              Voltar ao login
            </button>
          </div>
        )}
      </div>
    </AuthShell>
  );
};
