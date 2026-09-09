/**
 * VESTRA ERP — Sistema Centralizado de Permissões (RBAC)
 *
 * IMPORTANTE: Este arquivo define permissões de UI (ocultar/desabilitar elementos).
 * A segurança real está no backend (RLS + RPCs SECURITY DEFINER).
 * Nunca confie apenas neste arquivo para proteger dados.
 */

import { UserRole } from '../types/database';

// Todas as ações possíveis no sistema
export type Permission =
  // Vendas
  | 'sales.create'
  | 'sales.view'
  | 'sales.cancel'
  | 'sales.refund'
  // Estoque
  | 'products.view'
  | 'products.create'
  | 'products.update'
  | 'products.delete'
  | 'inventory.view'
  | 'inventory.adjust'
  | 'inventory.entry'
  // Financeiro
  | 'finance.view'
  | 'finance.create'
  | 'finance.manage'
  // Clientes
  | 'customers.view'
  | 'customers.create'
  | 'customers.update'
  | 'customers.delete'
  // Fornecedores
  | 'suppliers.view'
  | 'suppliers.manage'
  // Relatórios
  | 'reports.view'
  | 'reports.export'
  // Usuários e Admin
  | 'users.view'
  | 'users.manage'
  | 'users.promote'
  // Auditoria
  | 'audit.view'
  // Automações
  | 'automations.view'
  | 'automations.manage';

// Mapa de permissões por papel
const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  ADMIN: [
    // Acesso total
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

/**
 * Verifica se um papel tem permissão para uma ação.
 * Uso: can(role, 'sales.create')
 */
export function can(role: UserRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/**
 * Retorna todas as permissões de um papel.
 */
export function getPermissions(role: UserRole | null | undefined): Permission[] {
  if (!role) return [];
  return ROLE_PERMISSIONS[role] ?? [];
}

/**
 * Hook helper — usa junto com useAuth().
 * Exemplo: const { can } = usePermissions(); can('finance.view')
 */
export function createPermissionChecker(role: UserRole | null | undefined) {
  return (permission: Permission) => can(role, permission);
}
