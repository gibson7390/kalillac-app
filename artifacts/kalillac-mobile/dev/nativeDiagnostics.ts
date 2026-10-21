import { NATIVE_CANDIDATE_ID } from './nativeCandidate';

type Storage = { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<void> };
type Fields = object;
type Entry = Record<string, string | number | boolean>;
const STORAGE_KEY = 'kalillac.dev.content-free-diagnostics.v1';
const LIMIT = 240;
const STRING_FIELDS = new Set([
  'stage', 'assistantMessageId', 'messageId', 'messageKey', 'previousMessageKey',
  'codeBlockKey', 'operationId', 'snapshotId', 'requestId', 'sourceUserMessageId',
  'candidateId', 'state', 'operation', 'status', 'errorClass', 'channel',
]);
const NUMBER_FIELDS = new Set([
  'accumulatedChars', 'renderCopyChars', 'deltaNumber', 'markdownFenceCount',
  'renderedCodeBlockCount', 'height', 'width', 'codeChars', 'codeBlockIndex', 'encryptedRecordCount',
]);
const BOOLEAN_FIELDS = new Set([
  'renderCopyFenceBalanced', 'renderCopyBalancingApplied', 'messageKeyChanged',
  'finalizationPreservedPrevious', 'cancellationCleared',
]);

/** A strict allowlist, including when restoring an old/corrupt trace. Never
 * accept text, errors/messages, plaintext, ciphertext, keys, or arbitrary data.
 */
function sanitize(fields: Fields): Entry {
  const safe: Entry = {};
  for (const [name, value] of Object.entries(fields)) {
    if (STRING_FIELDS.has(name) && typeof value === 'string'
      && /^[a-zA-Z0-9_.:$-]{1,100}$/.test(value)) safe[name] = value;
    else if (NUMBER_FIELDS.has(name) && typeof value === 'number'
      && Number.isFinite(value) && value >= 0) safe[name] = value;
    else if (BOOLEAN_FIELDS.has(name) && typeof value === 'boolean') safe[name] = value;
  }
  return safe;
}

/** Dev-only, bounded content-free ledger. Critical Save events are flushed
 * before the next native operation, so a process exit leaves a last checkpoint.
 */
export class NativeDiagnosticRecorder {
  private events: Entry[] = [];
  private checkpoints = new Map<string, Entry>();
  private storage?: Storage;
  private ready: Promise<void> = Promise.resolve();
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly enabled: boolean) {}

  configure(storage: Storage): void {
    if (!this.enabled || this.storage) return;
    this.storage = storage;
    this.ready = storage.getItem(STORAGE_KEY).then(raw => {
      if (!raw) return;
      const saved = JSON.parse(raw);
      const restored = Array.isArray(saved.events) ? saved.events.map(sanitize).slice(-LIMIT) : [];
      this.events = [...restored, ...this.events].slice(-LIMIT);
      if (Array.isArray(saved.checkpoints)) {
        const current = [...this.checkpoints.values()];
        this.checkpoints.clear();
        for (const value of [...saved.checkpoints.slice(-80), ...current]) {
          const entry = sanitize(value);
          const key = this.checkpointKey(entry);
          this.checkpoints.delete(key);
          this.checkpoints.set(key, entry);
          if (this.checkpoints.size > 80) this.checkpoints.delete(this.checkpoints.keys().next().value!);
        }
      }
    }).catch(() => { /* diagnostics must never fail a real Save */ });
  }

  private checkpointKey(entry: Entry): string {
    return `${entry.channel}:${entry.stage}:${entry.assistantMessageId ?? entry.messageId ?? entry.operationId ?? ''}:${entry.codeBlockKey ?? entry.codeBlockIndex ?? ''}`;
  }

  record(channel: string, fields: Fields, durable = false): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    const entry = sanitize({ ...fields, channel, candidateId: NATIVE_CANDIDATE_ID });
    this.events = [...this.events, entry].slice(-LIMIT);
    const key = this.checkpointKey(entry);
    this.checkpoints.delete(key);
    this.checkpoints.set(key, entry);
    if (this.checkpoints.size > 80) this.checkpoints.delete(this.checkpoints.keys().next().value!);
    return durable ? this.flush() : Promise.resolve();
  }

  async flush(): Promise<void> {
    if (!this.enabled) return;
    await this.ready;
    const storage = this.storage;
    if (!storage) return;
    this.writing = this.writing.then(() => storage.setItem(STORAGE_KEY, this.serialize()))
      .catch(() => { /* preserve the real operation; no diagnostic content logged */ });
    await this.writing;
  }

  private serialize(): string {
    return JSON.stringify({
      candidateId: NATIVE_CANDIDATE_ID,
      events: this.events,
      checkpoints: [...this.checkpoints.values()],
    }, null, 2);
  }

  async export(): Promise<string> {
    if (!this.enabled) return '';
    await this.flush();
    return this.serialize();
  }

  async clear(): Promise<void> {
    await this.ready;
    this.events = [];
    this.checkpoints.clear();
    await this.flush();
  }
}

export const nativeDiagnostics = new NativeDiagnosticRecorder(typeof __DEV__ !== 'undefined' && __DEV__);
