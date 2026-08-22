import React, { useEffect, useRef } from 'react';
import { Chart, DoughnutController, ArcElement, Tooltip, Legend } from 'chart.js';
import { useTheme } from '../../contexts/ThemeContext';

Chart.register(DoughnutController, ArcElement, Tooltip, Legend);

export interface TopProductsChartProps {
  labels: string[];
  data: number[];
}

export const TopProductsChart: React.FC<TopProductsChartProps> = ({ labels, data }) => {
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
        labels: labels.length ? labels : ['Vestuário', 'Acessórios', 'Moda Praia', 'Outros'],
        datasets: [
          {
            data: data.length ? data : [0, 0, 0, 0],
            backgroundColor: ['#2563eb', '#10b981', '#64748b', '#94a3b8'],
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
  }, [theme]);

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '280px', overflow: 'hidden' }}>
      <div style={{ marginBottom: '8px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>Distribuição por Categoria</h3>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Proporção de volume vendido</p>
      </div>
      <div style={{ position: 'relative', height: '195px', width: '100%', minHeight: '195px', maxHeight: '195px' }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  );
};
