import React, { useState } from 'react';
import { LogIn, UserPlus, AlertCircle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useAuth } from '../../contexts/AuthContext';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const { signIn, signUp, isConfigured } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!email.trim() || !password.trim()) {
      setErrorMsg('Por favor, informe e-mail e senha.');
      return;
    }

    if (isSignUp && !fullName.trim()) {
      setErrorMsg('Por favor, informe seu nome completo.');
      return;
    }

    try {
      setLoading(true);
      if (isSignUp) {
        await signUp(email, password, fullName, 'ADMIN');
        setSuccessMsg('Cadastro realizado com sucesso! Você já pode entrar.');
        setIsSignUp(false);
      } else {
        await signIn(email, password);
        onClose();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao autenticar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {isSignUp ? (
            <UserPlus size={18} style={{ color: 'var(--primary)' }} />
          ) : (
            <LogIn size={18} style={{ color: 'var(--primary)' }} />
          )}
          <span>{isSignUp ? 'Criar Conta no VESTRA' : 'Acessar VESTRA ERP'}</span>
        </div>
      }
      maxWidth="440px"
    >
      {!isConfigured && (
        <div
          style={{
            background: 'var(--bg-surface-subtle)',
            border: '1px solid var(--border-color)',
            padding: '10px 14px',
            borderRadius: 'var(--radius-md)',
            marginBottom: '14px',
            fontSize: '12px',
            color: 'var(--text-secondary)'
          }}
        >
          💡 <strong>Nota:</strong> As chaves do Supabase podem ser adicionadas no arquivo <code>.env.local</code>. O sistema roda com sincronização ao vivo ou fallback seguro.
        </div>
      )}

      {errorMsg && (
        <div
          style={{
            background: 'var(--badge-red-bg)',
            border: '1px solid var(--badge-red)',
            color: 'var(--badge-red)',
            padding: '10px 14px',
            borderRadius: 'var(--radius-md)',
            marginBottom: '14px',
            fontSize: '12.5px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <AlertCircle size={15} /> {errorMsg}
        </div>
      )}

      {successMsg && (
        <div
          style={{
            background: 'var(--badge-green-bg)',
            border: '1px solid var(--badge-green)',
            color: 'var(--badge-green)',
            padding: '10px 14px',
            borderRadius: 'var(--radius-md)',
            marginBottom: '14px',
            fontSize: '12.5px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <CheckCircle2 size={15} /> {successMsg}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {isSignUp && (
          <div className="form-group">
            <label>Nome Completo</label>
            <input
              type="text"
              placeholder="Ex: Carlos Eduardo"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              required
            />
          </div>
        )}

        <div className="form-group">
          <label>E-mail</label>
          <input
            type="email"
            placeholder="admin@vestra.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label>Senha</label>
          <input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
        </div>

        <div style={{ display: 'flex', gap: '8px', marginTop: '18px' }}>
          <button type="submit" className="btn" disabled={loading} style={{ flex: 1 }}>
            {loading ? 'Processando...' : isSignUp ? 'Cadastrar' : 'Entrar'}
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              setIsSignUp(prev => !prev);
              setErrorMsg(null);
              setSuccessMsg(null);
            }}
          >
            {isSignUp ? 'Já tenho conta' : 'Criar conta'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
