/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js';
import { supabaseAuthStorage } from '../auth-storage';

// ⚠️ NUNCA coloque credenciais reais aqui.
// Configure as variáveis de ambiente no arquivo .env (veja env/.env.development.example).

const rawUrl = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_SUPABASE_URL : '';
const rawKey = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_SUPABASE_ANON_KEY : '';

const PLACEHOLDER_URL = 'https://placeholder.supabase.co';
const PLACEHOLDER_KEY = 'placeholder-key';

const supabaseUrl = rawUrl || PLACEHOLDER_URL;
const supabaseAnonKey = rawKey || PLACEHOLDER_KEY;

export const isSupabaseConfigured = Boolean(
  rawUrl &&
  rawKey &&
  rawUrl !== 'https://your-project-id.supabase.co' &&
  rawKey !== 'your-anon-key-here'
);

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: supabaseAuthStorage,
      flowType: 'pkce'
    }
  }
);
