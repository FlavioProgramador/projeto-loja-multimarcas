import React from 'react';

interface StatusBadgeProps {
  status: 'Normal' | 'Baixo Estoque' | 'Esgotado' | 'Pago' | 'Pendente' | 'Cancelado' | string;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className = '' }) => {
  let statusClass = 'neutral';
  
  if (status === 'Normal' || status === 'Pago' || status === 'Concluído' || status === 'Ativo') {
    statusClass = 'success';
  } else if (status === 'Baixo Estoque' || status === 'Pendente' || status === 'Atenção') {
    statusClass = 'warning';
  } else if (status === 'Esgotado' || status === 'Cancelado' || status === 'Vencido' || status === 'Inativo') {
    statusClass = 'danger';
  }

  return (
    <span className={`badge-status ${statusClass} ${className}`}>
      {status}
    </span>
  );
};
