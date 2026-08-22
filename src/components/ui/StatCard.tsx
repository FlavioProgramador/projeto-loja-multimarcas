import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  iconBg?: string;
  iconColor?: string;
  delta?: string;
  deltaType?: 'positive' | 'negative' | 'neutral';
  deltaLabel?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  icon,
  iconBg = 'var(--primary-light)',
  iconColor = 'var(--primary)',
  delta,
  deltaType = 'positive',
  deltaLabel = 'vs. período anterior',
}) => {
  return (
    <div className="card">
      <div className="card-header-row">
        <span className="card-label">{label}</span>
        <div className="card-icon-box" style={{ backgroundColor: iconBg, color: iconColor }}>
          {icon}
        </div>
      </div>
      <div className="card-value tabular-nums">{value}</div>
      {delta && (
        <div className="card-delta">
          <span className={`delta-badge ${deltaType}`}>
            {deltaType === 'positive' && '↑ '}
            {deltaType === 'negative' && '↓ '}
            {delta}
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>{deltaLabel}</span>
        </div>
      )}
    </div>
  );
};
