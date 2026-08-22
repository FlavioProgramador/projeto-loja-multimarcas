import { supabase, isSupabaseConfigured } from '../lib/supabase/client';
import { ProfileRow, UserRole } from '../types/database';

export const AuthService = {
  async getSession() {
    if (!isSupabaseConfigured) return null;
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    return session;
  },

  async getCurrentUser() {
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
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      console.error('Erro ao buscar perfil do usuário:', error);
      return null;
    }

    return data as ProfileRow;
  },

  async signIn(email: string, password: string) {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase não está configurado. Por favor, adicione as chaves no arquivo .env.');
    }
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    if (error) throw error;
    return data;
  },

  async signUp(email: string, password: string, fullName: string, role: UserRole = 'EMPLOYEE') {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase não está configurado. Por favor, adicione as chaves no arquivo .env.');
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          role: role
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
  }
};
