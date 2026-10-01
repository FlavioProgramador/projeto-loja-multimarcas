import { act, renderHook } from '@testing-library/react';
import { useStoreSelection } from './useStoreSelection';
import type { UserStoreAccess } from '../types';

const stores: UserStoreAccess[] = [
  { store_id: 'store-a', role: 'ADMIN', store_name: 'Loja A' },
  { store_id: 'store-b', role: 'MANAGER', store_name: 'Loja B' },
];

describe('useStoreSelection', () => {
  it('mantém o setter estável quando a lista de lojas recebe uma nova referência', () => {
    const { result, rerender } = renderHook(
      ({ remoteStores }) => useStoreSelection({
        isAuthorized: true,
        isSupabaseConfigured: true,
        remoteStores,
      }),
      { initialProps: { remoteStores: stores } }
    );

    const initialSetter = result.current.setActiveStoreId;

    act(() => {
      result.current.setActiveStoreId('store-b');
    });

    expect(result.current.activeStoreId).toBe('store-b');

    rerender({
      remoteStores: stores.map(store => ({ ...store })),
    });

    expect(result.current.setActiveStoreId).toBe(initialSetter);
    expect(result.current.activeStoreId).toBe('store-b');
  });

  it('ignora uma loja inválida sem alterar a seleção atual', () => {
    const { result } = renderHook(() => useStoreSelection({
      isAuthorized: true,
      isSupabaseConfigured: true,
      remoteStores: stores,
    }));

    act(() => {
      result.current.setActiveStoreId('store-b');
      result.current.setActiveStoreId('store-inexistente');
    });

    expect(result.current.activeStoreId).toBe('store-b');
  });
});
