export type AutomationCategory =
  | 'ESTOQUE'
  | 'VENDAS'
  | 'FINANCEIRO'
  | 'CLIENTES'
  | 'PRODUTOS'
  | 'SISTEMA'
  | 'RELATORIOS';

export type AutomationTrigger =
  | 'LOW_STOCK'
  | 'OUT_OF_STOCK'
  | 'EXPENSE_DUE'
  | 'EXPENSE_OVERDUE'
  | 'SALE_COMPLETED'
  | 'SALE_CANCELLED'
  | 'RETURN_COMPLETED'
  | 'CUSTOMER_INACTIVE'
  | 'PRODUCT_INACTIVE'
  | 'REPORT_DAILY'
  | 'REPORT_WEEKLY'
  | 'REPORT_MONTHLY';

export type AutomationStatus = 'ACTIVE' | 'PAUSED';
export type AutomationRunStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';

export interface AutomationCondition {
  field: string;
  operator: 'EQ' | 'NEQ' | 'GT' | 'GTE' | 'LT' | 'LTE' | 'DAYS_GTE';
  value: string | number | boolean | null;
}

export type AutomationActionType =
  | 'CREATE_ALERT'
  | 'CREATE_NOTIFICATION'
  | 'GENERATE_REPORT'
  | 'REQUEST_INTERVENTION'
  | 'AUDIT';

export interface AutomationAction {
  type: AutomationActionType;
  config?: Record<string, unknown>;
}

export interface AutomationRule {
  id: string;
  store_id: string;
  name: string;
  description: string;
  category: AutomationCategory;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  status: AutomationStatus;
  priority: number;
  cooldown_minutes: number;
  schedule: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  next_run_at: string | null;
  execution_count: number;
  failure_count: number;
}

export interface AutomationEvent {
  id: string;
  store_id: string;
  event_type: string;
  reference_id: string | null;
  idempotency_key: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface AutomationRun {
  id: string;
  automation_id: string;
  store_id: string;
  event_type: AutomationTrigger;
  event_id: string | null;
  reference_id: string | null;
  status: AutomationRunStatus;
  result: Record<string, unknown> | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
}

export const AUTOMATION_PRESETS: Array<{
  name: string;
  description: string;
  category: AutomationCategory;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  cooldown_minutes: number;
}> = [
  {
    name: 'Alerta de estoque baixo',
    description: 'Gera um alerta quando a quantidade de um SKU atinge o estoque mínimo.',
    category: 'ESTOQUE',
    trigger: 'LOW_STOCK',
    conditions: [{ field: 'quantity', operator: 'LTE', value: 'minimum_stock' }],
    actions: [{ type: 'CREATE_ALERT' }, { type: 'CREATE_NOTIFICATION' }],
    cooldown_minutes: 1440,
  },
  {
    name: 'Produto esgotado',
    description: 'Sinaliza produtos sem saldo disponível para reposição.',
    category: 'ESTOQUE',
    trigger: 'OUT_OF_STOCK',
    conditions: [{ field: 'quantity', operator: 'EQ', value: 0 }],
    actions: [{ type: 'CREATE_ALERT' }, { type: 'REQUEST_INTERVENTION' }],
    cooldown_minutes: 1440,
  },
  {
    name: 'Conta vencendo',
    description: 'Avisa sobre despesas que vencem nos próximos dias.',
    category: 'FINANCEIRO',
    trigger: 'EXPENSE_DUE',
    conditions: [{ field: 'days_to_due', operator: 'LTE', value: 3 }],
    actions: [{ type: 'CREATE_NOTIFICATION' }, { type: 'AUDIT' }],
    cooldown_minutes: 1440,
  },
  {
    name: 'Conta vencida',
    description: 'Avisa quando uma despesa passa da data de vencimento.',
    category: 'FINANCEIRO',
    trigger: 'EXPENSE_OVERDUE',
    conditions: [{ field: 'days_overdue', operator: 'GTE', value: 1 }],
    actions: [{ type: 'CREATE_ALERT' }, { type: 'REQUEST_INTERVENTION' }],
    cooldown_minutes: 1440,
  },
  {
    name: 'Resumo diário de vendas',
    description: 'Prepara o resumo operacional do dia para acompanhamento.',
    category: 'RELATORIOS',
    trigger: 'REPORT_DAILY',
    conditions: [],
    actions: [{ type: 'GENERATE_REPORT' }, { type: 'AUDIT' }],
    cooldown_minutes: 1440,
  },
];
