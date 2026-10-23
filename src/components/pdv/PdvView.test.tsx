import React from 'react';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PdvView } from './PdvView';
import { AuthProvider } from '../../contexts/AuthContext';
import { StoreProvider } from '../../contexts/StoreContext';
import { CartProvider } from '../../contexts/CartContext';
import { vi } from 'vitest';

vi.mock('../../lib/supabase/client', () => ({
  isSupabaseConfigured: false,
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    channel: () => ({
      on: () => ({ subscribe: () => {} }),
    }),
    removeChannel: () => {},
  },
}));

const renderWithProviders = (ui: React.ReactElement) => {
  return render(
    <AuthProvider>
      <StoreProvider>
        <CartProvider>{ui}</CartProvider>
      </StoreProvider>
    </AuthProvider>
  );
};

describe('PdvView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renderiza o PDV com a barra de busca e a tabela de produtos', () => {
    renderWithProviders(<PdvView />);

    expect(screen.getByPlaceholderText(/Procurar por código, nome ou marca/i)).toBeInTheDocument();
    expect(screen.getByText('Carrinho')).toBeInTheDocument();
    expect(screen.getByText('0 itens')).toBeInTheDocument();
  });

  it('filtra produtos com base no termo digitado', () => {
    renderWithProviders(<PdvView />);

    const searchInput = screen.getByPlaceholderText(/Procurar por código, nome ou marca/i);
    fireEvent.change(searchInput, { target: { value: 'Camiseta' } });

    expect(searchInput).toHaveValue('Camiseta');
  });

  it('permite focar no campo de busca usando a tecla F2', () => {
    renderWithProviders(<PdvView />);

    const searchInput = screen.getByPlaceholderText(/Procurar por código, nome ou marca/i);
    expect(document.activeElement).not.toBe(searchInput);

    fireEvent.keyDown(window, { key: 'F2' });
    expect(document.activeElement).toBe(searchInput);
  });

  it('exibe o aviso de carrinho vazio ao tentar finalizar venda com F4', () => {
    renderWithProviders(<PdvView />);

    fireEvent.keyDown(window, { key: 'F4' });

    expect(screen.getByText(/Carrinho vazio. Pressione F2 para procurar produtos/i)).toBeInTheDocument();
  });
});
