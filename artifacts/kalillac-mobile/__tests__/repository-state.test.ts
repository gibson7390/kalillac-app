import { describe, expect, it } from '@jest/globals';
import {
  appendTemporarySession,
  cancelledRequestUpdates,
  removeSavedSession,
  requestStateForStart,
  updateMessageById,
  ChatMessage,
  ChatSession,
} from '../contexts/ChatRepositoryContext';

const session = (id: string): ChatSession => ({
  id,
  title: 'New Chat',
  createdAt: 1,
  updatedAt: 1,
  messages: [],
  mode: 'Auto',
  isTemporary: true,
  requestState: { status: 'idle', retryCount: 0 },
});

describe('temporary chat repository state', () => {
  it('appends a new temporary session without dropping existing sessions', () => {
    const first = session('first');
    const second = session('second');

    expect(appendTemporarySession([first], second).map(item => item.id)).toEqual(['first', 'second']);
  });

  it('preserves the prompt and increments retry metadata', () => {
    const first = requestStateForStart(undefined, 'keep this prompt', 'answer-1');
    const retry = requestStateForStart(first, first.prompt!, 'answer-2', true);

    expect(first.status).toBe('streaming');
    expect(retry.status).toBe('retrying');
    expect(retry.prompt).toBe('keep this prompt');
    expect(retry.retryCount).toBe(1);
  });

  it('keeps an earlier failed response retryable after a later request starts', () => {
    const firstFailure: ChatMessage = {
      id: 'answer-1',
      role: 'ai',
      content: '',
      requestStatus: 'api-failure',
      requestPrompt: 'first prompt',
      retryCount: 0,
    };
    const laterRequest: ChatMessage = {
      id: 'answer-2',
      role: 'ai',
      content: '',
      isStreaming: true,
      requestStatus: 'streaming',
      requestPrompt: 'second prompt',
      retryCount: 0,
    };

    const messages = updateMessageById(
      [firstFailure, laterRequest],
      laterRequest.id,
      { content: 'later answer', isStreaming: false, requestStatus: 'completed' },
    );

    expect(messages[0]).toMatchObject({
      requestStatus: 'api-failure',
      requestPrompt: 'first prompt',
    });
    expect(messages[1].requestStatus).toBe('completed');
  });

  it('marks a retained streaming response cancelled when its chat is left', () => {
    expect(cancelledRequestUpdates('unmounted')).toEqual({
      isStreaming: false,
      requestStatus: 'cancelled',
      requestError: 'unmounted',
    });
  });

  it('deletes only the selected saved snapshot', () => {
    const first = { ...session('saved-first'), isTemporary: false };
    const second = { ...session('saved-second'), isTemporary: false };

    expect(removeSavedSession([first, second], first.id).map(item => item.id)).toEqual(['saved-second']);
  });

  it('leaves saved snapshots and temporary sessions independent', () => {
    const temporary = session('temporary');
    const saved = { ...session('saved'), isTemporary: false };
    const activeSessions = [temporary];
    const savedSessions = [saved];

    expect(removeSavedSession(savedSessions, saved.id)).toEqual([]);
    expect(activeSessions).toEqual([temporary]);
    expect(savedSessions).toEqual([saved]);
  });
});