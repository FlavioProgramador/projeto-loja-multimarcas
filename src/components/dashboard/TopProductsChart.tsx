import React, { useEffect, useRef } from 'react';
import { Chart, DoughnutController, ArcElement, Tooltip, Legend } from 'chart.js';
import { useTheme } from '../../contexts/ThemeContext';

Chart.register(DoughnutController, ArcElement, Tooltip, Legend);

export interface TopProductsChartProps {
  labels: string[];
  data: number[];
  title?: string;
  subtitle?: string;
  colors?: string[];
}

const DEFAULT_COLORS = [
  '#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#64748b', '#84cc16', '#f97316'
];

export const TopProductsChart: React.FC<TopProductsChartProps> = ({
  labels,
  data,
  title = 'Distribuição por Categoria',
  subtitle = 'Proporção de volume vendido',
  colors = DEFAULT_COLORS
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstance = useRef<Chart | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!canvasRef.current) return;

    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const isDark = theme === 'dark';
    const textColor = isDark ? '#cbd5e1' : '#434655';

    chartInstance.current = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels.length ? labels : ['Sem dados'],
        datasets: [
          {
            data: data.length ? data : [1],
            backgroundColor: colors.slice(0, Math.max(labels.length, 1)),
            borderWidth: 2,
            borderColor: isDark ? '#151e32' : '#ffffff'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: {
            display: true,
            position: 'right',
            labels: {
              boxWidth: 10,
              boxHeight: 10,
              useBorderRadius: true,
              borderRadius: 3,
              font: { size: 11, family: 'Inter' },
              color: textColor,
              padding: 10
            }
          },
          tooltip: {
            backgroundColor: isDark ? '#1e293b' : '#ffffff',
            titleColor: isDark ? '#ffffff' : '#111c2d',
            bodyColor: isDark ? '#cbd5e1' : '#434655',
            borderColor: isDark ? '#334155' : '#e2e8f0',
            borderWidth: 1,
            padding: 8,
            cornerRadius: 6
          }
        }
      }
    });

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
      }
    };
  }, [theme, labels, data, colors]);

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '280px', overflow: 'hidden' }}>
      <div style={{ marginBottom: '8px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</h3>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{subtitle}</p>
      </div>
      <div style={{ position: 'relative', height: '195px', width: '100%', minHeight: '195px', maxHeight: '195px' }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  );
};

