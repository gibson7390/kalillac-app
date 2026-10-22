import { useEffect, useSyncExternalStore } from 'react';
import { aiProcessingConsent } from '../services/aiProcessingConsent';

export function useAIProcessingConsent() {
  const snapshot = useSyncExternalStore(
    aiProcessingConsent.subscribe, aiProcessingConsent.getSnapshot, aiProcessingConsent.getSnapshot,
  );
  useEffect(() => { void aiProcessingConsent.load(); }, []);
  return snapshot;
}
