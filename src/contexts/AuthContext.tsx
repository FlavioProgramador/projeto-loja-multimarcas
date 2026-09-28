import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase/client';
import { AuthService, AuthDenialReason, StoreAccessSummary, VALID_ROLES } from '../services/auth.service';
import { ProfileRow, UserRole } from '../types/database';
import { goToLogin } from '../lib/auth-routing';

interface AuthContextType {
  user: User | null;
  profile: ProfileRow | null;
  role: UserRole | null;
  stores: StoreAccessSummary[];
  loading: boolean;
  isConfigured: boolean;
  isAuthorized: boolean;
  isPasswordRecovery: boolean;
  denialReason: AuthDenialReason | null;
  signIn: (email: string, password: string, rememberAccess?: boolean) => Promise<void>;
  signUp: (email: string, password: string, fullName: string) => Promise<void>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SENSITIVE_KEYS = [
  'erp_customers',
  'erp_transactions',
  'erp_movements',
  'erp_suppliers',
  'erp_fixed_expenses',
  'erp_notifications'
];

function clearLocalCaches() {
  SENSITIVE_KEYS.forEach(key => localStorage.removeItem(key));
}

function isAppPath() {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  return path !== '/login' && path !== '/register' && path !== '/forgot-password' && path !== '/reset-password';
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [stores, setStores] = useState<StoreAccessSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [denialReason, setDenialReason] = useState<AuthDenialReason | null>(null);
  const initializingRef = useRef(true);

  const resetState = useCallback(() => {
    setUser(null);
    setProfile(null);
    setStores([]);
    setDenialReason(null);
  }, []);

  const applyAuthorizedSession = useCallback(async (session: Session | null, event?: string) => {
    if (event === 'PASSWORD_RECOVERY') {
      setIsPasswordRecovery(true);
    }

    if (!session?.user) {
      resetState();
      return;
    }

    const { context, reason } = await AuthService.resolveAccessContext();

    if (event === 'PASSWORD_RECOVERY') {
      setUser(session.user);
      setProfile(context?.profile ?? null);
      setStores(context?.stores ?? []);
      setDenialReason(null);
      return;
    }

    if (!context) {
      await AuthService.signOut().catch(() => undefined);
      resetState();
      setDenialReason(reason ?? 'no_profile');
      clearLocalCaches();
      return;
    }

    setUser(context.user);
    setProfile(context.profile);
    setStores(context.stores);
    setDenialReason(null);
  }, [resetState]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const init = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (cancelled) return;
        await applyAuthorizedSession(session);
      } catch {
        console.error('Erro ao recuperar sessão.');
        if (!cancelled) resetState();
      } finally {
        if (!cancelled) {
          initializingRef.current = false;
          setLoading(false);
        }
      }
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'INITIAL_SESSION') return;

      if (event === 'TOKEN_REFRESHED' && !session) {
        resetState();
        setDenialReason('unauthenticated');
        clearLocalCaches();
        if (isAppPath()) goToLogin(true);
        setLoading(false);
        return;
      }

      if (event === 'SIGNED_OUT') {
        resetState();
        setIsPasswordRecovery(false);
        clearLocalCaches();
        setLoading(false);
        return;
      }

      try {
        await applyAuthorizedSession(session, event);
      } finally {
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [applyAuthorizedSession, resetState]);

  const signIn = async (email: string, password: string, rememberAccess = true) => {
    await AuthService.signIn(email, password, rememberAccess);
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    await AuthService.signUp(email, password, fullName);
  };

  const signOut = async () => {
    setIsPasswordRecovery(false);
    await AuthService.signOut();
    resetState();
    clearLocalCaches();
    goToLogin(true);
  };

  const requestPasswordReset = async (email: string) => {
    await AuthService.requestPasswordReset(email);
  };

  const updatePassword = async (password: string) => {
    await AuthService.updatePassword(password);
    setIsPasswordRecovery(false);
  };

  const role: UserRole | null =
    profile && VALID_ROLES.includes(profile.role) ? profile.role : null;

  const isAuthorized = Boolean(
    user &&
    profile &&
    role &&
    profile.is_active !== false &&
    stores.length > 0 &&
    !denialReason
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        role,
        stores,
        loading,
        isConfigured: isSupabaseConfigured,
        isAuthorized,
        isPasswordRecovery,
        denialReason,
        signIn,
        signUp,
        signOut,
        requestPasswordReset,
        updatePassword
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
