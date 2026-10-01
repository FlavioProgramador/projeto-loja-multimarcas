import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import { AuthService } from '../services/auth.service';

vi.mock('../lib/supabase/client', () => ({
  isSupabaseConfigured: false,
  supabase: { auth: {} },
}));

vi.mock('../services/auth.service', () => ({
  VALID_ROLES: ['ADMIN', 'MANAGER', 'CASHIER', 'EMPLOYEE'],
  AuthService: {
    signIn: vi.fn().mockResolvedValue(undefined),
    signUp: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    requestPasswordReset: vi.fn().mockResolvedValue(undefined),
    updatePassword: vi.fn().mockResolvedValue(undefined),
    reauthenticate: vi.fn().mockResolvedValue(undefined),
    resolveAccessContext: vi.fn(),
  },
}));

const wrapper: React.FC<React.PropsWithChildren> = ({ children }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe('AuthContext - login e logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
    localStorage.clear();
    sessionStorage.clear();
  });

  it('delega o login ao serviço de autenticação', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signIn('usuario@coresys.com', 'senha-segura', false);
    });

    expect(AuthService.signIn).toHaveBeenCalledWith(
      'usuario@coresys.com',
      'senha-segura',
      false,
    );
  });

  it('limpa caches sensíveis e volta ao login ao sair', async () => {
    localStorage.setItem('erp_customers', 'dados');
    sessionStorage.setItem('erp_products', 'dados');

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signOut();
    });

    expect(AuthService.signOut).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('erp_customers')).toBeNull();
    expect(sessionStorage.getItem('erp_products')).toBeNull();
    expect(window.location.pathname).toBe('/login');
  });
});
