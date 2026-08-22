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

const PLACEHOLDER_URL = 'https://placeholder.supabase.co';
const PLACEHOLDER_KEY = 'placeholder-key';

const rawUrl = getEnvVar('VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
const rawKey = getEnvVar('VITE_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');

// Usar placeholder para evitar crash no createClient quando as vars não estão definidas.
// isSupabaseConfigured=false bloqueia todas as chamadas ao banco.
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
      detectSessionInUrl: true
    }
  }
);
