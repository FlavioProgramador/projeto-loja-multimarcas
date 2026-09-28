const REMEMBER_FLAG = 'coresys_remember_access';

export function setRememberAccess(remember: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(REMEMBER_FLAG, remember ? '1' : '0');
}

export function getRememberAccess(): boolean {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(REMEMBER_FLAG) !== '0';
}

function preferredStorage(): Storage {
  return getRememberAccess() ? localStorage : sessionStorage;
}

/**
 * Storage do Supabase Auth.
 * "Lembrar acesso" persiste em localStorage; caso contrário, sessionStorage.
 * A leitura consulta os dois para recuperar a sessão já existente.
 */
export const supabaseAuthStorage = {
  getItem: (key: string): string | null => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(key) ?? sessionStorage.getItem(key);
  },
  setItem: (key: string, value: string): void => {
    if (typeof window === 'undefined') return;
    const storage = preferredStorage();
    const other = storage === localStorage ? sessionStorage : localStorage;
    other.removeItem(key);
    storage.setItem(key, value);
  },
  removeItem: (key: string): void => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  }
};
