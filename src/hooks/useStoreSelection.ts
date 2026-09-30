import { useCallback, useEffect, useMemo, useState } from 'react';
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

  const validStoreIds = useMemo(
    () => new Set(remoteStores.map(store => store.store_id)),
    [remoteStores]
  );

  const setActiveStoreId = useCallback((id: string) => {
    if (!validStoreIds.has(id)) return;
    setActiveStoreIdState(id);
  }, [validStoreIds]);

  useEffect(() => {
    if (!isAuthorized) {
      setActiveStoreIdState(null);
      return;
    }

    if (!remoteStores.length) {
      if (isSupabaseConfigured) {
        setActiveStoreIdState(null);
      }
      return;
    }

    setActiveStoreIdState(current =>
      current && validStoreIds.has(current) ? current : remoteStores[0].store_id
    );
  }, [isAuthorized, isSupabaseConfigured, remoteStores, validStoreIds]);

  return {
    activeStoreId,
    setActiveStoreId,
    userStores: remoteStores,
  };
};
