import { supabase, isSupabaseConfigured } from '../lib/supabase/client';
import { ProfileRow } from '../types/database';

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

  async signUp(email: string, password: string, fullName: string) {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase não está configurado. Por favor, adicione as chaves no arquivo .env.');
    }
    // SEGURANÇA: nunca enviar role via metadata.
    // O trigger handle_new_user no banco sempre cria com EMPLOYEE, ignorando qualquer role enviada.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName
          // 'role' removido intencionalmente: o banco define sempre EMPLOYEE
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
