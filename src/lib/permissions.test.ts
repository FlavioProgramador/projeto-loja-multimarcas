import { canAccessModule, getRoleLabel } from './permissions';

describe('permissões por módulo e loja ativa', () => {
  it('preserva as regras de acesso dos módulos por papel', () => {
    expect(canAccessModule('ADMIN', 'automacoes')).toBe(true);
    expect(canAccessModule('MANAGER', 'automacoes')).toBe(false);
    expect(canAccessModule('MANAGER', 'trocas')).toBe(true);
    expect(canAccessModule('CASHIER', 'trocas')).toBe(false);
    expect(canAccessModule('EMPLOYEE', 'movimentacoes')).toBe(true);
    expect(canAccessModule('CASHIER', 'movimentacoes')).toBe(false);
  });

  it('mantém os módulos básicos disponíveis para todos os papéis válidos', () => {
    for (const role of ['ADMIN', 'MANAGER', 'CASHIER', 'EMPLOYEE'] as const) {
      expect(canAccessModule(role, 'dashboard')).toBe(true);
      expect(canAccessModule(role, 'pdv')).toBe(true);
      expect(canAccessModule(role, 'clientes')).toBe(true);
    }
  });

  it('resolve o rótulo do papel da loja ativa', () => {
    expect(getRoleLabel('ADMIN')).toBe('Administrador');
    expect(getRoleLabel('CASHIER')).toBe('Caixa');
    expect(getRoleLabel(null)).toBe('Usuário');
  });
});
