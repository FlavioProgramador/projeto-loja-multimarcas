import { useCallback, useEffect, useRef, useState } from 'react';
import type { UserStoreAccess } from '../types';

interface UseStoreSelectionParams {
  isAuthorized: boolean;
  isSupabaseConfigured: boolean;
  remoteStores: UserStoreAccess[];
}

export const useStoreSelection = ({
  isAuthorized,
  isSupabaseConfigured,
  remoteStores,
}: UseStoreSelectionParams) => {
  const [activeStoreId, setActiveStoreIdState] = useState<string | null>(null);
  const validStoreIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    validStoreIdsRef.current = new Set(remoteStores.map(store => store.store_id));
  }, [remoteStores]);

  const setActiveStoreId = useCallback((id: string) => {
    if (!validStoreIdsRef.current.has(id)) return;
    setActiveStoreIdState(current => current === id ? current : id);
  }, []);

  useEffect(() => {
    if (!isAuthorized) {
      setActiveStoreIdState(current => current === null ? current : null);
      return;
    }

    if (!remoteStores.length) {
      if (isSupabaseConfigured) {
        setActiveStoreIdState(current => current === null ? current : null);
      }
      return;
    }

    setActiveStoreIdState(current =>
      current && remoteStores.some(store => store.store_id === current)
        ? current
        : remoteStores[0].store_id
    );
  }, [isAuthorized, isSupabaseConfigured, remoteStores]);

  return {
    activeStoreId,
    setActiveStoreId,
    userStores: remoteStores,
  };
};
