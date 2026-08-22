/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js';

// ⚠️  NUNCA coloque credenciais reais aqui.
// Configure as variáveis de ambiente no arquivo .env (veja .env.example).
const getEnvVar = (viteKey: string, nextKey: string): string => {
  const metaEnv = (import.meta as any)?.env;
  if (metaEnv) {
    if (metaEnv[viteKey]) return metaEnv[viteKey];
    if (metaEnv[nextKey]) return metaEnv[nextKey];
  }
  if (typeof process !== 'undefined' && process.env) {
    if (process.env[nextKey]) return process.env[nextKey]!;
    if (process.env[viteKey]) return process.env[viteKey]!;
  }
  return '';
};

const supabaseUrl = getEnvVar('VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
const supabaseAnonKey = getEnvVar('VITE_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');

const PLACEHOLDER_URL = 'https://your-project-id.supabase.co';
const PLACEHOLDER_KEY = 'your-anon-key-here';

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl !== PLACEHOLDER_URL &&
  supabaseAnonKey !== PLACEHOLDER_KEY
);

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);
