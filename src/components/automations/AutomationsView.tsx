import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, CheckCircle2, Clock3, FileText, History, Pause, Play, Plus, RefreshCw, Settings2, ShieldCheck, Trash2, TriangleAlert, XCircle, Zap } from 'lucide-react';
import { useStore } from '../../contexts/StoreContext';
import { AutomationsService, AutomationRule, AutomationRun, AUTOMATION_PRESETS } from '../../services/automations';
import { AutomationBuilder } from './AutomationBuilder';
import { can } from '../../lib/permissions';

const categoryLabels: Record<string, string> = {
  ESTOQUE: 'Estoque', VENDAS: 'Vendas', FINANCEIRO: 'Financeiro', CLIENTES: 'Clientes',
  PRODUTOS: 'Produtos', SISTEMA: 'Sistema', RELATORIOS: 'Relatórios',
};
const triggerLabels: Record<string, string> = {
  LOW_STOCK: 'Estoque abaixo do mínimo', OUT_OF_STOCK: 'Produto esgotado',
  EXPENSE_DUE: 'Despesa próxima do vencimento', EXPENSE_OVERDUE: 'Despesa vencida',
  SALE_COMPLETED: 'Venda concluída', SALE_CANCELLED: 'Venda cancelada',
  RETURN_COMPLETED: 'Troca ou devolução concluída', CUSTOMER_INACTIVE: 'Cliente sem compra',
  PRODUCT_INACTIVE: 'Produto sem giro', REPORT_DAILY: 'Fechamento diário',
  REPORT_WEEKLY: 'Resumo semanal', REPORT_MONTHLY: 'Resumo mensal',
};

export const AutomationsView: React.FC = () => {
  const { activeStoreId, activeStoreRole } = useStore();
  const canManage = can(activeStoreRole, 'automations.manage');
  const canView = can(activeStoreRole, 'automations.view');
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [events, setEvents] = useState<Awaited<ReturnType<typeof AutomationsService.listEvents>>>([]);
  const [tab, setTab] = useState<'overview' | 'rules' | 'runs' | 'alerts' | 'settings'>('overview');
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [loading, setLoading] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!activeStoreId || !canView) return;
    setLoading(true);
    try {
      const [nextRules, nextRuns, nextEvents] = await Promise.all([
        AutomationsService.list(activeStoreId),
        AutomationsService.listRuns(activeStoreId, 100),
        AutomationsService.listEvents(activeStoreId, 100),
      ]);
      setRules(nextRules);
      setRuns(nextRuns);
      setEvents(nextEvents);
      setMessage(null);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Não foi possível carregar as automações.' });
    } finally {
      setLoading(false);
    }
  }, [activeStoreId, canView]);

  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => ({
    active: rules.filter(r => r.status === 'ACTIVE').length,
    failed: runs.filter(r => r.status === 'FAILED').length,
    today: runs.filter(r => r.started_at.slice(0, 10) === new Date().toISOString().slice(0, 10)).length,
    completed: runs.filter(r => r.status === 'COMPLETED').length,
    alerts: events.filter(e => ['ALERT', 'NOTIFICATION', 'INTERVENTION'].includes(e.event_type)).length,
  }), [rules, runs, events]);

  const saveRule = async (input: Parameters<typeof AutomationsService.create>[1]) => {
    if (!activeStoreId || !canManage) return;
    if (editing) await AutomationsService.update(activeStoreId, editing.id, input);
    else await AutomationsService.create(activeStoreId, input);
    setBuilderOpen(false);
    setEditing(null);
    setMessage({ type: 'success', text: editing ? 'Automação atualizada.' : 'Automação criada como pausada. Ative-a quando estiver pronta.' });
    await load();
  };

  const setStatus = async (rule: AutomationRule) => {
    if (!activeStoreId || !canManage || workingId) return;
    setWorkingId(rule.id);
    try {
      await AutomationsService.setStatus(activeStoreId, rule.id, rule.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE');
      await load();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Não foi possível alterar o status.' });
    } finally {
      setWorkingId(null);
    }
  };

  const testRule = async (rule: AutomationRule) => {
    if (!activeStoreId || !canManage || workingId) return;
    setWorkingId(rule.id);
    try {
      const result = await AutomationsService.test(activeStoreId, rule.id);
      setMessage({ type: 'success', text: result.message || 'Teste concluído. Nenhuma ação operacional foi executada.' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Falha no teste.' });
    } finally {
      setWorkingId(null);
    }
  };

  const deleteRule = async (rule: AutomationRule) => {
    if (!activeStoreId || !canManage || workingId) return;
    const confirmed = window.confirm(`Excluir a automação "${rule.name}"? O histórico de execuções relacionado também será removido.`);
    if (!confirmed) return;
    setWorkingId(rule.id);
    try {
      await AutomationsService.remove(activeStoreId, rule.id);
      setMessage({ type: 'success', text: 'Automação excluída.' });
      await load();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Não foi possível excluir a automação.' });
    } finally {
      setWorkingId(null);
    }
  };

  if (!canView) {
    return <div className="module-fade"><div className="card automation-access-denied">
      <ShieldCheck size={24} /><h2>Acesso não disponível</h2>
      <p>Seu perfil não possui permissão para consultar as automações desta loja.</p>
    </div></div>;
  }

  return (
    <div className="module-fade automation-module">
      <div className="page-header">
        <div><h1 className="page-title">Automações</h1><p className="page-subtitle">Configure regras para acompanhar a operação da loja e agir no momento certo.</p></div>
        <div className="automation-header-actions">
          <button className="btn btn-outline" onClick={() => void load()} disabled={loading}><RefreshCw size={16} /> Atualizar</button>
          {canManage && <button className="btn" onClick={() => { setEditing(null); setBuilderOpen(true); }}><Plus size={16} /> Nova automação</button>}
        </div>
      </div>

      {message && <div className={'automation-message ' + message.type}>{message.type === 'success' ? <CheckCircle2 size={16} /> : <TriangleAlert size={16} />}<span>{message.text}</span><button onClick={() => setMessage(null)} aria-label="Fechar mensagem">×</button></div>}

      <div className="automation-stat-grid">
        <div className="automation-stat"><div><span>Automações ativas</span><strong>{stats.active}</strong></div><Play size={18} /></div>
        <div className="automation-stat"><div><span>Execuções hoje</span><strong>{stats.today}</strong></div><Clock3 size={18} /></div>
        <div className="automation-stat"><div><span>Falhas</span><strong>{stats.failed}</strong></div><XCircle size={18} /></div>
        <div className="automation-stat"><div><span>Concluídas</span><strong>{stats.completed}</strong></div><CheckCircle2 size={18} /></div>
      </div>

      <div className="automation-tabs" role="tablist">
        {([['overview', 'Visão geral'], ['rules', 'Automações'], ['runs', 'Execuções'], ['alerts', 'Alertas'], ['settings', 'Configurações']] as const).map(([value, label]) =>
          <button key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)} role="tab">{label}</button>
        )}
      </div>

      {tab === 'overview' && <div className="automation-overview-grid">
        <div className="card automation-panel"><div className="automation-panel-head"><div><h2>Operação automatizada</h2><p>Visão rápida das regras disponíveis.</p></div><Bot size={20} /></div>
          <div className="automation-category-list">{Object.entries(categoryLabels).map(([key, label]) => <div key={key}><span>{label}</span><strong>{rules.filter(r => r.category === key).length}</strong></div>)}</div>
        </div>
        <div className="card automation-panel"><div className="automation-panel-head"><div><h2>Modelos prontos</h2><p>Comece com uma configuração predefinida.</p></div><Settings2 size={20} /></div>
          <div className="automation-preset-grid">{AUTOMATION_PRESETS.slice(0, 4).map(p => <button key={p.name} onClick={() => { setEditing(null); setBuilderOpen(true); }}><strong>{p.name}</strong><span>{p.description}</span></button>)}</div>
        </div>
        <div className="card automation-panel full"><div className="automation-panel-head"><div><h2>Últimas execuções</h2><p>Processamento recente das regras.</p></div><History size={20} /></div>
          <div className="automation-run-list">{runs.slice(0, 8).map(run => <div key={run.id}><span>{triggerLabels[run.event_type] || run.event_type}</span><strong className={'run-status ' + run.status.toLowerCase()}>{run.status}</strong><time>{new Date(run.started_at).toLocaleString('pt-BR')}</time></div>)}{!runs.length && <div className="automation-empty">Ainda não existem execuções registradas.</div>}</div>
        </div>
      </div>}

      {tab === 'rules' && <div className="card automation-panel"><div className="automation-panel-head"><div><h2>Suas automações</h2><p>Ative, pause e teste suas regras.</p></div>{canManage && <button className="btn" onClick={() => { setEditing(null); setBuilderOpen(true); }}><Plus size={16} /> Nova</button>}</div>
        <div className="automation-table-wrap"><table><thead><tr><th>Automação</th><th>Categoria</th><th>Gatilho</th><th>Status</th><th>Execuções</th><th>Ações</th></tr></thead>
          <tbody>{rules.map(rule => <tr key={rule.id}><td><strong>{rule.name}</strong><small>{rule.description || 'Sem descrição'}</small></td><td>{categoryLabels[rule.category] || rule.category}</td><td>{triggerLabels[rule.trigger] || rule.trigger}</td><td><span className={'automation-status ' + rule.status.toLowerCase()}>{rule.status === 'ACTIVE' ? 'Ativa' : 'Pausada'}</span></td><td>{rule.execution_count}</td><td><div className="automation-row-actions">{canManage && <><button title="Editar" onClick={() => { setEditing(rule); setBuilderOpen(true); }}><Settings2 size={15} /></button><button title={rule.status === 'ACTIVE' ? 'Pausar' : 'Ativar'} onClick={() => void setStatus(rule)} disabled={workingId === rule.id}>{rule.status === 'ACTIVE' ? <Pause size={15} /> : <Play size={15} />}</button><button title="Testar" onClick={() => void testRule(rule)} disabled={workingId === rule.id}><Zap size={15} /></button><button title="Excluir" onClick={() => void deleteRule(rule)} disabled={workingId === rule.id}><Trash2 size={15} /></button></>}</div></td></tr>)}{!rules.length && <tr><td colSpan={6} className="automation-empty">Nenhuma automação cadastrada.</td></tr>}</tbody>
        </table></div>
      </div>}

      {tab === 'runs' && <div className="card automation-panel"><div className="automation-panel-head"><div><h2>Histórico de execuções</h2><p>Resultados e falhas das automações.</p></div><History size={20} /></div>
        <div className="automation-table-wrap"><table><thead><tr><th>Data</th><th>Evento</th><th>Status</th><th>Duração</th><th>Erro</th></tr></thead>
          <tbody>{runs.map(run => <tr key={run.id}><td>{new Date(run.started_at).toLocaleString('pt-BR')}</td><td>{triggerLabels[run.event_type] || run.event_type}</td><td><span className={'run-status ' + run.status.toLowerCase()}>{run.status}</span></td><td>{run.duration_ms ? run.duration_ms + ' ms' : '—'}</td><td>{run.error_message || '—'}</td></tr>)}{!runs.length && <tr><td colSpan={5} className="automation-empty">Nenhuma execução registrada.</td></tr>}</tbody>
        </table></div>
      </div>}

      {tab === 'alerts' && <div className="card automation-panel"><div className="automation-panel-head"><div><h2>Alertas operacionais</h2><p>Eventos registrados pelas automações da loja.</p></div><TriangleAlert size={20} /></div>
        <div className="automation-alert-list">{events.filter(event => ['ALERT', 'NOTIFICATION', 'INTERVENTION'].includes(event.event_type)).map(event => <div key={event.id}><div><strong>{String(event.payload.title || event.event_type)}</strong><span>{String(event.payload.message || 'Evento registrado')}</span></div><time>{new Date(event.created_at).toLocaleString('pt-BR')}</time></div>)}{!events.filter(event => ['ALERT', 'NOTIFICATION', 'INTERVENTION'].includes(event.event_type)).length && <div className="automation-empty">Nenhum alerta registrado.</div>}</div>
      </div>}

      {tab === 'settings' && <div className="automation-settings-grid"><div className="card automation-panel"><div className="automation-panel-head"><div><h2>Configurações do módulo</h2><p>Princípios aplicados à operação das automações.</p></div><Settings2 size={20} /></div>
        <div className="automation-setting-row"><span>Execução crítica no navegador</span><strong>Desativada</strong></div><div className="automation-setting-row"><span>Ações destrutivas automáticas</span><strong>Bloqueadas</strong></div><div className="automation-setting-row"><span>Isolamento por loja</span><strong>Obrigatório</strong></div>
      </div><div className="card automation-panel"><div className="automation-panel-head"><div><h2>Modelos disponíveis</h2><p>{AUTOMATION_PRESETS.length} modelos iniciais.</p></div><FileText size={20} /></div>
        <div className="automation-preset-list">{AUTOMATION_PRESETS.map(p => <div key={p.name}><strong>{p.name}</strong><span>{categoryLabels[p.category]}</span></div>)}</div>
      </div></div>}

      {builderOpen && <AutomationBuilder initial={editing} onClose={() => { setBuilderOpen(false); setEditing(null); }} onSave={saveRule} />}
    </div>
  );
};
