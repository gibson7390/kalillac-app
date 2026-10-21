import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { snapshotForStorage } from '../services/savedChatStore.ts';
import * as webAdapter from '../services/savedChatStore.web';

describe('platform-safe snapshot helper resolution', () => {
  it('selects the explicit shared module rather than a platform adapter lacking helpers', () => {
    expect(typeof snapshotForStorage).toBe('function');
    expect('snapshotForStorage' in webAdapter).toBe(false);
    const repository = readFileSync(resolve(__dirname, '../contexts/ChatRepositoryContext.tsx'), 'utf8');
    expect(repository.includes("import { snapshotForStorage } from '../services/savedChatStore.ts'")).toBe(true);
    expect(repository.includes("from '../services/savedChatStore';")).toBe(false);
    for (const platform of ['native', 'web']) {
      const adapter = readFileSync(resolve(__dirname, `../services/savedChatStore.${platform}.ts`), 'utf8');
      expect(adapter.includes("from './savedChatStore.ts'")).toBe(true);
    }
  });
});
