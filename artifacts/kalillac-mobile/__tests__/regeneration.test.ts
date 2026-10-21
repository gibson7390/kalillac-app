import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { regenerationPlan, startRegeneration } from '../utils/regeneration';
import type { ChatMessage } from '../contexts/ChatRepositoryContext';

const messages: ChatMessage[] = [
  { id: 'u1', role: 'user', content: 'First prompt' },
  { id: 'a1', role: 'ai', content: 'First old answer', requestStatus: 'completed' },
  { id: 'u2', role: 'user', content: 'Second prompt' },
  { id: 'a2', role: 'ai', content: 'Second partial answer', requestStatus: 'api-failure', requestPrompt: 'Second prompt' },
];

describe('targeted regeneration / retry', () => {
  it('resolves the tapped answer and its source context, excluding old answer and later turns', () => {
    expect(regenerationPlan(messages, 'a1')).toMatchObject({
      assistantMessageId: 'a1', sourceUserMessageId: 'u1', prompt: 'First prompt',
      context: [{ role: 'user', content: 'First prompt' }],
    });
    expect(regenerationPlan(messages, 'a2')?.context).toEqual([
      { role: 'user', content: 'First prompt' },
      { role: 'assistant', content: 'First old answer' },
      { role: 'user', content: 'Second prompt' },
    ]);
    expect(regenerationPlan(messages, 'missing')).toBeUndefined();
    expect(regenerationPlan([{ id: 'orphan', role: 'ai', content: '' }], 'orphan')).toBeUndefined();
  });

  it('invokes cancellation reset, request state, and transport in order without adding/removing user messages', () => {
    const current = messages.map(message => ({ ...message }));
    const cancelled = new Set(['a2']);
    const stages: string[] = [];
    let active: string | undefined;
    for (let iteration = 0; iteration < 3; iteration++) {
      const plan = regenerationPlan(current, 'a2')!;
      startRegeneration(plan, {
        cancelPrevious: () => { stages.push('cancel'); },
        resetCancellation: id => { cancelled.delete(id); stages.push('reset'); },
        activate: id => { active = id; stages.push('activate'); },
        replaceAssistant: (id, patch) => { Object.assign(current.find(message => message.id === id)!, patch); stages.push('replace'); },
        beginRequest: (prompt, id) => { expect(prompt).toBe('Second prompt'); expect(id).toBe('a2'); stages.push('begin'); },
        run: (id, context) => {
          expect(cancelled.has(id)).toBe(false);
          expect(active).toBe(id);
          expect(context.at(-1)).toEqual({ role: 'user', content: 'Second prompt' });
          stages.push('transport', 'first-delta');
          Object.assign(current.find(message => message.id === id)!, {
            content: `Regenerated ${iteration}`, requestStatus: 'completed', isStreaming: false,
          });
          active = undefined;
          stages.push('completed');
        },
      });
    }
    expect(stages).toEqual(Array(3).fill(['cancel', 'reset', 'activate', 'replace', 'begin', 'transport', 'first-delta', 'completed']).flat());
    expect(current.filter(message => message.role === 'user')).toEqual(messages.filter(message => message.role === 'user'));
    expect(current.map(message => message.id)).toEqual(messages.map(message => message.id));
    expect(current[3]).toMatchObject({ content: 'Regenerated 2', retryCount: 3 });
  });

  it('wires native touch and handler diagnostics to the tapped message without changing scroll ownership', () => {
    const source = readFileSync(resolve(__dirname, '../app/(app)/chat/[id].tsx'), 'utf8');
    expect(source).toContain('onPress={() => handleRegenerate(item)}');
    expect(source).toContain('regenerate_touch_started');
    expect(source).toContain('minWidth: 44, minHeight: 44');
    expect(source).toContain('regenerate_pressed');
    expect(source).toContain('regenerate_first_delta');
    expect(source).toContain('regenerate_backend_request_started');
    expect(source).toContain('void runStream(session.id, targetId, context, true)');
    expect(source).not.toContain('aiMsgsToDrop');
  });
});
