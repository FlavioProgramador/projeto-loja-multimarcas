import React from 'react';
import { Eye, Pencil, Trash2, UserRound } from 'lucide-react';
import type { Customer } from '../../types';
import { formatMoeda, formatCpf } from '../../lib/utils';

interface CustomerListProps {
  customers: Customer[];
  onView: (customer: Customer) => void;
  onEdit: (customer: Customer) => void;
  onDelete: (customer: Customer) => void;
}

const getInitials = (name: string) =>
  name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'CL';

export const CustomerList: React.FC<CustomerListProps> = ({
  customers, onView, onEdit, onDelete,
}) => (
  <div className="customers-table">
    <table>
      <thead>
        <tr>
          <th>Cliente</th>
          <th>Contato</th>
          <th>Compras</th>
          <th>Última compra</th>
          <th>Crédito</th>
          <th style={{ textAlign: 'right' }}>Total gasto</th>
          <th style={{ textAlign: 'center' }}>Ações</th>
        </tr>
      </thead>
      <tbody>
        {customers.map(customer => {
          const total = customer.totalGasto
            ?? customer.historico.reduce((sum, item) => sum + item.valor, 0);
          const purchaseCount = customer.totalCompras ?? customer.historico.length;
          const lastPurchaseDate = customer.ultimaCompra
            || [...customer.historico].sort((a, b) => b.data.localeCompare(a.data))[0]?.data;
          const credit = customer.saldoCredito || 0;
          return (
            <tr key={customer.uuid || customer.id} className="clickable-row" onClick={() => onView(customer)}>
              <td>
                <div className="customer-primary">
                  <span className="customer-avatar">{getInitials(customer.nome)}</span>
                  <span>
                    <strong>{customer.nome}</strong>
                    <small>{customer.cpf ? formatCpf(customer.cpf) : 'CPF não informado'}</small>
                  </span>
                </div>
              </td>
              <td>
                <div className="customer-contact">
                  <span>{customer.telefone || 'Telefone não informado'}</span>
                  <small>{customer.email || 'E-mail não informado'}</small>
                </div>
              </td>
              <td><span className="customer-metric-badge">{purchaseCount}</span></td>
              <td>{lastPurchaseDate ? new Date(`${lastPurchaseDate}T00:00:00`).toLocaleDateString('pt-BR') : 'Nunca'}</td>
              <td>
                <span className={`customer-credit-pill ${credit > 0 ? 'has-credit' : ''}`}>{formatMoeda(credit)}</span>
              </td>
              <td style={{ textAlign: 'right' }}><strong>{formatMoeda(total)}</strong></td>
              <td>
                <div className="customer-row-actions">
                  <button className="icon-action" title="Visualizar cliente" aria-label="Visualizar cliente"
                    onClick={event => { event.stopPropagation(); onView(customer); }}><Eye size={15} /></button>
                  <button className="icon-action" title="Editar cliente" aria-label="Editar cliente"
                    onClick={event => { event.stopPropagation(); onEdit(customer); }}><Pencil size={15} /></button>
                  <button className="icon-action danger" title="Arquivar cliente" aria-label="Arquivar cliente"
                    onClick={event => { event.stopPropagation(); onDelete(customer); }}><Trash2 size={15} /></button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    {!customers.length && (
      <div className="customers-empty">
        <UserRound size={28} />
        <strong>Nenhum cliente encontrado</strong>
        <span>Ajuste os filtros ou cadastre um novo cliente.</span>
      </div>
    )}
  </div>
);
