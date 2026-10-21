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
import { persistThenCommitSnapshot } from '../services/savedSnapshotTransaction';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  it('awaits encrypted persistence and verifies the exact restored snapshot before reporting save completion', async () => {
    const records = memoryStorage();
    const keys = memoryStorage();
    const events: Array<Record<string, unknown>> = [];
    const store = new SavedChatStore(records.storage, keys.storage, cipher, event => events.push(event));
    const source = temporary('active', 'private transcript that must not enter diagnostics');
    const snapshot = createSnapshot(source, 'snapshot');

    await store.saveAndVerify(snapshot, true);

    expect(await store.load()).toMatchObject([{
      id: 'snapshot',
      sourceConversationId: 'active',
      messages: [{ content: 'private transcript that must not enter diagnostics' }],
    }]);
    expect(events
      .filter(event => event.operation !== 'load')
      .map(event => `${event.operation}:${event.stage}:${event.status}`)).toEqual([
      'save:read_existing_started:started',
      'save:read-existing-record:success',
      'save:key_load_started:started',
      'save:key_load_succeeded:success',
      'save:key_create_started:started',
      'save:key_generated:success',
      'save:key_store_started:started',
      'save:key_create_succeeded:success',
      'save:encrypt_started:started',
      'save:encrypt_succeeded:success',
      'save:write_started:started',
      'save:write_succeeded:success',
      'verify:verify_read_started:started',
      'verify:verify_read_succeeded:success',
    ]);
    expect(JSON.stringify(events)).not.toContain('private transcript');
    expect(JSON.stringify(events)).not.toContain([...keys.data.values()][0]);

    const repositorySource = readFileSync(
      resolve(__dirname, '../contexts/ChatRepositoryContext.tsx'),
      'utf8',
    );
    const initialSave = repositorySource.slice(
      repositorySource.indexOf('const saveSession'),
      repositorySource.indexOf('const updateSavedSession'),
    );
    expect(initialSave.indexOf('savedChatStore.saveAndVerify(snapshot, true, operationId)'))
      .toBeLessThan(initialSave.indexOf('await commitSavedSnapshot(snapshot, sessionId)'));
    expect(initialSave).toContain('persistThenCommitSnapshot');
    expect(repositorySource).toContain('savedCommitWaitersRef');
    expect(repositorySource).toContain('storedData === JSON.stringify(snapshotForStorage(waiter.snapshot))');
    const explicitUpdate = repositorySource.slice(
      repositorySource.indexOf('const updateSavedSession'),
      repositorySource.indexOf('const corruptRandomSession'),
    );
    expect(explicitUpdate.indexOf('savedChatStore.saveAndVerify(snapshot, false, operationId)'))
      .toBeLessThan(explicitUpdate.indexOf('await commitSavedSnapshot(snapshot, tempId)'));
  });

  it('does not verify/report save success when the encrypted record cannot be read back', async () => {
    const records = memoryStorage();
    const keys = memoryStorage();
    const silentWrite = {
      ...records.storage,
      async setItem() {},
    };
    const events: Array<Record<string, unknown>> = [];
    const store = new SavedChatStore(silentWrite, keys.storage, cipher, event => events.push(event));

    await expect(store.saveAndVerify(createSnapshot(temporary('active', 'not saved'), 'snapshot'), true))
      .rejects.toThrow('could not be verified');
    expect(await store.load()).toEqual([]);
    expect(events.filter(event => event.operation === 'verify')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: 'verify',
        stage: 'verify_read_started',
        status: 'started',
      }),
      expect.objectContaining({
        operation: 'verify',
        stage: 'verify_read_failed',
        status: 'failure',
      }),
    ]));
  });

  it('reports key-load, encryption, and write failures without creating a Saved record', async () => {
    const snapshot = createSnapshot(temporary('active', 'must stay private'), 'snapshot');

    const recordsForKeyFailure = memoryStorage();
    const keysForKeyFailure = memoryStorage();
    const failingKeys = {
      ...keysForKeyFailure.storage,
      async getItem() { throw new Error('private error text must not be logged'); },
    };
    const keyEvents: Array<Record<string, unknown>> = [];
    const keyFailureStore = new SavedChatStore(recordsForKeyFailure.storage, failingKeys, cipher, event => keyEvents.push(event));
    await expect(keyFailureStore.saveAndVerify(snapshot, true, 'op-key')).rejects.toThrow();
    expect(await recordsForKeyFailure.storage.getAllKeys()).toEqual([]);
    expect(keyEvents.map(event => event.stage)).toEqual([
      'read_existing_started', 'read-existing-record', 'key_load_started', 'key_load_failed', 'rollback-record',
    ]);
    expect(JSON.stringify(keyEvents)).not.toContain('private error text');
    expect(JSON.stringify(keyEvents)).not.toContain('must stay private');

    const recordsForEncryptionFailure = memoryStorage();
    const keysForEncryptionFailure = memoryStorage();
    const failingCipher: AuthenticatedCipher = {
      ...cipher,
      async encrypt() { throw new Error('private encryption error'); },
    };
    const encryptionEvents: Array<Record<string, unknown>> = [];
    const encryptionFailureStore = new SavedChatStore(
      recordsForEncryptionFailure.storage, keysForEncryptionFailure.storage, failingCipher,
      event => encryptionEvents.push(event),
    );
    await expect(encryptionFailureStore.saveAndVerify(snapshot, true, 'op-encrypt')).rejects.toThrow();
    expect(await recordsForEncryptionFailure.storage.getAllKeys()).toEqual([]);
    expect(encryptionEvents.some(event => event.stage === 'encrypt_failed')).toBe(true);
    expect(JSON.stringify(encryptionEvents)).not.toContain('private encryption error');
    expect(JSON.stringify(encryptionEvents)).not.toContain('must stay private');

    const recordsForWriteFailure = memoryStorage();
    const keysForWriteFailure = memoryStorage();
    const failingRecords = {
      ...recordsForWriteFailure.storage,
      async setItem() { throw new Error('private write error'); },
    };
    const writeEvents: Array<Record<string, unknown>> = [];
    const writeFailureStore = new SavedChatStore(
      failingRecords, keysForWriteFailure.storage, cipher, event => writeEvents.push(event),
    );
    await expect(writeFailureStore.saveAndVerify(snapshot, true, 'op-write')).rejects.toThrow();
    expect(await recordsForWriteFailure.storage.getAllKeys()).toEqual([]);
    expect(writeEvents.some(event => event.stage === 'write_failed')).toBe(true);
    expect(JSON.stringify(writeEvents)).not.toContain('private write error');
    expect(JSON.stringify(writeEvents)).not.toContain('must stay private');
  });

  it('rolls persistence back when repository commit fails and never reports save success', async () => {
    const records = memoryStorage();
    const keys = memoryStorage();
    const events: Array<Record<string, unknown>> = [];
    const store = new SavedChatStore(records.storage, keys.storage, cipher, event => events.push(event));
    const snapshot = createSnapshot(temporary('active', 'private transcript'), 'snapshot');
    await expect(persistThenCommitSnapshot(
      () => store.saveAndVerify(snapshot, true, 'op-repository'),
      async () => { throw new Error('repository commit failed'); },
      (stage, status, errorClass) => store.recordDiagnostic({
        operation: 'save',
        stage,
        status,
        snapshotId: snapshot.id,
        operationId: 'op-repository',
        ...(errorClass ? { errorClass } : {}),
      }),
    )).rejects.toThrow('repository commit failed');
    expect(await store.load()).toEqual([]);
    expect(await records.storage.getAllKeys()).toEqual([]);
    expect(events.filter(event => ['repository_commit_started', 'repository_commit_failed', 'save_success'].includes(String(event.stage))))
      .toMatchObject([
        { stage: 'repository_commit_started', status: 'started', operationId: 'op-repository' },
        { stage: 'repository_commit_failed', status: 'failure', operationId: 'op-repository', errorClass: 'Error' },
      ]);
    expect(events.some(event => event.stage === 'save_success')).toBe(false);
  });

  it('removes a partially-written new record when its initial save transaction fails', async () => {
    const records = memoryStorage();
    const keys = memoryStorage();
    const writesThenThrows = {
      ...records.storage,
      async setItem(key: string, value: string) {
        await records.storage.setItem(key, value);
        throw new Error('synthetic storage failure');
      },
    };
    const store = new SavedChatStore(writesThenThrows, keys.storage, cipher);

    await expect(store.saveAndVerify(createSnapshot(temporary('active', 'not saved'), 'snapshot'), true))
      .rejects.toThrow('synthetic storage failure');
    expect(await records.storage.getAllKeys()).toEqual([]);
  });

  it('restores the previous encrypted snapshot when an explicit update cannot be verified', async () => {
    const records = memoryStorage();
    const keys = memoryStorage();
    const originalStore = new SavedChatStore(records.storage, keys.storage, cipher);
    const original = createSnapshot(temporary('active', 'previous saved turn'), 'snapshot');
    await originalStore.saveAndVerify(original, true);
    const originalRecord = records.data.get('kalillac.saved.v1.snapshot');
    const brokenCipher: AuthenticatedCipher = {
      ...cipher,
      async encrypt() { return 'invalid-test-ciphertext'; },
    };
    const updatingStore = new SavedChatStore(records.storage, keys.storage, brokenCipher);
    const update = createSnapshot({
      ...temporary('active', 'new turn that cannot be verified'),
      savedCopyId: 'snapshot',
    }, 'snapshot', 'active');

    await expect(updatingStore.saveAndVerify(update)).rejects.toThrow('could not be verified');
    expect(records.data.get('kalillac.saved.v1.snapshot')).toBe(originalRecord);
    expect((await originalStore.load())[0].messages[0].content).toBe('previous saved turn');
  });

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

  it('waits for a durable stage checkpoint before starting encryption', async () => {
    const records = memoryStorage();
    const keys = memoryStorage();
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const checkpointReached = new Promise<void>(resolve => { reached = resolve; });
    let encryptionStarted = false;
    const store = new SavedChatStore(records.storage, keys.storage, {
      ...cipher,
      async encrypt(key, plaintext, id) {
        encryptionStarted = true;
        return cipher.encrypt(key, plaintext, id);
      },
    }, async event => {
      if (event.stage === 'encrypt_started') { reached(); await gate; }
    });
    const pending = store.saveAndVerify(createSnapshot(temporary('active', 'private'), 'snapshot'), true);
    await checkpointReached;
    expect(encryptionStarted).toBe(false);
    release();
    await pending;
    expect(encryptionStarted).toBe(true);
    expect(await store.load()).toHaveLength(1);
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