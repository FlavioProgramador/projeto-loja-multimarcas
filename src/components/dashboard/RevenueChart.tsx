import React, { useEffect, useRef } from 'react';
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';
import { useTheme } from '../../contexts/ThemeContext';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

export interface RevenueChartProps {
  labels: string[];
  data: number[];
  delta?: string;
  title?: string;
  subtitle?: string;
}

export const RevenueChart: React.FC<RevenueChartProps> = ({
  labels,
  data,
  delta = "+0.0%",
  title = "Faturamento Diário",
  subtitle = "Desempenho no período selecionado"
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
    const textColor = isDark ? 'var(--text-muted)' : 'var(--text-muted)';
    const gridColor = isDark ? 'rgba(115,230,203,0.09)' : 'rgba(10,60,48,0.07)';

    chartInstance.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels.length ? labels : ['Sem dados'],
        datasets: [
          {
            label: 'Faturamento',
            data: data.length ? data : [0],
            backgroundColor: 'var(--brand-primary)',
            hoverBackgroundColor: 'var(--brand-primary)',
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: isDark ? 'var(--bg-surface-subtle)' : '#ffffff',
            titleColor: isDark ? '#ffffff' : 'var(--text-primary)',
            bodyColor: 'var(--brand-primary)',
            borderColor: isDark ? 'var(--border-color)' : 'var(--border-color)',
            borderWidth: 1,
            padding: 8,
            cornerRadius: 6,
            callbacks: {
              label: (context) => ` R$ ${(context.raw as number).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
            }
          }
        },
        scales: {
          x: {
            grid: {
              display: false
            },
            ticks: {
              color: textColor,
              font: { size: 11, family: 'Inter' }
            }
          },
          y: {
            beginAtZero: true,
            grid: {
              color: gridColor
            },
            ticks: {
              color: textColor,
              font: { size: 10, family: 'Inter' },
              callback: (value) => `R$ ${value}`
            }
          }
        }
      }
    });

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
      }
    };
  }, [theme, labels, data]);

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '280px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</h3>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{subtitle}</p>
        </div>
        <span className={`delta-badge ${delta.startsWith('+') ? 'positive' : 'negative'}`}>{delta}</span>
      </div>
      <div style={{ position: 'relative', height: '195px', width: '100%', minHeight: '195px', maxHeight: '195px' }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  );
};
