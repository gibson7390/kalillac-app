export type AIProcessingConsent = 'undecided' | 'allowed' | 'declined';
export type ConsentPersistence = 'loading' | 'pending' | 'stored' | 'session-only' | 'unavailable';
export interface ConsentSnapshot {
  state: AIProcessingConsent;
  loaded: boolean;
  persistence: ConsentPersistence;
}
export interface ConsentStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// A separate record: historical onboarding completion is never permission.
export const AI_CONSENT_KEY = '@kalillac_ai_processing_consent_v1';
export const AI_CONSENT_REQUIRED = 'ai-processing-consent-required';
export class AIProcessingConsentRequiredError extends Error {
  readonly code = AI_CONSENT_REQUIRED;
  constructor() {
    super('Review and allow AI processing before requesting a response.');
    this.name = 'AIProcessingConsentRequiredError';
  }
}

export function parseAIConsent(raw: string | null): AIProcessingConsent {
  if (!raw || raw.length > 128) return 'undecided';
  try {
    const value = JSON.parse(raw);
    return value?.version === 1 && (value.state === 'allowed' || value.state === 'declined')
      ? value.state : 'undecided';
  } catch { return 'undecided'; }
}

/** Device-local permission only. Never reads, writes, clears, or logs chat data. */
export class AIProcessingConsentStore {
  private snapshot: ConsentSnapshot = { state: 'undecided', loaded: false, persistence: 'loading' };
  private listeners = new Set<() => void>();
  private loading?: Promise<void>;
  private writes: Promise<unknown> = Promise.resolve();
  private revision = 0;
  constructor(private readonly storage: ConsentStorage) {}

  getSnapshot = (): ConsentSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  isAllowed = (): boolean => this.snapshot.loaded && this.snapshot.state === 'allowed';

  private publish(snapshot: ConsentSnapshot) {
    this.snapshot = snapshot;
    this.listeners.forEach(listener => listener());
  }

  load(): Promise<void> {
    if (this.snapshot.loaded) return Promise.resolve();
    if (this.loading) return this.loading;
    const revision = this.revision;
    this.loading = (async () => {
      let state: AIProcessingConsent = 'undecided';
      let persistence: ConsentPersistence = 'stored';
      try { state = parseAIConsent(await this.storage.getItem(AI_CONSENT_KEY)); }
      catch { persistence = 'session-only'; }
      // A late storage read must never resurrect permission after a fresh decision.
      if (revision === this.revision) this.publish({ state, loaded: true, persistence });
    })();
    return this.loading;
  }

  async ensureAllowed(): Promise<void> {
    if (!this.snapshot.loaded) await this.load();
    this.assertAllowed();
  }
  assertAllowed(): void {
    if (!this.isAllowed()) throw new AIProcessingConsentRequiredError();
  }

  decide(state: Exclude<AIProcessingConsent, 'undecided'>): Promise<boolean> {
    const revision = ++this.revision;
    // Permission changes synchronously, before any storage await or subsequent send.
    this.publish({ state, loaded: true, persistence: 'pending' });
    const write = this.writes.then(async () => {
      let persistence: ConsentPersistence = 'stored';
      try {
        await this.storage.setItem(AI_CONSENT_KEY, JSON.stringify({ version: 1, state }));
      } catch {
        // If a write fails, remove a possibly stale grant where storage permits.
        // Absence on the next launch means undecided, never an implicit grant.
        try { await this.storage.removeItem(AI_CONSENT_KEY); persistence = 'session-only'; }
        catch { persistence = 'unavailable'; }
      }
      if (revision === this.revision) this.publish({ state, loaded: true, persistence });
      return persistence === 'stored';
    });
    // Serialize decisions so an old slow grant cannot overwrite a withdrawal.
    this.writes = write.catch(() => undefined);
    return write;
  }
}

export function consentStatusLabel(snapshot: ConsentSnapshot): string {
  if (!snapshot.loaded) return 'Checking permission';
  return snapshot.state === 'allowed' ? 'Allowed' : snapshot.state === 'declined' ? 'Not allowed' : 'Not yet decided';
}

export function consentStorageNotice(snapshot: ConsentSnapshot): string | undefined {
  if (snapshot.state === 'undecided') return;
  if (snapshot.persistence === 'unavailable') {
    return 'Your choice applies now but couldn’t be saved. A previous saved choice may return after restarting. Review AI processing again or retry this choice.';
  }
  if (snapshot.persistence === 'session-only') {
    return 'Your choice applies for this session only. You’ll be asked again before AI processing after restarting.';
  }
  if (snapshot.persistence === 'pending') return 'Saving your choice. It already applies to this session.';
}
