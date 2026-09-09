import React, { createContext, useContext, useState, useEffect } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase/client';
import { AuthService } from '../services/auth.service';
import { ProfileRow, UserRole } from '../types/database';

interface AuthContextType {
  user: User | null;
  profile: ProfileRow | null;
  role: UserRole;
  loading: boolean;
  isConfigured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (currentUser: User | null) => {
    if (!currentUser || !isSupabaseConfigured) {
      setProfile(null);
      return;
    }
    try {
      const prof = await AuthService.getCurrentProfile();
      setProfile(prof);
    } catch (err) {
      console.error('Erro ao obter perfil no AuthProvider:', err);
    }
  };

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    // Obter sessão inicial
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user);
      }
      setLoading(false);
    });

    // Escutar mudanças de autenticação
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        await fetchProfile(session.user);
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    await AuthService.signIn(email, password);
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    await AuthService.signUp(email, password, fullName);
  };

  const signOut = async () => {
    await AuthService.signOut();
    setUser(null);
    setProfile(null);
    // V-07: Limpar dados sensíveis do cache local no logout
    // Clientes, transações, movimentações e fornecedores não devem persistir entre sessões
    const SENSITIVE_KEYS = [
      'erp_customers',
      'erp_transactions',
      'erp_movements',
      'erp_suppliers',
      'erp_fixed_expenses',
      'erp_notifications',
    ];
    SENSITIVE_KEYS.forEach(key => localStorage.removeItem(key));
  };

  // SEGURANÇA: fallback deve ser null, nunca ADMIN.
  // Se o perfil falhar ao carregar, o usuário fica sem permissão — não ganha acesso.
  const role: UserRole = (profile?.role as UserRole) ?? 'EMPLOYEE';

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        role,
        loading,
        isConfigured: isSupabaseConfigured,
        signIn,
        signUp,
        signOut
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser utilizado dentro de AuthProvider');
  return context;
};
