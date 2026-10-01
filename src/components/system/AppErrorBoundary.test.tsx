import React from 'react';
import { render, screen } from '@testing-library/react';
import { AppErrorBoundary } from './AppErrorBoundary';

const Broken: React.FC = () => {
  throw new Error('falha de teste');
};

describe('AppErrorBoundary', () => {
  it('exibe fallback e emite evento de observabilidade', () => {
    const listener = vi.fn();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    window.addEventListener('coresys:frontend-error', listener);

    render(
      <AppErrorBoundary>
        <Broken />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole('heading', { name: 'Não foi possível exibir esta tela.' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Recarregar aplicação' })).toBeTruthy();
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener('coresys:frontend-error', listener);
    consoleSpy.mockRestore();
  });
});
