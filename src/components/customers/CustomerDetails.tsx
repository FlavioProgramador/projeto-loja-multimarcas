import React from 'react';
import { CalendarDays, CreditCard, Mail, MapPin, Phone, ShoppingBag, UserRound } from 'lucide-react';
import type { Customer } from '../../types';
import { formatMoeda, formatCpf } from '../../lib/utils';
import { Modal } from '../ui/Modal';

interface CustomerDetailsProps {
  customer: Customer | null;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onEdit: (customer: Customer) => void;
}

const dateLabel = (value?: string) =>
  value ? new Date(`${value}T00:00:00`).toLocaleDateString('pt-BR') : 'Não informado';

const initials = (name: string) =>
  name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'CL';

export const CustomerDetails: React.FC<CustomerDetailsProps> = ({
  customer, loading = false, error, onClose, onEdit,
}) => {
  if (!customer) return null;

  const total = customer.totalGasto
    ?? customer.historico.reduce((sum, item) => sum + item.valor, 0);
  const history = [...customer.historico].sort((a, b) => b.data.localeCompare(a.data));
  const purchaseCount = customer.totalCompras ?? history.length;
  const lastPurchase = customer.ultimaCompra || history[0]?.data;
  const movements = customer.movimentacoesCredito || [];
  const credit = customer.saldoCredito || 0;

  return (
    <Modal isOpen={true} onClose={onClose} maxWidth="820px" title={<><UserRound size={18} /> Perfil do cliente</>}>
      <div className="customer-details">
        <header className="customer-profile-head">
          <div className="customer-profile-avatar">{initials(customer.nome)}</div>
          <div className="customer-profile-identity">
            <h2>{customer.nome}</h2>
            <span>{customer.cpf ? `CPF ${formatCpf(customer.cpf)}` : 'CPF não informado'}</span>
          </div>
          <button className="btn btn-sm" onClick={() => onEdit(customer)}>Editar cadastro</button>
        </header>

        <div className="customer-detail-stats">
          <div><small>Total gasto</small><strong>{formatMoeda(total)}</strong></div>
          <div><small>Compras</small><strong>{purchaseCount}</strong></div>
          <div><small>Crédito disponível</small><strong>{formatMoeda(credit)}</strong></div>
          <div><small>Última compra</small><strong>{lastPurchase ? dateLabel(lastPurchase) : 'Nunca'}</strong></div>
        </div>

        <div className="customer-detail-grid">
          <section className="customer-detail-panel">
            <h3><UserRound size={15} /> Dados pessoais</h3>
            <div className="customer-info-list">
              <div><span>CPF</span><strong>{customer.cpf ? formatCpf(customer.cpf) : 'Não informado'}</strong></div>
              <div><span>RG</span><strong>{customer.rg || 'Não informado'}</strong></div>
              <div><span>Data de nascimento</span><strong><CalendarDays size={14}/> {dateLabel(customer.dataNascimento)}</strong></div>
            </div>
          </section>

          <section className="customer-detail-panel">
            <h3><Phone size={15}/> Contato</h3>
            <div className="customer-info-list">
              <div><span>Telefone</span><strong><Phone size={14}/> {customer.telefone || 'Não informado'}</strong></div>
              <div><span>E-mail</span><strong><Mail size={14}/> {customer.email || 'Não informado'}</strong></div>
              <div><span>Endereço</span><strong><MapPin size={14}/> {customer.endereco || 'Não informado'}</strong></div>
            </div>
          </section>
        </div>

        {loading && <p className="customer-history-empty">Carregando histórico completo...</p>}
        {error && <p className="customer-history-empty">{error}</p>}

        {!loading && !error && <>
          <section className="customer-history-section">
            <h3><ShoppingBag size={15}/> Histórico de compras <span>{history.length}</span></h3>
            {history.length === 0 ? (
              <p className="customer-history-empty">Nenhuma compra registrada.</p>
            ) : (
              <div className="customer-history-list">
                {history.map((item, index) => (
                  <article key={`${item.vendaId}-${item.data}-${index}`}>
                    <div><strong>{item.vendaId || 'Venda'}</strong><span>{dateLabel(item.data)}</span></div>
                    <strong>{formatMoeda(item.valor)}</strong>
                    <small>{item.itens || 'Itens não informados'}</small>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="customer-history-section">
            <h3><CreditCard size={15}/> Créditos e vales <span>{movements.length}</span></h3>
            {movements.length === 0 ? (
              <p className="customer-history-empty">Nenhuma movimentação de crédito registrada.</p>
            ) : (
              <div className="customer-history-list customer-credit-history">
                {movements.map((movement, index) => (
                  <article key={movement.id || index}>
                    <div>
                      <strong>{movement.descricao || 'Movimentação de crédito'}</strong>
                      <span>{dateLabel(movement.data)}</span>
                    </div>
                    <strong className={movement.tipo === 'entrada' ? 'credit-in' : 'credit-out'}>
                      {movement.tipo === 'entrada' ? '+' : '-'} {formatMoeda(movement.valor)}
                    </strong>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>}
      </div>
    </Modal>
  );
};
