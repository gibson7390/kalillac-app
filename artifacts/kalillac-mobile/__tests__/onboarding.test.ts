import { describe, it, expect } from '@jest/globals';
import { isRevisit, shouldSkipOnboarding, parseOnboarded, ONBOARDING_POINTS } from '../utils/onboarding';

describe('onboarding utils', () => {
  it('detects revisit flag', () => {
    expect(isRevisit({ revisit: '1' })).toBe(true);
    expect(isRevisit({ revisit: ['true'] })).toBe(true);
    expect(isRevisit({})).toBe(false);
    expect(isRevisit(null)).toBe(false);
  });
  it('skips only when completed and not revisiting', () => {
    expect(shouldSkipOnboarding(true, false)).toBe(true);
    expect(shouldSkipOnboarding(true, true)).toBe(false);
    expect(shouldSkipOnboarding(false, false)).toBe(false);
  });
  it('parses stored boolean safely', () => {
    expect(parseOnboarded('{"hasOnboarded":true}')).toBe(true);
    expect(parseOnboarded('{"hasOnboarded":"yes"}')).toBeUndefined();
    expect(parseOnboarded('not json')).toBeUndefined();
    expect(parseOnboarded(null)).toBeUndefined();
  });
  it('copy stays truthful', () => {
    const text = ONBOARDING_POINTS.map((p) => p.title + ' ' + p.body).join(' ').toLowerCase();
    expect(text).not.toMatch(/never leaves|nothing leaves|end-to-end|fully private/);
    expect(text).toMatch(/ai provider/);
  });
});

import { safeReadPrefs, safeWritePrefs, applyOnboardingComplete, shouldSkipOnboarding as skip } from '../utils/onboarding';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (k: string) => map.get(k) ?? null,
    setItem: async (k: string, v: string) => { map.set(k, v); },
  };
}
const failing = {
  getItem: () => Promise.reject(new Error('read failed')),
  setItem: () => Promise.reject(new Error('write failed')),
};

describe('onboarding persistence', () => {
  it('persists completion and reads it back on next launch', async () => {
    const storage = memoryStorage();
    const { next, changed } = applyOnboardingComplete({ themeMode: 'system', hasOnboarded: false });
    expect(changed).toBe(true);
    await expect(safeWritePrefs(storage, 'k', next)).resolves.toBe(true);
    const raw = await safeReadPrefs(storage, 'k');
    expect(parseOnboarded(raw)).toBe(true);
    expect(skip(parseOnboarded(raw) ?? false, false)).toBe(true);
  });

  it('write failure resolves false without rejecting and keeps in-memory completion', async () => {
    const { next } = applyOnboardingComplete({ hasOnboarded: false });
    expect(next.hasOnboarded).toBe(true);
    await expect(safeWritePrefs(failing, 'k', next)).resolves.toBe(false);
    expect(skip(next.hasOnboarded, false)).toBe(true);
  });

  it('read failure resolves null so first run shows onboarding', async () => {
    const raw = await safeReadPrefs(failing, 'k');
    expect(raw).toBeNull();
    expect(skip(parseOnboarded(raw) ?? false, false)).toBe(false);
  });

  it('first run with empty storage shows onboarding', async () => {
    const raw = await safeReadPrefs(memoryStorage(), 'k');
    expect(skip(parseOnboarded(raw) ?? false, false)).toBe(false);
  });

  it('repeated completion is idempotent and does not rewrite', () => {
    const done = { hasOnboarded: true, themeMode: 'dark' };
    const result = applyOnboardingComplete(done);
    expect(result.changed).toBe(false);
    expect(result.next).toBe(done);
  });

  it('deliberate revisit still shows onboarding after completion', () => {
    expect(skip(true, isRevisit({ revisit: '1' }))).toBe(false);
  });
});
