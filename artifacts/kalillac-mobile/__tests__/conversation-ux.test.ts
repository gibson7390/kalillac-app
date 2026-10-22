import { describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  canStartGeneration, cancelledEditDraft, copyMessage, editResendPlan,
  editedConversation, replaceActiveBranch, shouldShowLatest,
} from '../utils/conversationUX';
import { chatErrorPresentation } from '../utils/chatErrorPresentation';
import { MODE_DESCRIPTIONS } from '../constants/modes';
import { regenerationPlan } from '../utils/regeneration';
import type { ChatMessage, ChatSession } from '../contexts/ChatRepositoryContext';

const messages: ChatMessage[] = [
  { id: 'u1', role: 'user', content: 'First question' },
  { id: 'a1', role: 'ai', content: 'First answer', requestStatus: 'completed' },
  { id: 'u2', role: 'user', content: 'Later question' },
  { id: 'a2', role: 'ai', content: 'Later answer', requestStatus: 'completed' },
];

describe('edit and resend', () => {
  it('replaces an earlier user turn and removes all downstream messages without mutation', () => {
    const original = JSON.stringify(messages);
    expect(editedConversation(messages, 'u1', '  Corrected  ')).toEqual([{ ...messages[0], content: 'Corrected' }]);
    expect(JSON.stringify(messages)).toBe(original);
  });
  it('keeps the chronological prefix and ends transport context at the corrected user turn', () => {
    const plan = editResendPlan(messages, 'u2', 'Changed')!;
    expect(plan.messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2']);
    expect(plan.context).toEqual([
      { role: 'user', content: 'First question' }, { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Changed' },
    ]);
    expect(regenerationPlan(messages, 'a1')?.context).toEqual([{ role: 'user', content: 'First question' }]);
  });
  it.each(['a1', 'missing'])('rejects invalid edit target %s', target => {
    expect(editResendPlan(messages, target, 'Changed')).toBeUndefined();
  });
  it('rejects empty edits and cancellation restores the unsent draft without touching transcript', () => {
    expect(editResendPlan(messages, 'u1', ' \n ')).toBeUndefined();
    expect(cancelledEditDraft({ messageId: 'u1', previousDraft: 'My unsent\nnext question' })).toBe('My unsent\nnext question');
    expect(messages).toHaveLength(4);
  });
  it('changes only active state even when a Saved snapshot shares the original messages array', () => {
    const active: ChatSession = {
      id: 'active', title: 'Test', createdAt: 1, updatedAt: 1,
      messages, mode: 'Auto', isTemporary: true, savedCopyId: 'saved',
    };
    const saved = { ...active, id: 'saved', isTemporary: false };
    const original = JSON.stringify(saved);
    const next = replaceActiveBranch([active], 'active', 'u1', 'New question');
    expect(next[0].messages).toHaveLength(1);
    expect(next[0].savedCopyId).toBe('saved');
    expect(JSON.stringify(saved)).toBe(original);
    expect(saved.messages).toHaveLength(4);
  });
  it('does not silently truncate long drafts or duplicate server character policies', () => {
    const long = 'x'.repeat(6000);
    expect(editResendPlan(messages, 'u1', long)?.context[0].content).toBe(long);
  });
});

describe('generation and scroll controls', () => {
  it('blocks duplicate submission even before React renders the generating state', () => {
    let active: string | null = null;
    let calls = 0;
    const send = () => {
      if (!canStartGeneration('Question', false, active)) return;
      active = 'answer';
      calls++;
    };
    send(); send();
    expect(calls).toBe(1);
    expect(canStartGeneration(' ', false, null)).toBe(false);
    expect(canStartGeneration('Question', true, null)).toBe(false);
  });
  it.each([[0, 2, false], [180, 2, false], [181, 2, true], [1000, 0, false], [NaN, 2, false], [-10, 2, false]])(
    'Latest visibility at offset %s with %s messages', (offset, count, expected) => {
      expect(shouldShowLatest(offset as number, count as number)).toBe(expected);
    });
  it('has user-level descriptions for every existing mode without model/token claims', () => {
    expect(MODE_DESCRIPTIONS).toEqual({
      Auto: 'Kalillac chooses', Fast: 'Quick answers', Smart: 'Balanced reasoning', Deep: 'More thorough',
    });
    expect(Object.values(MODE_DESCRIPTIONS).join(' ')).not.toMatch(/model|token|provider/i);
  });
});

describe('copy feedback', () => {
  it.each(['A full user message\nwith lines', 'Answer\n```ts\nconst a = 1;\n```'])('copies full text intact', async text => {
    const write = jest.fn<(text: string) => Promise<void>>().mockResolvedValue();
    const announce = jest.fn();
    expect(await copyMessage(text, write, announce)).toBe(true);
    expect(write).toHaveBeenCalledWith(text);
    expect(announce).toHaveBeenCalledWith('Message copied');
  });
  it('handles clipboard and announcement failures without alerts or raw errors', async () => {
    const announce = jest.fn();
    expect(await copyMessage('text', async () => { throw new Error('RAW_KEY_SENTINEL'); }, announce)).toBe(false);
    expect(announce).toHaveBeenCalledWith("Couldn't copy. Try again.");
    expect(await copyMessage('text', async () => {}, () => { throw Error('announcement'); })).toBe(true);
  });
});

describe('safe error UX', () => {
  it.each([
    ['provider-timeout', 'That took too long'],
    ['server-busy', 'Kalillac is busy'],
    ['rate-limited', 'A short pause'],
    ['provider-rate-limited', 'A short pause'],
    ['provider-unavailable', 'Response interrupted'],
    ['current-information-unavailable', 'Current web information unavailable'],
    ['backend-unreachable', 'Can’t reach Kalillac'],
  ])('maps %s to plain retry guidance', (code, title) => {
    expect(chatErrorPresentation('api-failure', code)).toMatchObject({ title, retry: true });
  });
  it.each(['invalid-request', 'budget-exceeded', 'policy-refusal'])('does not retry unchanged %s', code => {
    expect(chatErrorPresentation('api-failure', code).retry).toBe(false);
  });
  it('never displays raw unknown codes or credential-bearing error strings', () => {
    const error = chatErrorPresentation('api-failure', 'OpenRouter RAW_KEY_SENTINEL stack trace account:123');
    expect(JSON.stringify(error)).not.toMatch(/OpenRouter|SENTINEL|stack trace|account:123/);
    expect(chatErrorPresentation('cancelled').retry).toBe(true);
    expect(chatErrorPresentation('offline').title).toBe('Check your connection');
  });
  it('wires important accessible controls without changing inverted-list ownership', () => {
    const source = readFileSync(resolve(__dirname, '../app/(app)/chat/[id].tsx'), 'utf8');
    for (const label of ['Copy response', 'Copy your message', 'Cancel editing', 'Scroll to latest message', 'Resend edited message']) {
      expect(source).toContain(label);
    }
    expect(source).toContain('activeMessageIdRef.current = aiMessageId');
    expect(source).toContain('inverted');
    expect(source).toContain('removeClippedSubviews={false}');
    expect(source).not.toContain('maxLength={2000}');
    expect(source).not.toContain('maintainVisibleContentPosition');
  });
});
