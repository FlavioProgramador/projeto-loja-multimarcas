import type {
  AutomationAction,
  AutomationCondition,
  AutomationTrigger,
} from '../../services/automations';

const EVENT_ONLY_TRIGGERS: AutomationTrigger[] = [
  'SALE_COMPLETED',
  'SALE_CANCELLED',
  'RETURN_COMPLETED',
];

const SCHEDULE_REQUIRED_TRIGGERS: AutomationTrigger[] = [
  'EXPENSE_DUE',
  'EXPENSE_OVERDUE',
  'CUSTOMER_INACTIVE',
  'PRODUCT_INACTIVE',
  'REPORT_DAILY',
  'REPORT_WEEKLY',
  'REPORT_MONTHLY',
];

export function isEventOnlyTrigger(trigger: AutomationTrigger): boolean {
  return EVENT_ONLY_TRIGGERS.includes(trigger);
}

export function isScheduleRequired(trigger: AutomationTrigger): boolean {
  return SCHEDULE_REQUIRED_TRIGGERS.includes(trigger);
}

export function thresholdFromConditions(conditions: AutomationCondition[]): string {
  const condition = conditions.find(item =>
    ['threshold', 'quantity', 'days_to_due', 'days_overdue', 'days_inactive'].includes(item.field)
  );

  return typeof condition?.value === 'number' ? String(condition.value) : '';
}

export function defaultActionsForTrigger(trigger: AutomationTrigger): AutomationAction[] {
  if (trigger.startsWith('REPORT_')) {
    return [{ type: 'GENERATE_REPORT' }, { type: 'AUDIT' }];
  }

  if (trigger === 'OUT_OF_STOCK' || trigger === 'EXPENSE_OVERDUE') {
    return [{ type: 'CREATE_ALERT' }, { type: 'REQUEST_INTERVENTION' }];
  }

  if (trigger === 'LOW_STOCK') {
    return [{ type: 'CREATE_ALERT' }, { type: 'CREATE_NOTIFICATION' }];
  }

  return [{ type: 'CREATE_NOTIFICATION' }];
}

export function buildConditions(
  trigger: AutomationTrigger,
  threshold: string,
  existing: AutomationCondition[],
): AutomationCondition[] {
  if (!threshold) return existing;

  const value = Number(threshold);
  if (!Number.isFinite(value)) return existing;

  switch (trigger) {
    case 'LOW_STOCK':
      return [{ field: 'quantity', operator: 'LTE', value }];
    case 'OUT_OF_STOCK':
      return [{ field: 'quantity', operator: 'EQ', value: 0 }];
    case 'EXPENSE_DUE':
      return [{ field: 'days_to_due', operator: 'LTE', value }];
    case 'EXPENSE_OVERDUE':
      return [{ field: 'days_overdue', operator: 'GTE', value }];
    case 'CUSTOMER_INACTIVE':
    case 'PRODUCT_INACTIVE':
      return [{ field: 'days_inactive', operator: 'DAYS_GTE', value }];
    default:
      return existing;
  }
}
