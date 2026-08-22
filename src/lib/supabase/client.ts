/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js';

// Chaves padrão do projeto Supabase VESTRA (fallback garantido)
const DEFAULT_SUPABASE_URL = 'https://ndrjynlbwrugakjqtzwy.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kcmp5bmxid3J1Z2FranF0end5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MDMzNTgsImV4cCI6MjEwMjk3OTM1OH0.gA7_tAGw2SVmzFoqwSzAO9zi0lNIPWEyokPVkunqh5c';

// Resolve Supabase URL e Anon Key compatível tanto com Vite (import.meta.env) quanto Next.js (process.env)
const getEnvVar = (viteKey: string, nextKey: string, fallback: string): string => {
  const metaEnv = (import.meta as any)?.env;
  if (metaEnv) {
    if (metaEnv[viteKey] && metaEnv[viteKey] !== 'https://your-project-id.supabase.co' && metaEnv[viteKey] !== 'your-anon-key-here') {
      return metaEnv[viteKey];
    }
    if (metaEnv[nextKey] && metaEnv[nextKey] !== 'https://your-project-id.supabase.co' && metaEnv[nextKey] !== 'your-anon-key-here') {
      return metaEnv[nextKey];
    }
  }
  if (typeof process !== 'undefined' && process.env) {
    if (process.env[nextKey] && process.env[nextKey] !== 'https://your-project-id.supabase.co') return process.env[nextKey];
    if (process.env[viteKey] && process.env[viteKey] !== 'your-anon-key-here') return process.env[viteKey];
  }
  return fallback;
};

const supabaseUrl = getEnvVar('VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', DEFAULT_SUPABASE_URL);
const supabaseAnonKey = getEnvVar('VITE_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', DEFAULT_SUPABASE_ANON_KEY);

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl !== 'https://your-project-id.supabase.co' &&
  supabaseAnonKey !== 'your-anon-key-here'
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
