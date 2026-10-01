import {
  getAuthScreen,
  goToForgotPassword,
  goToLogin,
  goToPrivacy,
  goToRegister,
  goToResetPassword,
} from './auth-routing';

describe('roteamento de autenticação', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it.each([
    ['/login', 'login'],
    ['/register', 'register'],
    ['/forgot-password', 'forgot-password'],
    ['/reset-password', 'reset-password'],
    ['/privacidade', 'privacy'],
    ['/', 'app'],
  ] as const)('resolve %s como %s', (path, expected) => {
    window.history.replaceState({}, '', path);
    expect(getAuthScreen()).toBe(expected);
  });

  it('navega para as telas públicas e emite popstate', () => {
    const listener = vi.fn();
    window.addEventListener('popstate', listener);

    goToRegister();
    expect(window.location.pathname).toBe('/register');

    goToForgotPassword();
    expect(window.location.pathname).toBe('/forgot-password');

    goToPrivacy();
    expect(window.location.pathname).toBe('/privacidade');

    goToResetPassword();
    expect(window.location.pathname).toBe('/reset-password');

    goToLogin();
    expect(window.location.pathname).toBe('/login');
    expect(listener).toHaveBeenCalledTimes(5);

    window.removeEventListener('popstate', listener);
  });
});
