import { describe, expect, it } from 'vitest';
import { can, getPermissions, createPermissionChecker } from './permissions';

describe('permissions (RBAC)', () => {
  describe('can', () => {
    it('nega tudo para papel nulo/indefinido', () => {
      expect(can(null, 'sales.create')).toBe(false);
      expect(can(undefined, 'finance.view')).toBe(false);
    });

    it('ADMIN tem acesso total', () => {
      expect(can('ADMIN', 'users.promote')).toBe(true);
      expect(can('ADMIN', 'audit.view')).toBe(true);
      expect(can('ADMIN', 'automations.manage')).toBe(true);
      expect(can('ADMIN', 'finance.manage')).toBe(true);
    });

    it('MANAGER não pode promover usuários nem gerenciar finanças', () => {
      expect(can('MANAGER', 'sales.cancel')).toBe(true);
      expect(can('MANAGER', 'users.promote')).toBe(false);
      expect(can('MANAGER', 'finance.manage')).toBe(false);
      expect(can('MANAGER', 'audit.view')).toBe(false);
    });

    it('CASHIER não pode cancelar venda, excluir produto ou ver usuários', () => {
      expect(can('CASHIER', 'sales.create')).toBe(true);
      expect(can('CASHIER', 'sales.cancel')).toBe(false);
      expect(can('CASHIER', 'products.delete')).toBe(false);
      expect(can('CASHIER', 'users.view')).toBe(false);
    });

    it('EMPLOYEE é somente leitura', () => {
      expect(can('EMPLOYEE', 'sales.view')).toBe(true);
      expect(can('EMPLOYEE', 'sales.create')).toBe(false);
      expect(can('EMPLOYEE', 'customers.create')).toBe(false);
      expect(can('EMPLOYEE', 'reports.view')).toBe(false);
    });
  });

  describe('getPermissions', () => {
    it('retorna lista vazia para papel nulo', () => {
      expect(getPermissions(null)).toEqual([]);
    });

    it('ADMIN tem mais permissões que MANAGER, que tem mais que EMPLOYEE', () => {
      expect(getPermissions('ADMIN').length).toBeGreaterThan(getPermissions('MANAGER').length);
      expect(getPermissions('MANAGER').length).toBeGreaterThan(getPermissions('EMPLOYEE').length);
    });

    it('não há permissões duplicadas em nenhum papel', () => {
      for (const role of ['ADMIN', 'MANAGER', 'CASHIER', 'EMPLOYEE'] as const) {
        const perms = getPermissions(role);
        expect(new Set(perms).size).toBe(perms.length);
      }
    });
  });

  describe('createPermissionChecker', () => {
    it('cria verificador vinculado ao papel', () => {
      const checker = createPermissionChecker('CASHIER');
      expect(checker('sales.create')).toBe(true);
      expect(checker('finance.manage')).toBe(false);
    });
  });
});
