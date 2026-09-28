export type AuthScreen = 'login' | 'forgot-password' | 'reset-password' | 'app';

export function getAuthScreen(): AuthScreen {
  if (typeof window === 'undefined') return 'app';
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/login') return 'login';
  if (path === '/forgot-password') return 'forgot-password';
  if (path === '/reset-password') return 'reset-password';
  return 'app';
}

export function navigateTo(path: string, replace = false): void {
  if (typeof window === 'undefined') return;
  if (replace) {
    window.history.replaceState({}, '', path);
  } else {
    window.history.pushState({}, '', path);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function goToLogin(replace = true): void {
  navigateTo('/login', replace);
}

export function goToApp(replace = true): void {
  navigateTo('/#/dashboard', replace);
}

export function goToForgotPassword(): void {
  navigateTo('/forgot-password');
}

export function goToResetPassword(replace = true): void {
  navigateTo('/reset-password', replace);
}
