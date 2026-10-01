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
  timezone: string;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  next_run_at: string | null;
  execution_count: number;
  failure_count: number;
  archived_at: string | null;
  archived_by: string | null;
}

export interface AutomationEvent {
  id: string;
  store_id: string;
  automation_id: string | null;
  event_type: string;
  reference_id: string | null;
  idempotency_key: string | null;
  payload: Record<string, unknown>;
  processed_at: string | null;
  processing_error: string | null;
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

export interface AutomationTestResult {
  success: boolean;
  dry_run: boolean;
  rule_id: string;
  eligible: boolean;
  matched_count: number;
  in_cooldown: boolean;
  next_run_at: string | null;
  message: string;
  evaluation: {
    eligible?: boolean;
    matched_count?: number;
    trigger?: AutomationTrigger;
    summary?: Record<string, unknown>;
  };
}

export const AUTOMATION_PRESETS: Array<{
  name: string;
  description: string;
  category: AutomationCategory;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  cooldown_minutes: number;
  schedule?: string | null;
  timezone?: string;
}> = [
  {
    name: 'Alerta de estoque baixo',
    description: 'Gera alerta assim que um SKU atinge o estoque mínimo.',
    category: 'ESTOQUE',
    trigger: 'LOW_STOCK',
    conditions: [{ field: 'quantity', operator: 'LTE', value: 'minimum_stock' }],
    actions: [{ type: 'CREATE_ALERT' }, { type: 'CREATE_NOTIFICATION' }],
    cooldown_minutes: 1440,
    schedule: null,
  },
  {
    name: 'Produto esgotado',
    description: 'Sinaliza imediatamente produtos sem saldo disponível.',
    category: 'ESTOQUE',
    trigger: 'OUT_OF_STOCK',
    conditions: [{ field: 'quantity', operator: 'EQ', value: 0 }],
    actions: [{ type: 'CREATE_ALERT' }, { type: 'REQUEST_INTERVENTION' }],
    cooldown_minutes: 1440,
    schedule: null,
  },
  {
    name: 'Conta vencendo',
    description: 'Avisa diariamente sobre despesas que vencem nos próximos 3 dias.',
    category: 'FINANCEIRO',
    trigger: 'EXPENSE_DUE',
    conditions: [{ field: 'days_to_due', operator: 'LTE', value: 3 }],
    actions: [{ type: 'CREATE_NOTIFICATION' }, { type: 'AUDIT' }],
    cooldown_minutes: 1440,
    schedule: '09:00',
  },
  {
    name: 'Conta vencida',
    description: 'Avisa diariamente quando uma despesa está vencida.',
    category: 'FINANCEIRO',
    trigger: 'EXPENSE_OVERDUE',
    conditions: [{ field: 'days_overdue', operator: 'GTE', value: 1 }],
    actions: [{ type: 'CREATE_ALERT' }, { type: 'REQUEST_INTERVENTION' }],
    cooldown_minutes: 1440,
    schedule: '09:05',
  },
  {
    name: 'Venda concluída',
    description: 'Registra uma notificação interna quando uma venda é concluída.',
    category: 'VENDAS',
    trigger: 'SALE_COMPLETED',
    conditions: [],
    actions: [{ type: 'CREATE_NOTIFICATION' }, { type: 'AUDIT' }],
    cooldown_minutes: 0,
    schedule: null,
  },
  {
    name: 'Cliente inativo',
    description: 'Identifica clientes sem compra há 90 dias.',
    category: 'CLIENTES',
    trigger: 'CUSTOMER_INACTIVE',
    conditions: [{ field: 'days_inactive', operator: 'DAYS_GTE', value: 90 }],
    actions: [{ type: 'CREATE_NOTIFICATION' }],
    cooldown_minutes: 1440,
    schedule: '10:00',
  },
  {
    name: 'Produto sem giro',
    description: 'Identifica produtos sem venda há 60 dias.',
    category: 'PRODUTOS',
    trigger: 'PRODUCT_INACTIVE',
    conditions: [{ field: 'days_inactive', operator: 'DAYS_GTE', value: 60 }],
    actions: [{ type: 'CREATE_NOTIFICATION' }],
    cooldown_minutes: 1440,
    schedule: '10:05',
  },
  {
    name: 'Resumo diário de vendas',
    description: 'Prepara o resumo operacional do dia para acompanhamento.',
    category: 'RELATORIOS',
    trigger: 'REPORT_DAILY',
    conditions: [],
    actions: [{ type: 'GENERATE_REPORT' }, { type: 'AUDIT' }],
    cooldown_minutes: 1440,
    schedule: '18:00',
  },
];
