import React, { useEffect, useRef } from 'react';
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';
import { useTheme } from '../../contexts/ThemeContext';
import { resolveCssColor } from '../../lib/utils';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

export interface RevenueChartProps {
  labels: string[];
  data: number[];
  delta?: string;
  title?: string;
  subtitle?: string;
  color?: string;
}

export const RevenueChart: React.FC<RevenueChartProps> = ({
  labels,
  data,
  delta = "+0.0%",
  title = "Faturamento Diário",
  subtitle = "Desempenho no período selecionado",
  color = "var(--brand-primary)"
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstance = useRef<Chart | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!canvasRef.current) return;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const isDark = theme === 'dark';
    const textColor = resolveCssColor('var(--text-secondary)', isDark ? '#c1d1cb' : '#52525b');
    const mutedColor = resolveCssColor('var(--text-muted)', isDark ? '#9eb1aa' : '#71717a');
    const surfaceColor = resolveCssColor('var(--bg-surface-subtle)', isDark ? '#123028' : '#eef5f2');
    const borderColor = resolveCssColor('var(--border-color)', isDark ? '#25463d' : '#d7e3df');
    const primaryColor = resolveCssColor('var(--brand-primary)', isDark ? '#00A887' : '#00674f');
    const gridColor = isDark ? 'rgba(115,230,203,0.14)' : 'rgba(10,60,48,0.12)';

    chartInstance.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels.length ? labels : ['Sem dados'],
        datasets: [
          {
            label: 'Faturamento',
            data: data.length ? data : [0],
            backgroundColor: color || primaryColor,
            hoverBackgroundColor: color || primaryColor,
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
            backgroundColor: surfaceColor,
            titleColor: resolveCssColor('var(--text-primary)', isDark ? '#f2f8f5' : '#18181b'),
            bodyColor: primaryColor,
            borderColor,
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
              color: mutedColor,
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
      chartInstance.current?.destroy();
      chartInstance.current = null;
    };
  }, [theme, color]);

  useEffect(() => {
    const chart = chartInstance.current;
    if (!chart) return;

    chart.data.labels = labels.length ? labels : ['Sem dados'];
    chart.data.datasets[0].data = data.length ? data : [0];
    chart.data.datasets[0].backgroundColor = color;
    chart.data.datasets[0].hoverBackgroundColor = color;
    chart.update('none');
  }, [labels, data, color]);

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
