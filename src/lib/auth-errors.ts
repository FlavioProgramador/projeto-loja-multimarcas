export const AUTH_ACCESS_DENIED = 'Você não possui acesso ao sistema.';
export const AUTH_SESSION_EXPIRED = 'Sua sessão expirou. Faça login novamente.';
export const AUTH_RESET_GENERIC =
  'Se o e-mail estiver cadastrado, você receberá instruções para redefinir a senha.';

export function mapAuthError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const lower = raw.toLowerCase();

  if (!raw.trim()) {
    return 'Não foi possível autenticar. Tente novamente.';
  }

  if (
    lower.includes('invalid login') ||
    lower.includes('invalid credentials') ||
    lower.includes('invalid_grant') ||
    lower.includes('user not found') ||
    lower.includes('invalid email or password')
  ) {
    return 'E-mail ou senha incorretos.';
  }

  if (lower.includes('email not confirmed')) {
    return 'Confirme seu e-mail antes de entrar.';
  }

  if (lower.includes('too many requests') || lower.includes('rate limit')) {
    return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  }

  if (
    lower.includes('failed to fetch') ||
    lower.includes('network') ||
    lower.includes('fetch') ||
    lower.includes('timeout')
  ) {
    return 'Não foi possível conectar ao servidor. Tente novamente.';
  }

  if (lower.includes('session') && (lower.includes('expired') || lower.includes('not found'))) {
    return AUTH_SESSION_EXPIRED;
  }

  if (
    lower.includes('não possui acesso') ||
    lower.includes('perfil inativo') ||
    lower.includes('papel inválido') ||
    lower.includes('sem vínculo')
  ) {
    return AUTH_ACCESS_DENIED;
  }

  if (lower.includes('supabase não está configurado')) {
    return 'O sistema de autenticação não está configurado neste ambiente.';
  }

  return 'Não foi possível autenticar. Tente novamente.';
}
