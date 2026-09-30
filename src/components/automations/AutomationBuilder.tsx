import React, { useState } from 'react';
import { X, Save, Zap } from 'lucide-react';
import type { AutomationAction, AutomationCategory, AutomationCondition, AutomationRule, AutomationTrigger } from '../../services/automations';
import { AUTOMATION_PRESETS } from '../../services/automations';

type Props = {
  initial?: AutomationRule | null;
  onClose: () => void;
  onSave: (input: {
    name: string; description: string; category: AutomationCategory; trigger: AutomationTrigger;
    conditions: Record<string, unknown>[]; actions: Record<string, unknown>[];
    priority: number; cooldown_minutes: number; schedule: string | null;
  }) => Promise<void>;
  onPreset?: (preset: typeof AUTOMATION_PRESETS[number]) => void;
};

const categories: AutomationCategory[] = ['ESTOQUE','VENDAS','FINANCEIRO','CLIENTES','PRODUTOS','SISTEMA','RELATORIOS'];
const triggers: Array<{ value: AutomationTrigger; label: string; category: AutomationCategory }> = [
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

export const AutomationBuilder: React.FC<Props> = ({ initial, onClose, onSave, onPreset }) => {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [category, setCategory] = useState<AutomationCategory>(initial?.category ?? 'ESTOQUE');
  const [trigger, setTrigger] = useState<AutomationTrigger>(initial?.trigger ?? 'LOW_STOCK');
  const [threshold, setThreshold] = useState('');
  const [cooldown, setCooldown] = useState(String(initial?.cooldown_minutes ?? 1440));
  const [schedule, setSchedule] = useState(initial?.schedule ?? '');
  const [timezone, setTimezone] = useState(initial?.timezone ?? 'America/Sao_Paulo');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState('');


  const save = async () => {
    if (name.trim().length < 2) { setError('Informe um nome para a automação.'); return; }
    setSaving(true); setError(null);
    try {
      const condition: AutomationCondition | null = threshold ? { field: 'threshold', operator: 'LTE', value: Number(threshold) } : null;
      const action: AutomationAction = trigger.startsWith('REPORT_') ? { type: 'GENERATE_REPORT' } : { type: 'CREATE_NOTIFICATION' };
      await onSave({
        name: name.trim(), description: description.trim(), category, trigger,
        conditions: condition ? [condition] : [], actions: [action], priority: 100,
        cooldown_minutes: Math.max(0, Number(cooldown) || 0), schedule: schedule || null, timezone,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar a automação.');
    } finally { setSaving(false); }
  };

  const applyPreset = (index: number) => {
    const selected = AUTOMATION_PRESETS[index];
    if (!selected) return;
    setPreset(String(index)); setName(selected.name); setDescription(selected.description);
    setCategory(selected.category); setTrigger(selected.trigger);
    setCooldown(String(selected.cooldown_minutes));
    setThreshold(typeof selected.conditions[0]?.value === 'number' ? String(selected.conditions[0].value) : '');
    onPreset?.(selected);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content automation-builder" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title"><Zap size={18} /> Nova automação</div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="automation-form-grid">
            <div className="field"><label>Modelo pronto</label><select defaultValue="" onChange={e => e.target.value && applyPreset(Number(e.target.value))}><option value="">Começar do zero</option>{AUTOMATION_PRESETS.map((p,i)=><option value={i} key={p.name}>{p.name}</option>)}</select></div>
            <div className="field"><label>Nome</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: Alertar estoque crítico" /></div>
            <div className="field full"><label>Descrição</label><textarea value={description} onChange={e=>setDescription(e.target.value)} rows={3} placeholder="Explique o que esta regra deve acompanhar." /></div>
            <div className="field"><label>Categoria</label><select value={category} onChange={e=>setCategory(e.target.value as AutomationCategory)}>{categories.map(c=><option value={c} key={c}>{c}</option>)}</select></div>
            <div className="field"><label>Quando</label><select value={trigger} onChange={e=>{const t=triggers.find(x=>x.value===e.target.value); setTrigger(e.target.value as AutomationTrigger); if(t) setCategory(t.category);}}>{triggers.map(t=><option value={t.value} key={t.value}>{t.label}</option>)}</select></div>
            <div className="field"><label>Limite (opcional)</label><input inputMode="numeric" value={threshold} onChange={e=>setThreshold(e.target.value.replace(/[^0-9]/g,''))} placeholder="Ex.: 2" /></div>
            <div className="field"><label>Intervalo entre alertas (min.)</label><input inputMode="numeric" value={cooldown} onChange={e=>setCooldown(e.target.value.replace(/[^0-9]/g,''))} /></div>
            <div className="field"><label>Horário de execução (HH:MM)</label><input type="time" value={schedule} onChange={e=>setSchedule(e.target.value)} /></div>
            <div className="field"><label>Fuso horário</label><select value={timezone} onChange={e=>setTimezone(e.target.value)}><option value="America/Sao_Paulo">Brasília (UTC−03:00)</option><option value="America/Manaus">Manaus (UTC−04:00)</option><option value="America/Belem">Belém (UTC−03:00)</option><option value="America/Fortaleza">Fortaleza (UTC−03:00)</option></select></div>
            <div className="automation-builder-flow full"><span>QUANDO</span><strong>{triggers.find(t=>t.value===trigger)?.label}</strong><span>ENTÃO</span><strong>{trigger.startsWith('REPORT_') ? 'Preparar relatório' : 'Gerar notificação interna'}</strong></div>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-actions"><button className="btn btn-outline" onClick={onClose}>Cancelar</button><button className="btn" onClick={save} disabled={saving}><Save size={16}/>{saving ? 'Salvando...' : 'Salvar automação'}</button></div>
        </div>
      </div>
    </div>
  );
};
