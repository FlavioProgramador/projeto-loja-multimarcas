import { describe, expect, it } from 'vitest';
import {
  buildConditions,
  defaultActionsForTrigger,
  isEventOnlyTrigger,
  isScheduleRequired,
  thresholdFromConditions,
} from './automation-form';

describe('automation-form', () => {
  it('identifica gatilhos orientados a evento', () => {
    expect(isEventOnlyTrigger('SALE_COMPLETED')).toBe(true);
    expect(isEventOnlyTrigger('RETURN_COMPLETED')).toBe(true);
    expect(isEventOnlyTrigger('EXPENSE_DUE')).toBe(false);
  });

  it('exige agenda somente para gatilhos temporais', () => {
    expect(isScheduleRequired('REPORT_DAILY')).toBe(true);
    expect(isScheduleRequired('CUSTOMER_INACTIVE')).toBe(true);
    expect(isScheduleRequired('LOW_STOCK')).toBe(false);
  });

  it('preserva condição simbólica quando o limite não é alterado', () => {
    const existing = [{ field: 'quantity', operator: 'LTE' as const, value: 'minimum_stock' }];

    expect(thresholdFromConditions(existing)).toBe('');
    expect(buildConditions('LOW_STOCK', '', existing)).toEqual(existing);
  });

  it('substitui condição por limite numérico quando informado', () => {
    expect(buildConditions('EXPENSE_DUE', '5', [])).toEqual([
      { field: 'days_to_due', operator: 'LTE', value: 5 },
    ]);

    expect(buildConditions('CUSTOMER_INACTIVE', '90', [])).toEqual([
      { field: 'days_inactive', operator: 'DAYS_GTE', value: 90 },
    ]);
  });

  it('define ações padrão coerentes com o gatilho', () => {
    expect(defaultActionsForTrigger('REPORT_DAILY')).toEqual([
      { type: 'GENERATE_REPORT' },
      { type: 'AUDIT' },
    ]);

    expect(defaultActionsForTrigger('OUT_OF_STOCK')).toEqual([
      { type: 'CREATE_ALERT' },
      { type: 'REQUEST_INTERVENTION' },
    ]);
  });
});
