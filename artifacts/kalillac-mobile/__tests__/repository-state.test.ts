import { describe, expect, it, jest } from '@jest/globals';
jest.mock('../services/savedChatAdapter', () => ({ savedChatStore: {} }));
import {
  appendTemporarySession,
  cancelledRequestUpdates,
  deleteLogicalConversationState,
  hasSavedSnapshotAssociation,
  meaningfulActiveSessions,
  requestStateForStart,
  resolveLogicalConversationId,
  saveSnapshotState,
  updateMessageById,
  updateSessionMessageById,
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

  it('resolves a saved row to its logical conversation ID', () => {
    const first = {
      ...session('saved-first'),
      isTemporary: false,
      sourceConversationId: 'conversation',
    };
    const second = { ...session('saved-second'), isTemporary: false };
    const active = { ...session('conversation'), savedCopyId: first.id };

    expect(resolveLogicalConversationId([active], [first, second], first.id)).toBe('conversation');
  });

  it('deletes an unsaved logical conversation without touching unrelated snapshots', () => {
    const temporary = session('temporary');
    const saved = { ...session('saved'), isTemporary: false };
    const unrelated = session('unrelated');

    const next = deleteLogicalConversationState([temporary, unrelated], [saved], temporary.id);

    expect(next.activeSessions.map(item => item.id)).toEqual(['unrelated']);
    expect(next.savedSessions).toEqual([saved]);
  });

  it('deletes a saved logical conversation from both Active Chats and Saved', () => {
    const linked = { ...session('continued-copy'), savedCopyId: 'saved' };
    const unrelated = { ...session('unrelated'), savedCopyId: 'other-saved' };
    const saved = { ...session('saved'), isTemporary: false, sourceConversationId: 'original-conversation' };
    const otherSaved = { ...session('other-saved'), isTemporary: false };

    const logicalId = resolveLogicalConversationId([linked, unrelated], [saved, otherSaved], saved.id);
    const next = deleteLogicalConversationState([linked, unrelated], [saved, otherSaved], logicalId!);

    expect(logicalId).toBe('original-conversation');
    expect(next.savedSessions.map(item => item.id)).toEqual(['other-saved']);
    expect(next.activeSessions.map(item => item.id)).toEqual(['unrelated']);
  });

  it('creates one saved snapshot and links it to the temporary conversation', () => {
    const temporary = session('temporary');
    const snapshot = { ...session('saved'), isTemporary: false, sourceConversationId: temporary.id };

    const next = saveSnapshotState([temporary], [], temporary.id, snapshot);

    expect(next.savedSessions).toEqual([snapshot]);
    expect(next.activeSessions[0].savedCopyId).toBe(snapshot.id);
    expect(hasSavedSnapshotAssociation(next.activeSessions[0])).toBe(true);
    expect(resolveLogicalConversationId(next.activeSessions, next.savedSessions, snapshot.id)).toBe(temporary.id);
  });

  it('deletes a temporary conversation without a saved copy', () => {
    const target = session('target');
    const unrelated = session('unrelated');
    const saved = { ...session('saved'), isTemporary: false };

    const next = deleteLogicalConversationState([target, unrelated], [saved], target.id);

    expect(next.activeSessions.map(item => item.id)).toEqual(['unrelated']);
    expect(next.savedSessions.map(item => item.id)).toEqual(['saved']);
  });

  it('deletes a temporary conversation and only its linked saved copy', () => {
    const target = { ...session('target'), savedCopyId: 'target-saved' };
    const unrelated = { ...session('unrelated'), savedCopyId: 'other-saved' };
    const targetSaved = { ...session('target-saved'), isTemporary: false };
    const otherSaved = { ...session('other-saved'), isTemporary: false };

    const next = deleteLogicalConversationState(
      [target, unrelated],
      [targetSaved, otherSaved],
      target.id,
    );

    expect(next.activeSessions.map(item => item.id)).toEqual(['unrelated']);
    expect(next.savedSessions.map(item => item.id)).toEqual(['other-saved']);
  });

  it('does not present empty temporary sessions as active chats', () => {
    const empty = session('empty');
    const started = {
      ...session('started'),
      messages: [{ id: 'message', role: 'user' as const, content: 'Hello' }],
    };

    expect(meaningfulActiveSessions([empty, started]).map(item => item.id)).toEqual(['started']);
  });

  it('ignores late message deltas after an active conversation is deleted', () => {
    const streaming = {
      ...session('streaming'),
      messages: [{
        id: 'answer',
        role: 'ai' as const,
        content: 'partial',
        isStreaming: true,
        requestStatus: 'streaming' as const,
      }],
    };
    const deleted = deleteLogicalConversationState([streaming], [], streaming.id);
    const afterLateDelta = updateSessionMessageById(
      deleted.activeSessions,
      streaming.id,
      'answer',
      { content: 'late content', isStreaming: false },
    );

    expect(afterLateDelta).toEqual([]);
  });

  it('supports the canonical save, delete-from-saved, and delete-from-chat lifecycle', () => {
    const conversation = {
      ...session('conversation'),
      title: 'Meaningful chat',
      messages: [{ id: 'prompt', role: 'user' as const, content: 'Keep this chat' }],
    };
    const firstSnapshot = {
      ...conversation,
      id: 'saved-first',
      isTemporary: false,
       sourceConversationId: conversation.id,
    };

    const firstSave = saveSnapshotState([conversation], [], conversation.id, firstSnapshot);
    expect(firstSave.savedSessions).toHaveLength(1);
    expect(hasSavedSnapshotAssociation(firstSave.activeSessions[0])).toBe(true);

    const deletedFromSaved = deleteLogicalConversationState(
      firstSave.activeSessions,
      firstSave.savedSessions,
      resolveLogicalConversationId(firstSave.activeSessions, firstSave.savedSessions, firstSnapshot.id)!,
    );
    expect(deletedFromSaved.activeSessions).toEqual([]);
    expect(deletedFromSaved.savedSessions).toEqual([]);

    const secondSnapshot = {
      ...conversation,
      id: 'saved-second',
      isTemporary: false,
       sourceConversationId: conversation.id,
    };
    const secondSave = saveSnapshotState(
      [conversation],
      [],
      conversation.id,
      secondSnapshot,
    );
    expect(secondSave.savedSessions.map(item => item.id)).toEqual(['saved-second']);
    expect(secondSave.activeSessions[0].savedCopyId).toBe('saved-second');

    const deleted = deleteLogicalConversationState(
      secondSave.activeSessions,
      secondSave.savedSessions,
      conversation.id,
    );
    expect(deleted.activeSessions).toEqual([]);
    expect(deleted.savedSessions).toEqual([]);
  });
});