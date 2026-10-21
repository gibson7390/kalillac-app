import type { ChatSession, ChatMessage, AIModelMode } from '../contexts/ChatRepositoryContext';

const RECORD_PREFIX = 'kalillac.saved.v1.';
const KEY_NAME = 'kalillac.saved.aes256.v1';
const MODES: AIModelMode[] = ['Auto', 'Fast', 'Smart', 'Deep'];

export interface RecordStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
}

export interface KeyStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface AuthenticatedCipher {
  generateKey(): Promise<string>;
  encrypt(key: string, plaintext: string, associatedId: string): Promise<string>;
  decrypt(key: string, sealed: string, associatedId: string): Promise<string>;
}

export type SavedChatDiagnostic = {
  operation: 'save' | 'verify' | 'load';
  stage: string;
  status: 'started' | 'success' | 'failure';
  snapshotId?: string;
  operationId?: string;
  encryptedRecordCount?: number;
  errorClass?: string;
};

export interface SavedSnapshot {
  version: 1;
  id: string;
  sourceConversationId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  mode: AIModelMode;
  messages: Array<Pick<ChatMessage, 'id' | 'role' | 'content' | 'modeUsed'>>;
}

function validSnapshot(value: unknown, recordId: string): value is SavedSnapshot {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<SavedSnapshot>;
  return item.version === 1 && item.id === recordId
    && typeof item.sourceConversationId === 'string' && !!item.sourceConversationId
    && typeof item.title === 'string'
    && Number.isFinite(item.createdAt) && Number.isFinite(item.updatedAt)
    && MODES.includes(item.mode as AIModelMode)
    && Array.isArray(item.messages)
    && item.messages.every(message => message && typeof message.id === 'string'
      && (message.role === 'user' || message.role === 'ai')
      && typeof message.content === 'string'
      && (message.modeUsed === undefined || MODES.includes(message.modeUsed)));
}

export function snapshotForStorage(session: ChatSession): SavedSnapshot {
  return {
    version: 1,
    id: session.id,
    sourceConversationId: session.sourceConversationId ?? session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    mode: session.mode,
    messages: session.messages.map(message => ({
      id: message.id,
      role: message.role,
      content: message.content,
      ...(message.modeUsed ? { modeUsed: message.modeUsed } : {}),
    })),
  };
}

function unavailable(id: string): ChatSession {
  return {
    id, sourceConversationId: id, title: 'Unavailable saved chat',
    createdAt: 0, updatedAt: 0, mode: 'Auto', messages: [],
    isTemporary: false, corrupted: true,
  };
}

export class SavedChatStore {
  constructor(
    private readonly records: RecordStorage,
    private readonly keys: KeyStorage,
    private readonly cipher: AuthenticatedCipher,
    private readonly onDiagnostic?: (event: SavedChatDiagnostic) => unknown,
  ) {}

  async recordDiagnostic(event: SavedChatDiagnostic): Promise<void> {
    try { await this.onDiagnostic?.(event); } catch { /* diagnostics must not change Save semantics */ }
  }

  async load(): Promise<ChatSession[]> {
    const ids = (await this.records.getAllKeys())
      .filter(key => key.startsWith(RECORD_PREFIX)).map(key => key.slice(RECORD_PREFIX.length));
    this.recordDiagnostic({ operation: 'load', stage: 'enumerate-records', status: 'success', encryptedRecordCount: ids.length });
    if (!ids.length) return [];
    // Never replace a missing key while records remain: doing so would mask permanent data loss.
    let key: string | null;
    try {
      key = await this.keys.getItem(KEY_NAME);
      this.recordDiagnostic({
        operation: 'load', stage: 'read-key', status: key || !ids.length ? 'success' : 'failure',
        encryptedRecordCount: ids.length,
        ...(!key && ids.length ? { errorClass: 'MissingEncryptionKeyError' } : {}),
      });
    } catch (error) {
      this.recordDiagnostic({
        operation: 'load', stage: 'read-key', status: 'failure', encryptedRecordCount: ids.length,
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
      throw error;
    }
    const sessions = await Promise.all(ids.map(async id => {
      let readErrorClass: string | undefined;
      const restored = id && key ? await this.readSnapshot(id, key, error => {
        readErrorClass = error instanceof Error ? error.name : 'UnknownError';
      }) : undefined;
      this.recordDiagnostic({
        operation: 'load', stage: 'decrypt-record', status: restored ? 'success' : 'failure',
        snapshotId: id,
        ...(!key ? { errorClass: 'MissingEncryptionKeyError' } : readErrorClass ? { errorClass: readErrorClass } : {}),
      });
      return restored ?? unavailable(id);
    }));
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private async readSnapshot(
    id: string,
    key: string,
    onError?: (error: unknown) => void,
  ): Promise<ChatSession | undefined> {
    try {
      const raw = await this.records.getItem(RECORD_PREFIX + id);
      if (!raw) return undefined;
      const record = JSON.parse(raw);
      if (record?.version !== 1 || typeof record.sealed !== 'string' || !record.sealed) {
        return undefined;
      }
      const decoded: unknown = JSON.parse(await this.cipher.decrypt(key, record.sealed, id));
      if (!validSnapshot(decoded, id)) return undefined;
      return { ...decoded, isTemporary: false } satisfies ChatSession;
    } catch (error) {
      onError?.(error);
      return undefined;
    }
  }

  async saveAndVerify(
    snapshot: ChatSession,
    isNewSnapshot = false,
    operationId = snapshot.id,
  ): Promise<() => Promise<void>> {
    const recordKey = RECORD_PREFIX + snapshot.id;
    let previousRecord: string | null;
    try {
      await this.recordDiagnostic({ operation: 'save', stage: 'read_existing_started', status: 'started', snapshotId: snapshot.id, operationId });
      previousRecord = await this.records.getItem(recordKey);
      await this.recordDiagnostic({
        operation: 'save', stage: 'read-existing-record', status: 'success',
        snapshotId: snapshot.id, operationId, encryptedRecordCount: previousRecord ? 1 : 0,
      });
    } catch (error) {
      this.recordDiagnostic({
        operation: 'save', stage: 'read-existing-record', status: 'failure', snapshotId: snapshot.id, operationId,
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
      throw error;
    }
    if ((isNewSnapshot && previousRecord !== null) || (!isNewSnapshot && previousRecord === null)) {
      throw new Error(isNewSnapshot
        ? 'A saved record with this identifier already exists'
        : 'The existing saved snapshot is unavailable');
    }

    try {
      await this.save(snapshot, operationId);
      await this.recordDiagnostic({
        operation: 'verify', stage: 'verify_read_started', status: 'started',
        snapshotId: snapshot.id, operationId,
      });
      let key: string | null;
      try {
        key = await this.keys.getItem(KEY_NAME);
      } catch (error) {
        this.recordDiagnostic({
          operation: 'verify', stage: 'verify_read_failed', status: 'failure', snapshotId: snapshot.id, operationId,
          errorClass: error instanceof Error ? error.name : 'UnknownError',
        });
        throw new Error('Saved snapshot could not be verified after writing');
      }
      let readErrorClass: string | undefined;
      const restored = key ? await this.readSnapshot(snapshot.id, key, error => {
        readErrorClass = error instanceof Error ? error.name : 'UnknownError';
      }) : undefined;
      const verified = !!restored
        && JSON.stringify(snapshotForStorage(restored)) === JSON.stringify(snapshotForStorage(snapshot));
      await this.recordDiagnostic({
        operation: 'verify',
        stage: verified ? 'verify_read_succeeded' : 'verify_read_failed',
        status: verified ? 'success' : 'failure',
        snapshotId: snapshot.id, operationId,
        ...(readErrorClass ? { errorClass: readErrorClass } : {}),
      });
      if (!verified) throw new Error('Saved snapshot could not be verified after writing');
    } catch (error) {
      try {
        if (previousRecord !== null) {
          await this.records.setItem(recordKey, previousRecord);
        } else if (isNewSnapshot) {
          await this.records.removeItem(recordKey);
        }
        this.recordDiagnostic({ operation: 'save', stage: 'rollback-record', status: 'success', snapshotId: snapshot.id, operationId });
      } catch (rollbackError) {
        this.recordDiagnostic({
          operation: 'save', stage: 'rollback-record', status: 'failure', snapshotId: snapshot.id, operationId,
          errorClass: rollbackError instanceof Error ? rollbackError.name : 'UnknownError',
        });
      }
      throw error;
    }

    return async () => {
      if (previousRecord !== null) await this.records.setItem(recordKey, previousRecord);
      else if (isNewSnapshot) await this.records.removeItem(recordKey);
      this.recordDiagnostic({ operation: 'save', stage: 'rollback-record', status: 'success', snapshotId: snapshot.id, operationId });
    };
  }

  async save(snapshot: ChatSession, operationId = snapshot.id): Promise<void> {
    if (snapshot.corrupted) throw new Error('Cannot save a corrupted snapshot');
    let key: string | null;
    await this.recordDiagnostic({ operation: 'save', stage: 'key_load_started', status: 'started', snapshotId: snapshot.id, operationId });
    try {
      key = await this.keys.getItem(KEY_NAME);
      await this.recordDiagnostic({ operation: 'save', stage: 'key_load_succeeded', status: 'success', snapshotId: snapshot.id, operationId });
    } catch (error) {
      this.recordDiagnostic({
        operation: 'save', stage: 'key_load_failed', status: 'failure', snapshotId: snapshot.id, operationId,
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
      throw error;
    }
    if (!key) {
      let encryptedRecordCount: number;
      try {
        const existingKeys = await this.records.getAllKeys();
        encryptedRecordCount = existingKeys.filter(item => item.startsWith(RECORD_PREFIX)).length;
      } catch (error) {
        this.recordDiagnostic({
          operation: 'save', stage: 'count-records', status: 'failure', snapshotId: snapshot.id, operationId,
          errorClass: error instanceof Error ? error.name : 'UnknownError',
        });
        throw error;
      }
      if (encryptedRecordCount > 0) {
        this.recordDiagnostic({
          operation: 'save', stage: 'key_create_failed', status: 'failure', snapshotId: snapshot.id, operationId,
          encryptedRecordCount, errorClass: 'MissingEncryptionKeyError',
        });
        throw new Error('Saved chat encryption key is unavailable');
      }
      await this.recordDiagnostic({ operation: 'save', stage: 'key_create_started', status: 'started', snapshotId: snapshot.id, operationId });
      try {
        key = await this.cipher.generateKey();
        await this.recordDiagnostic({ operation: 'save', stage: 'key_generated', status: 'success', snapshotId: snapshot.id, operationId });
        await this.recordDiagnostic({ operation: 'save', stage: 'key_store_started', status: 'started', snapshotId: snapshot.id, operationId });
        await this.keys.setItem(KEY_NAME, key);
        await this.recordDiagnostic({
          operation: 'save', stage: 'key_create_succeeded', status: 'success', snapshotId: snapshot.id, operationId,
          encryptedRecordCount,
        });
      } catch (error) {
        this.recordDiagnostic({
          operation: 'save', stage: 'key_create_failed', status: 'failure', snapshotId: snapshot.id, operationId,
          errorClass: error instanceof Error ? error.name : 'UnknownError',
        });
        throw error;
      }
    }
    let sealed: string;
    await this.recordDiagnostic({ operation: 'save', stage: 'encrypt_started', status: 'started', snapshotId: snapshot.id, operationId });
    try {
      sealed = await this.cipher.encrypt(key, JSON.stringify(snapshotForStorage(snapshot)), snapshot.id);
      await this.recordDiagnostic({ operation: 'save', stage: 'encrypt_succeeded', status: 'success', snapshotId: snapshot.id, operationId });
    } catch (error) {
      this.recordDiagnostic({
        operation: 'save', stage: 'encrypt_failed', status: 'failure', snapshotId: snapshot.id, operationId,
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
      throw error;
    }
    await this.recordDiagnostic({ operation: 'save', stage: 'write_started', status: 'started', snapshotId: snapshot.id, operationId });
    try {
      await this.records.setItem(RECORD_PREFIX + snapshot.id, JSON.stringify({ version: 1, sealed }));
      await this.recordDiagnostic({ operation: 'save', stage: 'write_succeeded', status: 'success', snapshotId: snapshot.id, operationId });
    } catch (error) {
      this.recordDiagnostic({
        operation: 'save', stage: 'write_failed', status: 'failure', snapshotId: snapshot.id, operationId,
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    await this.records.removeItem(RECORD_PREFIX + id);
  }
}