import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight,
  ClipboardList, Clock3, Filter, Inbox, Package, RefreshCw,
  Search, SlidersHorizontal, UserRound, X,
} from 'lucide-react';
import { useStore } from '../../contexts/StoreContext';
import { MovementsService, MovementRecord } from '../../services/movements/movements.service';
import { Modal } from '../ui/Modal';
import './movements.css';

type PeriodFilter = 'today' | '7d' | '30d' | 'all';
type TypeFilter = 'ALL' | MovementRecord['type'];
const PAGE_SIZE = 15;

const TYPE_LABELS: Record<MovementRecord['type'], string> = {
  ENTRY: 'Entrada', SALE: 'Venda', RETURN: 'Devolução', ADJUSTMENT: 'Ajuste',
  LOSS: 'Perda', TRANSFER_IN: 'Transferência recebida', TRANSFER_OUT: 'Transferência enviada',
  INITIAL: 'Estoque inicial', CORRECTION: 'Correção', CANCELLATION: 'Cancelamento',
};

const IN_TYPES = new Set<MovementRecord['type']>(['ENTRY', 'RETURN', 'TRANSFER_IN', 'INITIAL']);
const OUT_TYPES = new Set<MovementRecord['type']>(['SALE', 'LOSS', 'TRANSFER_OUT']);

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('pt-BR').format(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function periodStart(period: PeriodFilter) {
  const start = new Date();
  if (period === 'all') return null;
  if (period === 'today') {
    start.setHours(0, 0, 0, 0);
    return start;
  }
  start.setDate(start.getDate() - (period === '7d' ? 6 : 29));
  start.setHours(0, 0, 0, 0);
  return start;
}

function movementDirection(movement: MovementRecord) {
  if (IN_TYPES.has(movement.type)) return 'in';
  if (OUT_TYPES.has(movement.type)) return 'out';
  return movement.quantity_after >= movement.quantity_before ? 'in' : 'out';
}

export const MovementsView: React.FC = () => {
  const { activeStoreId } = useStore();
  const [movements, setMovements] = useState<MovementRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState<PeriodFilter>('30d');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [selectedMovement, setSelectedMovement] = useState<MovementRecord | null>(null);
  const [page, setPage] = useState(1);

  const loadMovements = async () => {
    if (!activeStoreId) {
      setMovements([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const data = await MovementsService.getAll(activeStoreId);
    setMovements(data);
    setIsLoading(false);
  };

  useEffect(() => { void loadMovements(); }, [activeStoreId]);

  const filteredMovements = useMemo(() => {
    const start = periodStart(period);
    const needle = query.trim().toLowerCase();

    return movements.filter((movement) => {
      if (typeFilter !== 'ALL' && movement.type !== typeFilter) return false;
      if (start && new Date(movement.created_at) < start) return false;
      if (!needle) return true;

      const values = [
        movement.product_variant?.products?.name, movement.product_variant?.sku,
        movement.product_variant?.size, movement.product_variant?.color,
        movement.reason, movement.notes, movement.user?.full_name, movement.user?.email,
        movement.sale?.sale_number, movement.sale?.customer_name,
        movement.reference_type, movement.reference_id,
      ];
      return values.some(value => value?.toLowerCase().includes(needle));
    });
  }, [movements, period, query, typeFilter]);

  useEffect(() => { setPage(1); }, [query, period, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredMovements.length / PAGE_SIZE));
  const pageMovements = filteredMovements.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const metrics = useMemo(() => {
    const quantity = filteredMovements.reduce((sum, item) => sum + Math.abs(item.quantity), 0);
    const entries = filteredMovements
      .filter(item => movementDirection(item) === 'in')
      .reduce((sum, item) => sum + Math.abs(item.quantity), 0);
    const exits = filteredMovements
      .filter(item => movementDirection(item) === 'out')
      .reduce((sum, item) => sum + Math.abs(item.quantity), 0);
    const operations = new Set(
      filteredMovements.map(item => String(item.reference_type || 'MOVEMENT') + ':' + String(item.reference_id || item.id)),
    ).size;
    const sales = new Set(
      filteredMovements.filter(item => item.type === 'SALE' && item.reference_id).map(item => item.reference_id),
    ).size;
    return { quantity, entries, exits, operations, sales };
  }, [filteredMovements]);

  const availableTypes = useMemo(
    () => Array.from(new Set(movements.map(item => item.type))).sort(),
    [movements],
  );

  return (
    <div className="movements-page module-fade">
      <header className="movements-hero">
        <div>
          <div className="movements-eyebrow"><ClipboardList size={14} />Central operacional</div>
          <h1 className="page-title">Movimentações</h1>
          <p className="page-subtitle">
            Rastreie entradas, saídas, ajustes e operações vinculadas ao estoque.
          </p>
        </div>
        <button
          className="btn btn-outline movements-refresh"
          type="button"
          onClick={() => void loadMovements()}
          disabled={isLoading}
        >
          <RefreshCw size={15} className={isLoading ? 'spin' : ''} />Atualizar
        </button>
      </header>

      <section className="movements-kpis" aria-label="Resumo das movimentações">
        <Metric icon={<ClipboardList size={18} />} label="Movimentações"
          value={formatNumber(filteredMovements.length)}
          hint={formatNumber(metrics.operations) + ' operações relacionadas'} />
        <Metric icon={<ArrowDownLeft size={18} />} variant="entry" label="Entradas"
          value={formatNumber(metrics.entries) + ' un.'}
          hint="Recebimentos, retornos e transferências" />
        <Metric icon={<ArrowUpRight size={18} />} variant="out" label="Saídas"
          value={formatNumber(metrics.exits) + ' un.'}
          hint="Vendas, perdas e transferências" />
        <Metric icon={<Package size={18} />} label="Unidades afetadas"
          value={formatNumber(metrics.quantity)}
          hint={formatNumber(metrics.sales) + ' vendas relacionadas'} />
      </section>

      <section className="movements-toolbar">
        <div className="movement-search">
          <Search size={17} />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Buscar produto, SKU, venda, cliente ou responsável..."
            aria-label="Buscar movimentações"
          />
          {query && (
            <button type="button" className="movement-input-clear" onClick={() => setQuery('')} aria-label="Limpar busca">
              <X size={15} />
            </button>
          )}
        </div>

        <div className="movement-filter-group">
          <SlidersHorizontal size={15} />
          <select value={period} onChange={event => setPeriod(event.target.value as PeriodFilter)}>
            <option value="today">Hoje</option>
            <option value="7d">Últimos 7 dias</option>
            <option value="30d">Últimos 30 dias</option>
            <option value="all">Todo o período</option>
          </select>
        </div>

        <div className="movement-filter-group">
          <Filter size={15} />
          <select value={typeFilter} onChange={event => setTypeFilter(event.target.value as TypeFilter)}>
            <option value="ALL">Todos os tipos</option>
            {availableTypes.map(type => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
          </select>
        </div>
      </section>

      <section className="movements-table-card">
        <div className="movements-table-head">
          <div>
            <span className="table-header-title">Linha do tempo do estoque</span>
            <p>Movimentações físicas com contexto de usuário, produto e documento relacionado.</p>
          </div>
          <span className="movement-results">{formatNumber(filteredMovements.length)} resultados</span>
        </div>

        {isLoading ? (
          <MovementTableSkeleton />
        ) : pageMovements.length === 0 ? (
          <div className="movements-empty">
            <div className="movements-empty-icon"><Inbox size={24} /></div>
            <h3>Nenhuma movimentação encontrada</h3>
            <p>Altere os filtros ou período para visualizar outros registros.</p>
            {(query || typeFilter !== 'ALL' || period !== '30d') && (
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setQuery('');
                  setTypeFilter('ALL');
                  setPeriod('30d');
                }}
              >
                Limpar filtros
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="movements-table-wrap">
              <table className="movements-table">
                <thead>
                  <tr>
                    <th>Data / horário</th>
                    <th>Movimento</th>
                    <th>Produto / SKU</th>
                    <th>Quantidade</th>
                    <th>Estoque</th>
                    <th>Responsável</th>
                    <th>Referência</th>
                  </tr>
                </thead>
                <tbody>
                  {pageMovements.map(movement => {
                    const direction = movementDirection(movement);
                    const productName = movement.product_variant?.products?.name || 'Produto não identificado';
                    const variant = [movement.product_variant?.size, movement.product_variant?.color].filter(Boolean).join(' / ');
                    const reference = movement.sale?.sale_number || movement.reference_id;

                    return (
                      <tr
                        key={movement.id}
                        className="movement-row"
                        onClick={() => setSelectedMovement(movement)}
                      >
                        <td>
                          <div className="movement-datetime">
                            <strong>{formatDateTime(movement.created_at).split(', ')[0]}</strong>
                            <span>{formatDateTime(movement.created_at).split(', ')[1]}</span>
                          </div>
                        </td>
                        <td>
                          <div className="movement-type-cell">
                            <span className={'movement-type-icon is-' + direction}>
                              {direction === 'in' ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
                            </span>
                            <div>
                              <strong>{TYPE_LABELS[movement.type]}</strong>
                              {movement.reason && <span>{movement.reason}</span>}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="movement-product-cell">
                            <strong>{productName}</strong>
                            <span>
                              {movement.product_variant?.sku || 'Sem SKU'}
                              {variant ? ' · ' + variant : ''}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className={'movement-quantity is-' + direction}>
                            {direction === 'in' ? '+' : '-'}{formatNumber(Math.abs(movement.quantity))}
                          </span>
                        </td>
                        <td>
                          <div className="movement-stock">
                            <span>{formatNumber(movement.quantity_before)}</span>
                            <span>→</span>
                            <strong>{formatNumber(movement.quantity_after)}</strong>
                          </div>
                        </td>
                        <td>
                          <div className="movement-user-cell">
                            <UserRound size={14} />
                            <span>{movement.user?.full_name || 'Usuário não identificado'}</span>
                          </div>
                        </td>
                        <td>
                          <span className="movement-reference">{reference || '—'}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="movements-pagination">
              <span>
                Exibindo {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, filteredMovements.length)} de {filteredMovements.length}
              </span>
              <div>
                <button
                  type="button"
                  className="movement-page-btn"
                  disabled={page === 1}
                  onClick={() => setPage(value => value - 1)}
                  aria-label="Página anterior"
                >
                  <ChevronLeft size={16} />
                </button>
                <strong>{page} / {totalPages}</strong>
                <button
                  type="button"
                  className="movement-page-btn"
                  disabled={page === totalPages}
                  onClick={() => setPage(value => value + 1)}
                  aria-label="Próxima página"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      <Modal
        isOpen={!!selectedMovement}
        onClose={() => setSelectedMovement(null)}
        title={
          <div className="movement-modal-title">
            <ClipboardList size={18} />
            <span>Detalhes da movimentação</span>
          </div>
        }
        maxWidth="760px"
      >
        {selectedMovement && <MovementDetails movement={selectedMovement} />}
      </Modal>
    </div>
  );
};
const MovementDetails: React.FC<{ movement: MovementRecord }> = ({ movement }) => {
  const direction = movementDirection(movement);
  const productName = movement.product_variant?.products?.name || 'Produto não identificado';

  return (
    <div className="movement-detail">
      <div className="movement-detail-hero">
        <div className={'movement-detail-icon is-' + direction}>
          {direction === 'in' ? <ArrowDownLeft size={21} /> : <ArrowUpRight size={21} />}
        </div>
        <div>
          <span>{TYPE_LABELS[movement.type]}</span>
          <strong>{productName}</strong>
          <small>{formatDateTime(movement.created_at)}</small>
        </div>
      </div>

      <div className="movement-detail-grid">
        <DetailItem label="SKU" value={movement.product_variant?.sku || '—'} />
        <DetailItem
          label="Variação"
          value={[movement.product_variant?.size, movement.product_variant?.color].filter(Boolean).join(' / ') || '—'}
        />
        <DetailItem label="Quantidade" value={(direction === 'in' ? '+' : '-') + formatNumber(Math.abs(movement.quantity)) + ' un.'} />
        <DetailItem label="Estoque antes" value={formatNumber(movement.quantity_before) + ' un.'} />
        <DetailItem label="Estoque depois" value={formatNumber(movement.quantity_after) + ' un.'} />
        <DetailItem label="Responsável" value={movement.user?.full_name || movement.user?.email || '—'} />
        <DetailItem label="Tipo de referência" value={movement.reference_type || 'MOVEMENT'} />
        <DetailItem label="ID da referência" value={movement.reference_id || '—'} mono />
      </div>

      {(movement.reason || movement.notes) && (
        <div className="movement-detail-notes">
          {movement.reason && (
            <div><span>Motivo</span><strong>{movement.reason}</strong></div>
          )}
          {movement.notes && (
            <div><span>Observações</span><p>{movement.notes}</p></div>
          )}
        </div>
      )}

      {movement.sale && (
        <div className="movement-sale-context">
          <div className="movement-sale-context-head">
            <div>
              <span>Operação relacionada</span>
              <strong>Venda {movement.sale.sale_number}</strong>
            </div>
            <span className="movement-sale-total">{formatCurrency(movement.sale.total)}</span>
          </div>

          <div className="movement-detail-grid compact">
            <DetailItem label="Cliente" value={movement.sale.customer_name || 'Consumidor Final'} />
            <DetailItem label="CPF" value={movement.sale.customer_cpf || '—'} />
            <DetailItem label="Subtotal" value={formatCurrency(movement.sale.subtotal)} />
            <DetailItem label="Desconto" value={formatCurrency(movement.sale.discount)} />
          </div>

          <div className="movement-sale-meta">
            <Clock3 size={14} />
            <span>Registrada em {formatDateTime(movement.sale.created_at)}</span>
            {movement.sale.completed_at && <span>· concluída em {formatDateTime(movement.sale.completed_at)}</span>}
          </div>

          {!!movement.sale.payments?.length && (
            <div className="movement-payments">
              <span>Pagamentos</span>
              {movement.sale.payments.map((payment, index) => (
                <div key={payment.method + '-' + index}>
                  <strong>{payment.method}</strong>
                  <span>{formatCurrency(payment.amount)}</span>
                  <small>{payment.installments > 1 ? payment.installments + 'x' : 'À vista'}</small>
                </div>
              ))}
            </div>
          )}

          {!!movement.sale.sale_items?.length && (
            <div className="movement-sale-items">
              <span>Itens da venda</span>
              {movement.sale.sale_items.map((item, index) => (
                <div key={item.product_name + '-' + index}>
                  <div>
                    <strong>{item.product_name}</strong>
                    <small>{item.variant_description || 'Sem variação'}</small>
                  </div>
                  <span>{item.quantity} × {formatCurrency(item.unit_price)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const DetailItem: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="movement-detail-item">
    <span>{label}</span>
    <strong className={mono ? 'mono-text' : undefined}>{value}</strong>
  </div>
);

const Metric: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  variant?: 'entry' | 'out';
}> = ({ icon, label, value, hint, variant }) => (
  <article className="movement-kpi">
    <div className={'movement-kpi-icon' + (variant ? ' is-' + variant : '')}>{icon}</div>
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  </article>
);

const MovementTableSkeleton: React.FC = () => (
  <div className="movement-skeleton">
    {Array.from({ length: 7 }).map((_, index) => (
      <div key={index} className="movement-skeleton-row">
        <span /><span /><span /><span /><span /><span />
      </div>
    ))}
  </div>
);
