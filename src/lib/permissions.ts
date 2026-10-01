/**
 * CoreSys ERP — Sistema centralizado de permissões (RBAC)
 *
 * Este arquivo controla somente a experiência da interface.
 * A segurança real continua no backend (RLS + RPCs SECURITY DEFINER).
 */

import type { ActiveModule } from '../types';
import type { UserRole } from '../types/database';

export type Permission =
  | 'sales.create'
  | 'sales.view'
  | 'sales.cancel'
  | 'sales.refund'
  | 'products.view'
  | 'products.create'
  | 'products.update'
  | 'products.delete'
  | 'inventory.view'
  | 'inventory.adjust'
  | 'inventory.entry'
  | 'finance.view'
  | 'finance.create'
  | 'finance.manage'
  | 'customers.view'
  | 'customers.create'
  | 'customers.update'
  | 'customers.delete'
  | 'suppliers.view'
  | 'suppliers.manage'
  | 'reports.view'
  | 'reports.export'
  | 'users.view'
  | 'users.manage'
  | 'users.promote'
  | 'audit.view'
  | 'automations.view'
  | 'automations.manage';

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  ADMIN: [
    'sales.create', 'sales.view', 'sales.cancel', 'sales.refund',
    'products.view', 'products.create', 'products.update', 'products.delete',
    'inventory.view', 'inventory.adjust', 'inventory.entry',
    'finance.view', 'finance.create', 'finance.manage',
    'customers.view', 'customers.create', 'customers.update', 'customers.delete',
    'suppliers.view', 'suppliers.manage',
    'reports.view', 'reports.export',
    'users.view', 'users.manage', 'users.promote',
    'audit.view',
    'automations.view', 'automations.manage',
  ],
  MANAGER: [
    'sales.create', 'sales.view', 'sales.cancel',
    'products.view', 'products.create', 'products.update',
    'inventory.view', 'inventory.adjust', 'inventory.entry',
    'finance.view', 'finance.create',
    'customers.view', 'customers.create', 'customers.update',
    'suppliers.view', 'suppliers.manage',
    'reports.view', 'reports.export',
    'users.view',
    'automations.view',
  ],
  CASHIER: [
    'sales.create', 'sales.view',
    'products.view',
    'inventory.view',
    'finance.view',
    'customers.view', 'customers.create',
    'suppliers.view',
    'reports.view',
  ],
  EMPLOYEE: [
    'sales.view',
    'products.view',
    'inventory.view',
    'customers.view',
  ],
};

const MODULE_ROLE_ACCESS: Record<ActiveModule, readonly UserRole[]> = {
  dashboard: ['ADMIN', 'MANAGER', 'CASHIER', 'EMPLOYEE'],
  pdv: ['ADMIN', 'MANAGER', 'CASHIER', 'EMPLOYEE'],
  estoque: ['ADMIN', 'MANAGER'],
  trocas: ['ADMIN', 'MANAGER'],
  financeiro: ['ADMIN', 'MANAGER'],
  movimentacoes: ['ADMIN', 'MANAGER', 'EMPLOYEE'],
  clientes: ['ADMIN', 'MANAGER', 'CASHIER', 'EMPLOYEE'],
  fornecedores: ['ADMIN', 'MANAGER'],
  relatorios: ['ADMIN', 'MANAGER'],
  automacoes: ['ADMIN'],
};

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Administrador',
  MANAGER: 'Gerente',
  CASHIER: 'Caixa',
  EMPLOYEE: 'Colaborador',
};

export function can(role: UserRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function getPermissions(role: UserRole | null | undefined): Permission[] {
  if (!role) return [];
  return ROLE_PERMISSIONS[role] ?? [];
}

export function createPermissionChecker(role: UserRole | null | undefined) {
  return (permission: Permission) => can(role, permission);
}

export function canAccessModule(role: UserRole | null | undefined, module: ActiveModule): boolean {
  if (!role) return false;
  return MODULE_ROLE_ACCESS[module].includes(role);
}

export function getRoleLabel(role: UserRole | null | undefined): string {
  return role ? ROLE_LABELS[role] : 'Usuário';
}
