import React, { useState } from 'react';
import { Save, X, Zap } from 'lucide-react';
import type {
  AutomationAction,
  AutomationActionType,
  AutomationCategory,
  AutomationCondition,
  AutomationRule,
  AutomationTrigger,
} from '../../services/automations';
import { AUTOMATION_PRESETS } from '../../services/automations';
import {
  buildConditions,
  defaultActionsForTrigger,
  isEventOnlyTrigger,
  isScheduleRequired,
  thresholdFromConditions,
} from './automation-form';

type Props = {
  initial?: AutomationRule | null;
  initialPresetIndex?: number | null;
  onClose: () => void;
  onSave: (input: {
    name: string;
    description: string;
    category: AutomationCategory;
    trigger: AutomationTrigger;
    conditions: AutomationCondition[];
    actions: AutomationAction[];
    priority: number;
    cooldown_minutes: number;
    schedule: string | null;
    timezone: string;
  }) => Promise<void>;
};

const categories: AutomationCategory[] = [
  'ESTOQUE',
  'VENDAS',
  'FINANCEIRO',
  'CLIENTES',
  'PRODUTOS',
  'SISTEMA',
  'RELATORIOS',
];

const triggers: Array<{
  value: AutomationTrigger;
  label: string;
  category: AutomationCategory;
}> = [
  { value: 'LOW_STOCK', label: 'Estoque abaixo do mínimo', category: 'ESTOQUE' },
  { value: 'OUT_OF_STOCK', label: 'Produto esgotado', category: 'ESTOQUE' },
  { value: 'EXPENSE_DUE', label: 'Despesa próxima do vencimento', category: 'FINANCEIRO' },
  { value: 'EXPENSE_OVERDUE', label: 'Despesa vencida', category: 'FINANCEIRO' },
  { value: 'SALE_COMPLETED', label: 'Venda concluída', category: 'VENDAS' },
  { value: 'SALE_CANCELLED', label: 'Venda cancelada', category: 'VENDAS' },
  { value: 'RETURN_COMPLETED', label: 'Troca ou devolução concluída', category: 'VENDAS' },
  { value: 'CUSTOMER_INACTIVE', label: 'Cliente sem compra', category: 'CLIENTES' },
  { value: 'PRODUCT_INACTIVE', label: 'Produto sem giro', category: 'PRODUTOS' },
  { value: 'REPORT_DAILY', label: 'Fechamento diário', category: 'RELATORIOS' },
  { value: 'REPORT_WEEKLY', label: 'Resumo semanal', category: 'RELATORIOS' },
  { value: 'REPORT_MONTHLY', label: 'Resumo mensal', category: 'RELATORIOS' },
];

const actionOptions: Array<{ value: AutomationActionType; label: string }> = [
  { value: 'CREATE_ALERT', label: 'Criar alerta' },
  { value: 'CREATE_NOTIFICATION', label: 'Criar notificação' },
  { value: 'GENERATE_REPORT', label: 'Gerar resumo/relatório' },
  { value: 'REQUEST_INTERVENTION', label: 'Solicitar intervenção' },
  { value: 'AUDIT', label: 'Registrar auditoria' },
];

const actionLabel = (type: AutomationActionType) =>
  actionOptions.find(option => option.value === type)?.label ?? type;

export const AutomationBuilder: React.FC<Props> = ({
  initial,
  initialPresetIndex,
  onClose,
  onSave,
}) => {
  const selectedPreset =
    !initial && initialPresetIndex != null
      ? AUTOMATION_PRESETS[initialPresetIndex]
      : undefined;

  const base = initial ?? selectedPreset;
  const initialTrigger = base?.trigger ?? 'LOW_STOCK';
  const initialConditions = base?.conditions ?? [];
  const initialActions = base?.actions?.length
    ? base.actions
    : defaultActionsForTrigger(initialTrigger);

  const [name, setName] = useState(base?.name ?? '');
  const [description, setDescription] = useState(base?.description ?? '');
  const [category, setCategory] = useState<AutomationCategory>(base?.category ?? 'ESTOQUE');
  const [trigger, setTrigger] = useState<AutomationTrigger>(initialTrigger);
  const [conditions, setConditions] = useState<AutomationCondition[]>(initialConditions);
  const [actions, setActions] = useState<AutomationAction[]>(initialActions);
  const [threshold, setThreshold] = useState(thresholdFromConditions(initialConditions));
  const [priority, setPriority] = useState(String(initial?.priority ?? 100));
  const [cooldown, setCooldown] = useState(String(base?.cooldown_minutes ?? 1440));
  const [schedule, setSchedule] = useState(initial?.schedule ?? selectedPreset?.schedule ?? '');
  const [timezone, setTimezone] = useState(
    initial?.timezone ?? selectedPreset?.timezone ?? 'America/Sao_Paulo',
  );
  const [preset, setPreset] = useState(
    initialPresetIndex != null && !initial ? String(initialPresetIndex) : '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyPreset = (index: number) => {
    const selected = AUTOMATION_PRESETS[index];
    if (!selected) return;

    setPreset(String(index));
    setName(selected.name);
    setDescription(selected.description);
    setCategory(selected.category);
    setTrigger(selected.trigger);
    setConditions(selected.conditions);
    setActions(selected.actions);
    setThreshold(thresholdFromConditions(selected.conditions));
    setCooldown(String(selected.cooldown_minutes));
    setSchedule(selected.schedule ?? '');
    setTimezone(selected.timezone ?? 'America/Sao_Paulo');
    setPriority('100');
    setError(null);
  };

  const changeTrigger = (nextTrigger: AutomationTrigger) => {
    const selected = triggers.find(item => item.value === nextTrigger);
    setTrigger(nextTrigger);
    if (selected) setCategory(selected.category);
    setConditions([]);
    setThreshold('');
    setActions(defaultActionsForTrigger(nextTrigger));
    if (isEventOnlyTrigger(nextTrigger)) setSchedule('');
  };

  const toggleAction = (type: AutomationActionType) => {
    setActions(current =>
      current.some(action => action.type === type)
        ? current.filter(action => action.type !== type)
        : [...current, { type }],
    );
  };

  const save = async () => {
    if (name.trim().length < 2) {
      setError('Informe um nome para a automação.');
      return;
    }

    if (isScheduleRequired(trigger) && !schedule) {
      setError('Informe um horário para este tipo de automação.');
      return;
    }

    if (!actions.length) {
      setError('Selecione pelo menos uma ação.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        category,
        trigger,
        conditions: buildConditions(trigger, threshold, conditions),
        actions,
        priority: Math.min(1000, Math.max(0, Number(priority) || 0)),
        cooldown_minutes: Math.max(0, Number(cooldown) || 0),
        schedule: isEventOnlyTrigger(trigger) ? null : schedule || null,
        timezone,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar a automação.');
    } finally {
      setSaving(false);
    }
  };

  const triggerLabel = triggers.find(item => item.value === trigger)?.label ?? trigger;
  const actionSummary = actions.map(action => actionLabel(action.type)).join(' + ');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content automation-builder" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <Zap size={18} /> {initial ? 'Editar automação' : 'Nova automação'}
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="automation-form-grid">
            <div className="field">
              <label>Modelo pronto</label>
              <select
                value={preset}
                onChange={event => {
                  const value = event.target.value;
                  setPreset(value);
                  if (value !== '') applyPreset(Number(value));
                }}
              >
                <option value="">Começar do zero</option>
                {AUTOMATION_PRESETS.map((item, index) => (
                  <option value={index} key={item.name}>{item.name}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Nome</label>
              <input
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder="Ex.: Alertar estoque crítico"
              />
            </div>

            <div className="field full">
              <label>Descrição</label>
              <textarea
                value={description}
                onChange={event => setDescription(event.target.value)}
                rows={3}
                placeholder="Explique o que esta regra deve acompanhar."
              />
            </div>

            <div className="field">
              <label>Categoria</label>
              <select
                value={category}
                onChange={event => setCategory(event.target.value as AutomationCategory)}
              >
                {categories.map(item => <option value={item} key={item}>{item}</option>)}
              </select>
            </div>

            <div className="field">
              <label>Quando</label>
              <select
                value={trigger}
                onChange={event => changeTrigger(event.target.value as AutomationTrigger)}
              >
                {triggers.map(item => (
                  <option value={item.value} key={item.value}>{item.label}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Limite / dias (opcional)</label>
              <input
                inputMode="numeric"
                value={threshold}
                onChange={event => setThreshold(event.target.value.replace(/[^0-9]/g, ''))}
                placeholder="Ex.: 3"
              />
            </div>

            <div className="field">
              <label>Intervalo entre ações (min.)</label>
              <input
                inputMode="numeric"
                value={cooldown}
                onChange={event => setCooldown(event.target.value.replace(/[^0-9]/g, ''))}
              />
            </div>

            <div className="field">
              <label>Prioridade (0 a 1000)</label>
              <input
                inputMode="numeric"
                value={priority}
                onChange={event => setPriority(event.target.value.replace(/[^0-9]/g, ''))}
              />
            </div>

            <div className="field">
              <label>Horário de execução</label>
              <input
                type="time"
                value={schedule}
                disabled={isEventOnlyTrigger(trigger)}
                onChange={event => setSchedule(event.target.value)}
              />
              <small>
                {isEventOnlyTrigger(trigger)
                  ? 'Executada pelo evento real, sem horário fixo.'
                  : isScheduleRequired(trigger)
                    ? 'Obrigatório para este gatilho.'
                    : 'Opcional: eventos de estoque também executam em tempo real.'}
              </small>
            </div>

            <div className="field">
              <label>Fuso horário</label>
              <select value={timezone} onChange={event => setTimezone(event.target.value)}>
                <option value="America/Sao_Paulo">Brasília (UTC−03:00)</option>
                <option value="America/Manaus">Manaus (UTC−04:00)</option>
                <option value="America/Belem">Belém (UTC−03:00)</option>
                <option value="America/Fortaleza">Fortaleza (UTC−03:00)</option>
              </select>
            </div>

            <div className="field full">
              <label>Ações</label>
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                {actionOptions.map(option => (
                  <label
                    key={option.value}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={actions.some(action => action.type === option.value)}
                      onChange={() => toggleAction(option.value)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="automation-builder-flow full">
              <span>QUANDO</span>
              <strong>{triggerLabel}</strong>
              <span>ENTÃO</span>
              <strong>{actionSummary || 'Nenhuma ação selecionada'}</strong>
            </div>
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="modal-actions">
            <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
            <button className="btn" onClick={() => void save()} disabled={saving}>
              <Save size={16} />
              {saving ? 'Salvando...' : 'Salvar automação'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
