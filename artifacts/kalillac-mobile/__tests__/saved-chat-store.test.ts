import { describe, it, expect, jest } from '@jest/globals';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Buffer } from 'buffer';
jest.mock('../services/savedChatAdapter', () => ({ savedChatStore: {} }));
import {
  SavedChatStore, type RecordStorage, type KeyStorage, type AuthenticatedCipher,
} from '../services/savedChatStore';
import {
  saveSnapshotState, deleteLogicalConversationState, resolveLogicalConversationId,
  type ChatSession,
} from '../contexts/ChatRepositoryContext';
import { createSnapshot } from '../utils/snapshot';

function memoryStorage() {
  const data = new Map<string, string>();
  const storage: RecordStorage & KeyStorage = {
    async getItem(key) { return data.get(key) ?? null; },
    async setItem(key, value) { data.set(key, value); },
    async removeItem(key) { data.delete(key); },
    async getAllKeys() { return [...data.keys()]; },
  };
  return { storage, data };
}

// Node's standard AES-GCM verifies the storage protocol without depending on an iOS native module.
const cipher: AuthenticatedCipher = {
  async generateKey() { return randomBytes(32).toString('base64'); },
  async encrypt(key, plaintext, id) {
    const iv = randomBytes(12);
    const aes = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv);
    aes.setAAD(Buffer.from(id));
    return Buffer.concat([iv, aes.update(plaintext, 'utf8'), aes.final(), aes.getAuthTag()]).toString('base64');
  },
  async decrypt(key, sealed, id) {
    const bytes = Buffer.from(sealed, 'base64');
    const aes = createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64'), bytes.subarray(0, 12));
    aes.setAAD(Buffer.from(id));
    aes.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([aes.update(bytes.subarray(12, -16)), aes.final()]).toString('utf8');
  },
};

const temporary = (id: string, content: string): ChatSession => ({
  id, title: 'Private title', createdAt: 1, updatedAt: 2, mode: 'Auto',
  messages: [{ id: 'message-1', role: 'user', content }],
  isTemporary: true, requestState: { status: 'idle', prompt: 'must not persist', retryCount: 0 },
});

describe('encrypted local Saved snapshots', () => {
  it('writes nothing for unsaved temporary chats; explicitly saves ciphertext without the key or request state', async () => {
    const records = memoryStorage();
    const keys = memoryStorage();
    const store = new SavedChatStore(records.storage, keys.storage, cipher);
    const original = temporary('active', 'secret message 🗝');
    expect(records.data.size).toBe(0);
    expect(keys.data.size).toBe(0);

    const saved = createSnapshot(original, 'snapshot');
    await store.save(saved);
    expect(records.data.size).toBe(1);
    const raw = [...records.data.values()][0];
    expect(raw).not.toContain('secret message');
    expect(raw).not.toContain('Private title');
    expect(raw).not.toContain('must not persist');
    expect(raw).not.toContain([...keys.data.values()][0]);
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(['sealed', 'version']);

    const restarted = new SavedChatStore(records.storage, keys.storage, cipher);
    expect(await restarted.load()).toMatchObject([{
      id: 'snapshot', sourceConversationId: 'active', title: 'Private title',
      messages: [{ role: 'user', content: 'secret message 🗝' }],
    }]);
    expect((await restarted.load())[0].requestState).toBeUndefined();
  });

  it('does not persist later turns until Update saved copy; then replaces the snapshot', async () => {
    const records = memoryStorage();
    const keys = memoryStorage();
    const store = new SavedChatStore(records.storage, keys.storage, cipher);
    const original = temporary('active', 'first');
    const saved = createSnapshot(original, 'snapshot');
    await store.save(saved);
    const linked = saveSnapshotState([original], [], original.id, saved);
    expect(linked.activeSessions[0].savedCopyId).toBe('snapshot');

    const continued = {
      ...original,
      messages: [...original.messages, { id: 'message-2', role: 'ai' as const, content: 'later turn' }],
    };
    expect((await store.load())[0].messages).toHaveLength(1);
    await store.save(createSnapshot(continued, saved.id));
    expect((await store.load())[0].messages).toHaveLength(2);
    expect(records.data.size).toBe(1);
  });

  it('unified deletion removes only the linked record and active sessions', async () => {
    const records = memoryStorage();
    const keys = memoryStorage();
    const store = new SavedChatStore(records.storage, keys.storage, cipher);
    const original = temporary('active', 'delete me');
    const unrelated = temporary('other', 'keep me');
    const saved = createSnapshot(original, 'snapshot');
    const otherSaved = createSnapshot(unrelated, 'other-snapshot');
    await store.save(saved);
    await store.save(otherSaved);
    const active = saveSnapshotState([original, unrelated], [], original.id, saved).activeSessions;
    const logicalId = resolveLogicalConversationId(active, [saved, otherSaved], saved.id);
    const next = deleteLogicalConversationState(active, [saved, otherSaved], logicalId);
    for (const removed of [saved, otherSaved].filter(item => !next.savedSessions.includes(item))) {
      await store.remove(removed.id);
    }
    expect(next.activeSessions.map(item => item.id)).toEqual(['other']);
    expect((await store.load()).map(item => item.id)).toEqual(['other-snapshot']);
    expect(records.data.size).toBe(1);
  });

  it('never regenerates a missing key over existing records and never accepts a wrong key', async () => {
    const records = memoryStorage();
    const keys = memoryStorage();
    const store = new SavedChatStore(records.storage, keys.storage, cipher);
    await store.save(createSnapshot(temporary('active', 'hidden'), 'snapshot'));
    const keyName = [...keys.data.keys()][0];
    const previousKey = keys.data.get(keyName)!;
    keys.data.delete(keyName);
    expect((await store.load())[0]).toMatchObject({ corrupted: true, messages: [] });
    await expect(store.save(createSnapshot(temporary('new', 'not saved'), 'new-snapshot'))).rejects.toThrow();
    expect(keys.data.size).toBe(0);
    keys.data.set(keyName, randomBytes(32).toString('base64'));
    expect((await store.load())[0]).toMatchObject({ corrupted: true, messages: [] });
    keys.data.set(keyName, previousKey);
    expect((await store.load())[0].messages[0].content).toBe('hidden');
  });

  it('rejects tampered ciphertext and malformed records without returning plaintext', async () => {
    const records = memoryStorage();
    const keys = memoryStorage();
    const store = new SavedChatStore(records.storage, keys.storage, cipher);
    await store.save(createSnapshot(temporary('active', 'sensitive'), 'snapshot'));
    const recordKey = [...records.data.keys()][0];
    const stored = JSON.parse(records.data.get(recordKey)!);
    const bytes = Buffer.from(stored.sealed, 'base64');
    bytes[15] ^= 1;
    records.data.set(recordKey, JSON.stringify({ version: 1, sealed: bytes.toString('base64') }));
    expect((await store.load())[0]).toMatchObject({ corrupted: true, messages: [] });
    records.data.set(recordKey, '{malformed');
    expect((await store.load())[0]).toMatchObject({ corrupted: true, messages: [] });
  });
});