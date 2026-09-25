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
  '#00674f',
  '#3ebb9e',
  '#73E6CB',
  '#0a3c30',
  '#8ab8ac',
  '#5f8f83',
  '#bfeee1',
  '#71817c',
  '#45534f',
  '#d7e3df'
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
    const textColor = 'var(--text-secondary)';

    chartInstance.current = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels.length ? labels : ['Sem dados'],
        datasets: [
          {
            data: data.length ? data : [1],
            backgroundColor: colors.slice(0, Math.max(labels.length, 1)),
            borderWidth: 2,
            borderColor: isDark ? 'var(--bg-surface)' : '#ffffff'
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
            backgroundColor: isDark ? 'var(--bg-surface-subtle)' : '#ffffff',
            titleColor: isDark ? 'var(--text-primary)' : 'var(--text-primary)',
            bodyColor: 'var(--text-secondary)',
            borderColor: 'var(--border-color)',
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

