import React, { useEffect, useRef } from 'react';
import { Chart, DoughnutController, ArcElement, Tooltip, Legend } from 'chart.js';
import { useTheme } from '../../contexts/ThemeContext';
import { resolveCssColor } from '../../lib/utils';

Chart.register(DoughnutController, ArcElement, Tooltip, Legend);

export interface TopProductsChartProps {
  labels: string[];
  data: number[];
  title?: string;
  subtitle?: string;
  colors?: string[];
}

const DEFAULT_COLORS = [
  '#73E6CB',
  '#3EBB9E',
  '#7CC7B5',
  '#D8A85E',
  '#7EB6E6',
  '#D98282',
  '#A99BE8'
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

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const isDark = theme === 'dark';
    const textColor = resolveCssColor('var(--text-secondary)', isDark ? '#c1d1cb' : '#52525b');
    const surfaceColor = resolveCssColor('var(--bg-surface)', isDark ? '#0d211b' : '#ffffff');
    const tooltipSurfaceColor = resolveCssColor('var(--bg-surface-subtle)', isDark ? '#123028' : '#eef5f2');
    const primaryTextColor = resolveCssColor('var(--text-primary)', isDark ? '#f2f8f5' : '#18181b');
    const borderColor = resolveCssColor('var(--border-color)', isDark ? '#25463d' : '#d7e3df');

    chartInstance.current = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels.length ? labels : ['Sem dados'],
        datasets: [
          {
            data: data.length ? data : [1],
            backgroundColor: (data.length ? data : [1]).map((_, i) => colors[i % colors.length]),
            borderWidth: 2,
            borderColor: surfaceColor
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
            backgroundColor: tooltipSurfaceColor,
            titleColor: primaryTextColor,
            bodyColor: textColor,
            borderColor,
            borderWidth: 1,
            padding: 8,
            cornerRadius: 6
          }
        }
      }
    });

    return () => {
      chartInstance.current?.destroy();
      chartInstance.current = null;
    };
  }, [theme, colors, labels, data]);

  useEffect(() => {
    const chart = chartInstance.current;
    if (!chart) return;

    const nextData = data.length ? data : [1];
    chart.data.labels = labels.length ? labels : ['Sem dados'];
    chart.data.datasets[0].data = nextData;
    chart.data.datasets[0].backgroundColor = nextData.map((_, i) => colors[i % colors.length]);
    chart.update('none');
  }, [labels, data, colors]);

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
