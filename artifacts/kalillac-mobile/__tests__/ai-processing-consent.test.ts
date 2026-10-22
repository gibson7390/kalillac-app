import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AIProcessingConsentStore, AI_CONSENT_KEY, AI_CONSENT_REQUIRED,
  parseAIConsent, consentStatusLabel, consentStorageNotice,
} from '../services/aiProcessingConsentState';

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { values.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { values.delete(key); }),
  };
}
let mockStorage = storage();
let mockConsent = new AIProcessingConsentStore(mockStorage);
const mockFetch = jest.fn<(...args: any[]) => Promise<Response>>();
jest.mock('expo/fetch', () => ({ fetch: (...args: unknown[]) => mockFetch(...args) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '12345678-1234-4234-8234-123456789abc' }));
jest.mock('../services/aiProcessingConsent', () => ({
  aiProcessingConsent: {
    getSnapshot: () => mockConsent.getSnapshot(),
    ensureAllowed: () => mockConsent.ensureAllowed(),
    assertAllowed: () => mockConsent.assertAllowed(),
    isAllowed: () => mockConsent.isAllowed(),
    subscribe: (listener: () => void) => mockConsent.subscribe(listener),
  },
}));
import { KalillacChatService } from '../services/KalillacChatService';

const context = [{ role: 'user' as const, content: 'Synthetic consent fixture question' }];
function answer() {
  return new Response(
    'event: delta\ndata: {"type":"delta","request_id":"fixture","text":"Synthetic answer"}\n\n' +
    'event: complete\ndata: {"type":"complete","request_id":"fixture"}\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  );
}
beforeEach(() => {
  mockFetch.mockReset();
  mockStorage = storage();
  mockConsent = new AIProcessingConsentStore(mockStorage);
});

describe('mobile hard network boundary', () => {
  it.each(['Send', 'Regenerate', 'Edit & resend', 'Retry'])('%s cannot invoke network while undecided', async action => {
    const started = jest.fn();
    await expect(new KalillacChatService(undefined, started).streamResponse(() => {}, action, context))
      .rejects.toMatchObject({ code: AI_CONSENT_REQUIRED });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(started).not.toHaveBeenCalled();
  });
  it('affirmative permission permits the mocked backend', async () => {
    await mockConsent.decide('allowed');
    mockFetch.mockResolvedValueOnce(answer());
    const chunks: string[] = [];
    await new KalillacChatService().streamResponse(text => chunks.push(text), 'Auto', context);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(chunks.at(-1)).toBe('Synthetic answer');
  });
  it.each(['Send', 'Regenerate', 'Edit & resend', 'Retry'])('%s cannot invoke network after declining or withdrawing', async action => {
    await mockConsent.decide('allowed');
    await mockConsent.decide('declined');
    await expect(new KalillacChatService().streamResponse(() => {}, action, context))
      .rejects.toMatchObject({ code: AI_CONSENT_REQUIRED });
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('old onboarding completion is not consent and is never migrated', async () => {
    mockStorage.values.set('@kalillac_prefs', '{"hasOnboarded":true}');
    await expect(new KalillacChatService().streamResponse(() => {}, 'Auto', context))
      .rejects.toMatchObject({ code: AI_CONSENT_REQUIRED });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockStorage.getItem).toHaveBeenCalledWith(AI_CONSENT_KEY);
    expect(mockStorage.setItem).not.toHaveBeenCalled();
  });
  it('a previously explicit allowed record can be restored without using onboarding', async () => {
    mockStorage.values.set(AI_CONSENT_KEY, '{"version":1,"state":"allowed"}');
    mockFetch.mockResolvedValueOnce(answer());
    await new KalillacChatService().streamResponse(() => {}, 'Auto', context);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it('a read failure fails closed without a network request', async () => {
    mockStorage.getItem.mockRejectedValueOnce(Error('fixture storage failure'));
    await expect(new KalillacChatService().streamResponse(() => {}, 'Auto', context))
      .rejects.toMatchObject({ code: AI_CONSENT_REQUIRED });
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('rechecks permission after callbacks immediately before fetch', async () => {
    await mockConsent.decide('allowed');
    const service = new KalillacChatService(undefined, () => { void mockConsent.decide('declined'); });
    await expect(service.streamResponse(() => {}, 'Auto', context)).rejects.toMatchObject({ code: AI_CONSENT_REQUIRED });
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('withdrawal aborts an already allowed active request and future requests remain blocked', async () => {
    await mockConsent.decide('allowed');
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    let signal!: AbortSignal;
    mockFetch.mockImplementationOnce((_url, options) => new Promise<Response>((_resolve, reject) => {
      signal = options.signal;
      signal.addEventListener('abort', () => {
        const error = Error('Stopped'); error.name = 'AbortError'; reject(error);
      });
      started();
    }));
    const pending = new KalillacChatService().streamResponse(() => {}, 'Auto', context);
    const rejected = expect(pending).rejects.toMatchObject({ code: AI_CONSENT_REQUIRED });
    await ready;
    await mockConsent.decide('declined');
    await rejected;
    expect(signal.aborted).toBe(true);
    await expect(new KalillacChatService().streamResponse(() => {}, 'Auto', context))
      .rejects.toMatchObject({ code: AI_CONSENT_REQUIRED });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it('does not emit late deltas when an uncooperative stream ignores abort', async () => {
    await mockConsent.decide('allowed');
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    mockFetch.mockImplementationOnce(async () => {
      started();
      return new Response(new ReadableStream<Uint8Array>({ start(c) { controller = c; } }));
    });
    const chunks: string[] = [];
    const pending = new KalillacChatService().streamResponse(text => chunks.push(text), 'Auto', context);
    const rejected = expect(pending).rejects.toMatchObject({ code: AI_CONSENT_REQUIRED });
    await ready;
    await mockConsent.decide('declined');
    controller.enqueue(new TextEncoder().encode(
      'event: delta\ndata: {"type":"delta","request_id":"fixture","text":"Late synthetic answer"}\n\n' +
      'event: complete\ndata: {"type":"complete","request_id":"fixture"}\n\n',
    ));
    controller.close();
    await rejected;
    expect(chunks).toEqual([]);
  });
});

describe('permission persistence is separate and fail-safe', () => {
  it.each([null, 'true', '{"hasOnboarded":true}', '{"version":0,"state":"allowed"}', 'corrupt'])(
    'does not interpret %s as permission', raw => expect(parseAIConsent(raw)).toBe('undecided'),
  );
  it('retains explicit permission only in memory if writing fails and clears a stale grant', async () => {
    mockStorage.setItem.mockRejectedValueOnce(Error('write failed'));
    await expect(mockConsent.decide('allowed')).resolves.toBe(false);
    expect(mockConsent.isAllowed()).toBe(true);
    expect(mockConsent.getSnapshot().persistence).toBe('session-only');
    expect(mockStorage.values.has(AI_CONSENT_KEY)).toBe(false);
    const nextLaunch = new AIProcessingConsentStore(mockStorage);
    await expect(nextLaunch.ensureAllowed()).rejects.toMatchObject({ code: AI_CONSENT_REQUIRED });
    mockFetch.mockResolvedValueOnce(answer());
    await new KalillacChatService().streamResponse(() => {}, 'Auto', context);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it('withdrawal write failure falls back to clearing only the consent record', async () => {
    const savedSnapshot = 'SYNTHETIC_ENCRYPTED_RECORD';
    mockStorage.values.set('saved-fixture', savedSnapshot);
    await mockConsent.decide('allowed');
    mockStorage.setItem.mockRejectedValueOnce(Error('write failed'));
    await mockConsent.decide('declined');
    expect(mockConsent.isAllowed()).toBe(false);
    expect(mockStorage.removeItem).toHaveBeenCalledWith(AI_CONSENT_KEY);
    const nextLaunch = new AIProcessingConsentStore(mockStorage);
    await expect(nextLaunch.ensureAllowed()).rejects.toMatchObject({ code: AI_CONSENT_REQUIRED });
    expect(mockStorage.values.get('saved-fixture')).toBe(savedSnapshot);
    expect([...mockStorage.values.keys()]).toEqual(['saved-fixture']);
  });
  it('warns explicitly if both writing and clearing fail rather than claiming durable withdrawal', async () => {
    await mockConsent.decide('allowed');
    mockStorage.setItem.mockRejectedValueOnce(Error('write failed'));
    mockStorage.removeItem.mockRejectedValueOnce(Error('remove failed'));
    await mockConsent.decide('declined');
    expect(mockConsent.isAllowed()).toBe(false);
    expect(mockConsent.getSnapshot().persistence).toBe('unavailable');
    expect(consentStorageNotice(mockConsent.getSnapshot())).toMatch(/previous saved choice may return/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('declining leaves local Saved data and preferences untouched', async () => {
    mockStorage.values.set('saved-fixture', 'SYNTHETIC_SNAPSHOT');
    mockStorage.values.set('@kalillac_prefs', '{"hasOnboarded":true}');
    await mockConsent.decide('declined');
    expect(mockStorage.values.get('saved-fixture')).toBe('SYNTHETIC_SNAPSHOT');
    expect(mockStorage.values.get('@kalillac_prefs')).toBe('{"hasOnboarded":true}');
    expect(mockStorage.setItem.mock.calls.every(([key]) => key === AI_CONSENT_KEY)).toBe(true);
  });
  it('a slow initial read cannot overwrite an explicit newer decline', async () => {
    let finishRead!: (value: string) => void;
    mockStorage.getItem.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
    const loading = mockConsent.load();
    await mockConsent.decide('declined');
    finishRead('{"version":1,"state":"allowed"}');
    await loading;
    expect(mockConsent.isAllowed()).toBe(false);
    expect(mockConsent.getSnapshot().state).toBe('declined');
  });
  it('serializes grant/withdraw writes so final durable state matches the latest choice', async () => {
    let release!: () => void;
    mockStorage.setItem.mockImplementationOnce(async (key, value) => {
      await new Promise<void>(resolve => { release = resolve; });
      mockStorage.values.set(key, value);
    });
    const allowed = mockConsent.decide('allowed');
    await Promise.resolve();
    const declined = mockConsent.decide('declined');
    expect(mockConsent.isAllowed()).toBe(false);
    release();
    await Promise.all([allowed, declined]);
    expect(parseAIConsent(mockStorage.values.get(AI_CONSENT_KEY)!)).toBe('declined');
  });
  it('has distinct review labels for undecided, allowed, and declined', async () => {
    await mockConsent.load();
    expect(consentStatusLabel(mockConsent.getSnapshot())).toBe('Not yet decided');
    await mockConsent.decide('allowed');
    expect(consentStatusLabel(mockConsent.getSnapshot())).toBe('Allowed');
    await mockConsent.decide('declined');
    expect(consentStatusLabel(mockConsent.getSnapshot())).toBe('Not allowed');
  });
});

describe('UI wiring preserves M4A and offers review rather than intrusive navigation alerts', () => {
  const read = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8');
  it('guards send/edit-resend and regeneration/retry before transcript changes', () => {
    const chat = read('app/(app)/chat/[id].tsx');
    const send = chat.slice(chat.indexOf('  const handleSend'), chat.indexOf('  const handleStop'));
    expect(send.indexOf('ensureAIConsent()')).toBeLessThan(send.indexOf('replaceUserMessageAndAfter'));
    const regenerate = chat.slice(chat.indexOf('  const handleRegenerate'), chat.indexOf('  const handleEdit'));
    expect(regenerate.indexOf('ensureAIConsent()')).toBeLessThan(regenerate.indexOf('deleteMessageAndAfter'));
    expect(chat).toMatch(/const handleRetryMessage[\s\S]*?handleRegenerate\(message\)/);
    expect(chat).toContain('onReviewConsent={reviewAIProcessing}');
  });
  it('offers explicit allow/decline and accessible Settings/Privacy review paths', () => {
    const onboarding = read('app/onboarding.tsx');
    expect(onboarding).toContain('Allow AI processing');
    expect(onboarding).toContain('Not now');
    expect(onboarding).toContain('Turn off AI processing');
    expect(onboarding).toContain("aiProcessingConsent.decide('allowed')");
    expect(onboarding).toContain("aiProcessingConsent.decide('declined')");
    expect(read('app/(app)/(tabs)/settings.tsx')).toContain('review permission');
    expect(read('app/(app)/privacy.tsx')).toContain('accessibilityLabel="Review AI processing"');
    expect(read('app/(app)/privacy.tsx')).toContain('Current provider disclosure');
  });
});
