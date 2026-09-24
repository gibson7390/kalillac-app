import { SavedChatStore, type RecordStorage, type KeyStorage, type AuthenticatedCipher } from './savedChatStore.ts';
import { Buffer } from 'buffer';

// Browser preview only: no durable key or records, no claim of native Keychain security.
const memory = new Map<string, string>();
const keyMemory = new Map<string, string>();
const records: RecordStorage = {
  async getItem(key) { return memory.get(key) ?? null; },
  async setItem(key, value) { memory.set(key, value); },
  async removeItem(key) { memory.delete(key); },
  async getAllKeys() { return [...memory.keys()]; },
};
const keys: KeyStorage = {
  async getItem(key) { return keyMemory.get(key) ?? null; },
  async setItem(key, value) { keyMemory.set(key, value); },
};
const cipher: AuthenticatedCipher = {
  async generateKey() {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    return Buffer.from(await crypto.subtle.exportKey('raw', key)).toString('base64');
  },
  async encrypt(rawKey, plaintext, id) {
    const key = await crypto.subtle.importKey('raw', Buffer.from(rawKey, 'base64'), 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const payload = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(id) },
      key, new TextEncoder().encode(plaintext),
    ));
    return Buffer.concat([Buffer.from(iv), Buffer.from(payload)]).toString('base64');
  },
  async decrypt(rawKey, sealed, id) {
    const key = await crypto.subtle.importKey('raw', Buffer.from(rawKey, 'base64'), 'AES-GCM', false, ['decrypt']);
    const bytes = Buffer.from(sealed, 'base64');
    if (bytes.length < 28) throw new Error('Invalid sealed data');
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: new TextEncoder().encode(id) },
      key, bytes.slice(12),
    );
    return new TextDecoder().decode(plaintext);
  },
};

export const savedChatStore = new SavedChatStore(records, keys, cipher);