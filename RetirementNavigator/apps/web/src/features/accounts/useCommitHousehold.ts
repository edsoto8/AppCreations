import { useCallback } from 'react';
import { useProfileStore } from '@/state/profileStore';
import { validateHousehold, type CommitResult } from './accountModel';

/** Validate a candidate household with the engine schema and, if valid, save it to the active profile. */
export function useCommitHousehold(): (candidate: unknown) => CommitResult {
  const update = useProfileStore((s) => s.updateActiveHousehold);
  return useCallback(
    (candidate: unknown) => {
      const result = validateHousehold(candidate);
      if (result.ok) update(result.household);
      return result;
    },
    [update],
  );
}
