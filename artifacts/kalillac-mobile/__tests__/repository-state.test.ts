import { describe, expect, it } from '@jest/globals';
import {
  appendTemporarySession,
  cancelledRequestUpdates,
  clearSavedSessionAssociation,
  deleteSavedSnapshotState,
  deleteTemporaryConversationState,
  hasSavedSnapshotAssociation,
  meaningfulActiveSessions,
  removeSavedSession,
  requestStateForStart,
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

  it('clears the live conversation link when its saved snapshot is deleted', () => {
    const linked = { ...session('temporary'), savedCopyId: 'saved' };
    const unrelated = { ...session('unrelated'), savedCopyId: 'other-saved' };
    const saved = { ...session('saved'), isTemporary: false };
    const otherSaved = { ...session('other-saved'), isTemporary: false };

    const next = deleteSavedSnapshotState([linked, unrelated], [saved, otherSaved], saved.id);

    expect(next.savedSessions.map(item => item.id)).toEqual(['other-saved']);
    expect(next.activeSessions[0].savedCopyId).toBeUndefined();
    expect(next.activeSessions[1].savedCopyId).toBe('other-saved');
  });

  it('creates one saved snapshot and links it to the temporary conversation', () => {
    const temporary = session('temporary');
    const snapshot = { ...session('saved'), isTemporary: false };

    const next = saveSnapshotState([temporary], [], temporary.id, snapshot);

    expect(next.savedSessions).toEqual([snapshot]);
    expect(next.activeSessions[0].savedCopyId).toBe(snapshot.id);
    expect(hasSavedSnapshotAssociation(next.activeSessions[0])).toBe(true);
  });

  it('allows an unsaved conversation to be linked to a new snapshot again', () => {
    const linked = { ...session('temporary'), savedCopyId: 'old-saved' };
    const [unsaved] = clearSavedSessionAssociation([linked], 'old-saved');
    const resaved = { ...unsaved, savedCopyId: 'new-saved' };

    expect(unsaved.savedCopyId).toBeUndefined();
    expect(hasSavedSnapshotAssociation(unsaved)).toBe(false);
    expect(resaved.savedCopyId).toBe('new-saved');
    expect(hasSavedSnapshotAssociation(resaved)).toBe(true);
  });

  it('deletes only a temporary conversation that has no saved copy', () => {
    const target = session('target');
    const unrelated = session('unrelated');
    const saved = { ...session('saved'), isTemporary: false };

    const next = deleteTemporaryConversationState([target, unrelated], [saved], target.id);

    expect(next.activeSessions.map(item => item.id)).toEqual(['unrelated']);
    expect(next.savedSessions.map(item => item.id)).toEqual(['saved']);
  });

  it('deletes a temporary conversation and only its linked saved copy', () => {
    const target = { ...session('target'), savedCopyId: 'target-saved' };
    const unrelated = { ...session('unrelated'), savedCopyId: 'other-saved' };
    const targetSaved = { ...session('target-saved'), isTemporary: false };
    const otherSaved = { ...session('other-saved'), isTemporary: false };

    const next = deleteTemporaryConversationState(
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
    const deleted = deleteTemporaryConversationState([streaming], [], streaming.id);
    const afterLateDelta = updateSessionMessageById(
      deleted.activeSessions,
      streaming.id,
      'answer',
      { content: 'late content', isStreaming: false },
    );

    expect(afterLateDelta).toEqual([]);
  });

  it('supports the canonical save, unsave, resave, and delete-both lifecycle', () => {
    const conversation = {
      ...session('conversation'),
      title: 'Meaningful chat',
      messages: [{ id: 'prompt', role: 'user' as const, content: 'Keep this chat' }],
    };
    const firstSnapshot = {
      ...conversation,
      id: 'saved-first',
      isTemporary: false,
    };

    const firstSave = saveSnapshotState([conversation], [], conversation.id, firstSnapshot);
    expect(firstSave.savedSessions).toHaveLength(1);
    expect(hasSavedSnapshotAssociation(firstSave.activeSessions[0])).toBe(true);

    const unsaved = deleteSavedSnapshotState(
      firstSave.activeSessions,
      firstSave.savedSessions,
      firstSnapshot.id,
    );
    expect(unsaved.savedSessions).toEqual([]);
    expect(hasSavedSnapshotAssociation(unsaved.activeSessions[0])).toBe(false);

    const secondSnapshot = {
      ...conversation,
      id: 'saved-second',
      isTemporary: false,
    };
    const secondSave = saveSnapshotState(
      unsaved.activeSessions,
      unsaved.savedSessions,
      conversation.id,
      secondSnapshot,
    );
    expect(secondSave.savedSessions.map(item => item.id)).toEqual(['saved-second']);
    expect(secondSave.activeSessions[0].savedCopyId).toBe('saved-second');

    const deleted = deleteTemporaryConversationState(
      secondSave.activeSessions,
      secondSave.savedSessions,
      conversation.id,
    );
    expect(deleted.activeSessions).toEqual([]);
    expect(deleted.savedSessions).toEqual([]);
  });
});