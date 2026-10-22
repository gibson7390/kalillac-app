export type OnboardingParams = { revisit?: string | string[] };

/** True when onboarding was deliberately reopened from Settings. */
export function isRevisit(params: OnboardingParams | undefined | null): boolean {
  const v = params?.revisit;
  const value = Array.isArray(v) ? v[0] : v;
  return value === '1' || value === 'true';
}

/** Only redirect away from onboarding when completed and not deliberately revisiting. */
export function shouldSkipOnboarding(hasOnboarded: boolean, revisit: boolean): boolean {
  return hasOnboarded && !revisit;
}

/** Parse only the onboarding-complete boolean from stored prefs; never throws. */
export function parseOnboarded(raw: string | null | undefined): boolean | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && typeof parsed.hasOnboarded === 'boolean'
      ? parsed.hasOnboarded
      : undefined;
  } catch {
    return undefined;
  }
}

export const ONBOARDING_POINTS = [
  { key: 'temporary', icon: 'time-outline', title: 'Temporary by default', body: 'Chats stay in memory and clear when you end them or reload.' },
  { key: 'save', icon: 'lock-closed-outline', title: 'Saving is your choice', body: 'Tap Save to keep a chat on this device. Nothing is saved otherwise.' },
  { key: 'ai', icon: 'cloud-outline', title: 'External AI providers', body: 'Answers aren’t generated entirely on your phone. Message content needed to answer, including relevant chat context, goes through Kalillac’s backend to external AI processing services.' },
  { key: 'web', icon: 'globe-outline', title: 'Current web when needed', body: 'If web search is used, relevant queries and information may also be processed by the configured search and AI services.' },
] as const;

export type KeyValueStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

/** Read stored prefs JSON; resolves null on any storage failure. Never rejects. */
export async function safeReadPrefs(storage: KeyValueStorage, key: string): Promise<string | null> {
  try {
    return await storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Persist a non-content prefs object. Resolves true on success, false on failure.
 * Never rejects, so callers can fire-and-forget without blocking the app.
 */
export async function safeWritePrefs(storage: KeyValueStorage, key: string, prefs: object): Promise<boolean> {
  try {
    await storage.setItem(key, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}

/** In-memory-first completion: returns updated prefs immediately; idempotent when already complete. */
export function applyOnboardingComplete<T extends { hasOnboarded: boolean }>(prefs: T): { next: T; changed: boolean } {
  if (prefs.hasOnboarded) return { next: prefs, changed: false };
  return { next: { ...prefs, hasOnboarded: true }, changed: true };
}
