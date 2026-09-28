import { AuthError, Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase/client';
import { AUTH_ACCESS_DENIED } from '../lib/auth-errors';
import { setRememberAccess } from '../lib/auth-storage';
import { ProfileRow, UserRole } from '../types/database';

export const VALID_ROLES: UserRole[] = ['ADMIN', 'MANAGER', 'CASHIER', 'EMPLOYEE'];

export type AuthDenialReason =
  | 'unauthenticated'
  | 'no_profile'
  | 'inactive_profile'
  | 'invalid_role'
  | 'no_store_access';

export interface StoreAccessSummary {
  store_id: string;
  role: UserRole;
  store_name: string;
}

export interface AuthAccessContext {
  user: User;
  profile: ProfileRow;
  role: UserRole;
  stores: StoreAccessSummary[];
}

function assertConfigured() {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase não está configurado. Por favor, adicione as chaves no arquivo .env.');
  }
}

function isValidRole(role: unknown): role is UserRole {
  return typeof role === 'string' && VALID_ROLES.includes(role as UserRole);
}

export const AuthService = {
  async getSession(): Promise<Session | null> {
    if (!isSupabaseConfigured) return null;
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    return session;
  },

  async getCurrentUser(): Promise<User | null> {
    if (!isSupabaseConfigured) return null;
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) return null;
    return user;
  },

  async getCurrentProfile(): Promise<ProfileRow | null> {
    if (!isSupabaseConfigured) return null;
    const user = await this.getCurrentUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, is_active, created_at, updated_at')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      console.error('Erro ao buscar perfil do usuário.');
      return null;
    }

    return data as ProfileRow | null;
  },

  async getActiveStoreAccess(userId: string): Promise<StoreAccessSummary[]> {
    if (!isSupabaseConfigured) return [];

    const { data, error } = await supabase
      .from('user_store_access')
      .select('store_id, role, is_active, stores ( id, name, is_active )')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (error) {
      console.error('Erro ao buscar vínculos de loja do usuário.');
      return [];
    }

    return (data || [])
      .map((row: any) => ({
        store_id: row.store_id as string,
        role: row.role as UserRole,
        store_name: row.stores?.name || 'Loja',
        store_active: row.stores?.is_active !== false
      }))
      .filter(row => row.store_active)
      .map(({ store_id, role, store_name }) => ({ store_id, role, store_name }));
  },

  evaluateAccess(profile: ProfileRow | null, stores: StoreAccessSummary[]): AuthDenialReason | null {
    if (!profile) return 'no_profile';
    if (profile.is_active === false) return 'inactive_profile';
    if (!isValidRole(profile.role)) return 'invalid_role';
    if (!stores.length) return 'no_store_access';
    return null;
  },

  async resolveAccessContext(): Promise<{ context: AuthAccessContext | null; reason: AuthDenialReason | null }> {
    if (!isSupabaseConfigured) {
      return { context: null, reason: 'unauthenticated' };
    }

    const user = await this.getCurrentUser();
    if (!user) {
      return { context: null, reason: 'unauthenticated' };
    }

    const profile = await this.getCurrentProfile();
    const stores = profile ? await this.getActiveStoreAccess(user.id) : [];
    const reason = this.evaluateAccess(profile, stores);

    if (reason || !profile || !isValidRole(profile.role)) {
      return { context: null, reason: reason ?? 'no_profile' };
    }

    return {
      context: {
        user,
        profile,
        role: profile.role,
        stores
      },
      reason: null
    };
  },

  async signIn(email: string, password: string, rememberAccess = true) {
    assertConfigured();
    setRememberAccess(rememberAccess);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password
    });
    if (error) throw error;

    const { context, reason } = await this.resolveAccessContext();
    if (!context) {
      await supabase.auth.signOut();
      const accessError = new Error(AUTH_ACCESS_DENIED) as Error & { denialReason?: AuthDenialReason };
      accessError.denialReason = reason ?? 'no_profile';
      throw accessError;
    }

    return data;
  },

  async signUp(email: string, password: string, fullName: string) {
    assertConfigured();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName
        }
      }
    });
    if (error) throw error;
    return data;
  },

  async signOut() {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  async requestPasswordReset(email: string) {
    assertConfigured();
    const redirectTo = `${window.location.origin}/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo
    });
    if (error) throw error;
  },

  async reauthenticate() {
    assertConfigured();
    const { error } = await supabase.auth.reauthenticate();
    if (error) throw error;
  },

  async updatePassword(newPassword: string, currentPassword?: string) {
    assertConfigured();

    const payload: { password: string; current_password?: string } = {
      password: newPassword
    };

    if (currentPassword) {
      payload.current_password = currentPassword;
    }

    const { error } = await supabase.auth.updateUser(payload);
    if (error) throw error;
  },

  isAuthError(error: unknown): error is AuthError {
    return Boolean(error && typeof error === 'object' && 'status' in error);
  }
};
