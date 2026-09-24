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
  ) {}

  async load(): Promise<ChatSession[]> {
    const ids = (await this.records.getAllKeys())
      .filter(key => key.startsWith(RECORD_PREFIX)).map(key => key.slice(RECORD_PREFIX.length));
    if (!ids.length) return [];
    // Never replace a missing key while records remain: doing so would mask permanent data loss.
    const key = await this.keys.getItem(KEY_NAME);
    const sessions = await Promise.all(ids.map(async id => {
      try {
        if (!id || !key) return unavailable(id);
        const raw = await this.records.getItem(RECORD_PREFIX + id);
        if (!raw) return unavailable(id);
        const record = JSON.parse(raw);
        if (record?.version !== 1 || typeof record.sealed !== 'string' || !record.sealed) {
          return unavailable(id);
        }
        const decoded: unknown = JSON.parse(await this.cipher.decrypt(key, record.sealed, id));
        if (!validSnapshot(decoded, id)) return unavailable(id);
        return { ...decoded, isTemporary: false } satisfies ChatSession;
      } catch {
        return unavailable(id);
      }
    }));
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async save(snapshot: ChatSession): Promise<void> {
    if (snapshot.corrupted) throw new Error('Cannot save a corrupted snapshot');
    let key = await this.keys.getItem(KEY_NAME);
    if (!key) {
      const existing = (await this.records.getAllKeys()).some(item => item.startsWith(RECORD_PREFIX));
      if (existing) throw new Error('Saved chat encryption key is unavailable');
      key = await this.cipher.generateKey();
      await this.keys.setItem(KEY_NAME, key);
    }
    const sealed = await this.cipher.encrypt(key, JSON.stringify(snapshotForStorage(snapshot)), snapshot.id);
    await this.records.setItem(RECORD_PREFIX + snapshot.id, JSON.stringify({ version: 1, sealed }));
  }

  async remove(id: string): Promise<void> {
    await this.records.removeItem(RECORD_PREFIX + id);
  }
}