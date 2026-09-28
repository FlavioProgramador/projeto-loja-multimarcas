/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js';
import { supabaseAuthStorage } from '../auth-storage';

const readEnv = (name: keyof ImportMetaEnv): string => {
  if (typeof import.meta === 'undefined' || !import.meta.env) return '';
  return String(import.meta.env[name] ?? '').trim();
};

const rawUrl = readEnv('VITE_SUPABASE_URL');
const rawKey = readEnv('VITE_SUPABASE_ANON_KEY');

const PLACEHOLDER_URL = 'https://your-project-id.supabase.co';
const PLACEHOLDER_KEY = 'your-anon-key-here';

function isValidSupabaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.endsWith('.supabase.co');
  } catch {
    return false;
  }
}

export const isSupabaseConfigured =
  isValidSupabaseUrl(rawUrl) &&
  rawUrl !== PLACEHOLDER_URL &&
  Boolean(rawKey) &&
  rawKey !== PLACEHOLDER_KEY;

const supabaseUrl = isSupabaseConfigured ? rawUrl : 'https://placeholder.supabase.co';
const supabaseAnonKey = isSupabaseConfigured ? rawKey : 'placeholder-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: supabaseAuthStorage,
    flowType: 'pkce'
  }
});
