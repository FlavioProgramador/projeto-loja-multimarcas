import { useEffect, useRef } from 'react';

interface UseStoreAuthResetParams {
  userId?: string;
  isAuthorized: boolean;
  resetStoreState: () => void;
}

export const useStoreAuthReset = ({
  userId,
  isAuthorized,
  resetStoreState,
}: UseStoreAuthResetParams) => {
  const previousUserId = useRef<string | null>(null);

  useEffect(() => {
    const userChanged =
      previousUserId.current !== null &&
      previousUserId.current !== userId;

    if (!isAuthorized || userChanged) {
      resetStoreState();
    }

    previousUserId.current = isAuthorized ? userId ?? null : null;
  }, [isAuthorized, resetStoreState, userId]);
};
