import React from 'react';

interface AppErrorBoundaryProps {
  children?: React.ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Erro não tratado no frontend', error, info.componentStack);
    window.dispatchEvent(new CustomEvent('coresys:frontend-error', {
      detail: {
        name: error.name,
        message: error.message,
        componentStack: info.componentStack,
      },
    }));
  }

  private retry = () => {
    this.setState({ hasError: false });
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="auth-boot" role="alert">
        <div className="auth-card" style={{ maxWidth: 520 }}>
          <div className="auth-card-kicker">Falha inesperada</div>
          <h2>Não foi possível exibir esta tela.</h2>
          <p className="auth-lead">
            A falha foi registrada no navegador. Tente recarregar a aplicação; se continuar,
            informe o suporte com o horário e a ação que estava executando.
          </p>
          <button type="button" className="auth-submit" onClick={this.retry}>
            Recarregar aplicação
          </button>
        </div>
      </main>
    );
  }
}
