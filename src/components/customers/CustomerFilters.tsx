import React from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';

interface CustomerFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  status: 'all' | 'with-credit' | 'without-credit';
  onStatusChange: (value: 'all' | 'with-credit' | 'without-credit') => void;
  sort: 'name' | 'spending' | 'purchases' | 'recent';
  onSortChange: (value: 'name' | 'spending' | 'purchases' | 'recent') => void;
  resultCount: number;
  totalCount: number;
}

export const CustomerFilters: React.FC<CustomerFiltersProps> = ({
  search, onSearchChange, status, onStatusChange, sort, onSortChange, resultCount, totalCount,
}) => (
  <div className="customers-toolbar">
    <div className="customer-search-field">
      <Search size={16} />
      <input aria-label="Buscar clientes" value={search} onChange={event => onSearchChange(event.target.value)}
        placeholder="Buscar por nome, CPF, telefone ou e-mail..." />
      {search && <button className="customer-search-clear" onClick={() => onSearchChange('')} aria-label="Limpar busca"><X size={15} /></button>}
    </div>
    <div className="customers-filter-group">
      <label>
        <SlidersHorizontal size={14} />
        <select value={status} onChange={event => onStatusChange(event.target.value as CustomerFiltersProps['status'])}>
          <option value="all">Todos os clientes</option>
          <option value="with-credit">Com crédito</option>
          <option value="without-credit">Sem crédito</option>
        </select>
      </label>
      <label>
        <select value={sort} onChange={event => onSortChange(event.target.value as CustomerFiltersProps['sort'])}>
          <option value="name">Ordenar por nome</option>
          <option value="spending">Maior valor gasto</option>
          <option value="purchases">Mais compras</option>
          <option value="recent">Compra mais recente</option>
        </select>
      </label>
    </div>
    <span className="customers-result-count">{resultCount} de {totalCount} clientes</span>
  </div>
);