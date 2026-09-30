import { supabase, isSupabaseConfigured } from '../../lib/supabase/client';
import type { AutomationCategory, AutomationEvent, AutomationRule, AutomationRun, AutomationStatus, AutomationTrigger } from './automations.model';

export interface CreateAutomationInput {
  name: string;
  description: string;
  category: AutomationCategory;
  trigger: AutomationTrigger;
  conditions: Record<string, unknown>[];
  actions: Record<string, unknown>[];
  priority: number;
  cooldown_minutes: number;
  schedule?: string | null;
  timezone?: string;
}

export type AutomationMutationResult = { success: boolean; message?: string; id?: string };

async function rpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
  if (!isSupabaseConfigured) throw new Error('Serviço de automações indisponível.');
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw error;
  return data as T;
}

export const AutomationsService = {
  async list(storeId: string): Promise<AutomationRule[]> {
    if (!isSupabaseConfigured || !storeId) return [];
    const { data, error } = await supabase
      .from('automation_rules')
      .select('*')
      .eq('store_id', storeId)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return ((data ?? []) as Array<AutomationRule & { trigger_type?: string }>).map(row => ({
      ...row,
      trigger: row.trigger_type ?? row.trigger,
    })) as AutomationRule[];
  },

  async listRuns(storeId: string, limit = 50): Promise<AutomationRun[]> {
    if (!isSupabaseConfigured || !storeId) return [];
    const { data, error } = await supabase
      .from('automation_runs')
      .select('*')
      .eq('store_id', storeId)
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as AutomationRun[];
  },

  async listEvents(storeId: string, limit = 100): Promise<AutomationEvent[]> {
    if (!isSupabaseConfigured || !storeId) return [];
    const { data, error } = await supabase
      .from('automation_events')
      .select('*')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  },

  async create(storeId: string, input: CreateAutomationInput): Promise<AutomationMutationResult> {
    return rpc<AutomationMutationResult>('create_automation_rule', {
      p_store_id: storeId,
      p_name: input.name,
      p_description: input.description,
      p_category: input.category,
      p_trigger: input.trigger,
      p_conditions: input.conditions,
      p_actions: input.actions,
      p_priority: input.priority,
      p_cooldown_minutes: input.cooldown_minutes,
      p_schedule: input.schedule ?? null,
      p_timezone: input.timezone ?? 'America/Sao_Paulo',
    });
  },

  async update(storeId: string, id: string, input: Partial<CreateAutomationInput>): Promise<AutomationMutationResult> {
    return rpc<AutomationMutationResult>('update_automation_rule', {
      p_store_id: storeId,
      p_automation_id: id,
      p_name: input.name,
      p_description: input.description,
      p_category: input.category,
      p_trigger: input.trigger,
      p_conditions: input.conditions,
      p_actions: input.actions,
      p_priority: input.priority,
      p_cooldown_minutes: input.cooldown_minutes,
      p_schedule: input.schedule,
      p_timezone: input.timezone,
    });
  },

  async setStatus(storeId: string, id: string, status: AutomationStatus): Promise<AutomationMutationResult> {
    return rpc<AutomationMutationResult>('set_automation_rule_status', {
      p_store_id: storeId,
      p_automation_id: id,
      p_status: status,
    });
  },

  async test(storeId: string, id: string): Promise<AutomationMutationResult> {
    return rpc<AutomationMutationResult>('test_automation_rule', {
      p_store_id: storeId,
      p_automation_id: id,
    });
  },
};
