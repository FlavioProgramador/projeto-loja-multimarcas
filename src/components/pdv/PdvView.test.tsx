import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { PdvView } from './PdvView';
import { CartProvider } from '../../contexts/CartContext';
import * as StoreContextModule from '../../contexts/StoreContext';
import type { Product } from '../../types';

// Mock do window.print
window.print = vi.fn();

const mockProducts: Product[] = [
  {
    id: 1,
    uuid: 'prod-1',
    nome: 'Camiseta Básica',
    marca: 'Marca A',
    categoria: 'Roupas',
    preco: 50.0,
    custo: 20.0,
    skus: [
      { id: 'sku-1', tamanho: 'M', cor: 'Preto', qtd: 10 }
    ]
  }
];

const mockProcessSale = vi.fn().mockResolvedValue({
  success: true,
  saleId: 'sale-123',
  totalFinal: 50.0
});

const defaultStoreContextValue: any = {
  products: mockProducts,
  transactions: [],
  movements: [],
  customers: [],
  returns: [],
  suppliers: [],
  fixedExpenses: [],
  notifications: [],
  isLoading: false,
  userStores: [],
  activeStoreId: 'store-1',
  activeStoreRole: 'OPERADOR',
  setActiveStoreId: vi.fn(),
  addProduct: vi.fn(),
  updateProduct: vi.fn(),
  deleteProduct: vi.fn(),
  registerStockEntry: vi.fn(),
  processSale: mockProcessSale,
  processReturn: vi.fn(),
  toggleExpensePaid: vi.fn(),
  addCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  deleteCustomer: vi.fn(),
  addSupplier: vi.fn(),
  updateSupplier: vi.fn(),
  deleteSupplier: vi.fn(),
  checkAlerts: vi.fn(),
  refreshData: vi.fn()
};

const renderPdv = (storeContextOverride: any = {}) => {
  const storeContextValue = {
    ...defaultStoreContextValue,
    ...storeContextOverride
  };

  vi.spyOn(StoreContextModule, 'useStore').mockReturnValue(storeContextValue);

  return render(
    <CartProvider>
      <PdvView />
    </CartProvider>
  );
};

describe('PdvView - Atalhos e fluxo de venda', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve renderizar o catálogo de produtos do PDV', () => {
    renderPdv();
    expect(screen.getByText('Camiseta Básica')).toBeDefined();
    expect(screen.getByText('Marca A')).toBeDefined();
  });

  it('deve abrir o modal de checkout com F4 quando houver itens no carrinho', async () => {
    renderPdv();

    // Adiciona o produto ao carrinho
    const addButton = screen.getByRole('button', { name: /Adicionar/i });
    fireEvent.click(addButton);

    expect(screen.getByText('1 itens')).toBeDefined();

    // Pressiona F4
    fireEvent.keyDown(window, { key: 'F4' });

    await waitFor(() => {
      expect(screen.getByText('Confirmar Venda')).toBeDefined();
    });
  });

  it('não deve finalizar vendas duplicadas com múltiplos pressionamentos de F4', async () => {
    let processResolve: (value: any) => void;
    const slowProcessSale = vi.fn().mockImplementation(() => new Promise((resolve) => {
      processResolve = resolve;
    }));

    renderPdv({ processSale: slowProcessSale });

    // Adiciona produto
    fireEvent.click(screen.getByRole('button', { name: /Adicionar/i }));

    // Seleciona pagamento em Dinheiro
    const paymentSelect = screen.getByDisplayValue('PIX');
    fireEvent.change(paymentSelect, { target: { value: 'Dinheiro' } });

    // Abre modal de checkout com F4
    fireEvent.keyDown(window, { key: 'F4' });

    await waitFor(() => {
      expect(screen.getByText('Confirmar Venda')).toBeDefined();
    });

    // Submete a primeira vez com F4
    fireEvent.keyDown(window, { key: 'F4' });

    // Tenta submeter novamente enquanto processa
    fireEvent.keyDown(window, { key: 'F4' });
    fireEvent.keyDown(window, { key: 'F4' });

    expect(slowProcessSale).toHaveBeenCalledTimes(1);

    // Resolve o envio pendente dentro de act
    await act(async () => {
      processResolve!({ success: true, saleId: 'sale-1', totalFinal: 50.0 });
    });
  });
});
