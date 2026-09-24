import { createContext, useContext, useState, useRef, useEffect, ReactNode, useCallback } from 'react';
import { generateId } from '../utils/uuid';
import { createSnapshot } from '../utils/snapshot';
import { savedChatStore } from '../services/savedChatAdapter';

export type AIModelMode = 'Auto' | 'Fast' | 'Smart' | 'Deep';
export type ChatRequestStatus =
  | 'idle'
  | 'streaming'
  | 'completed'
  | 'offline'
  | 'api-failure'
  | 'cancelled'
  | 'retrying';

export interface ChatRequestState {
  status: ChatRequestStatus;
  prompt?: string;
  messageId?: string;
  error?: string;
  retryCount: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface ChatAttachment {
  id: string;
  name: string;
  type: 'image' | 'pdf' | 'doc';
  size: number;
  uri?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  content: string;
  isStreaming?: boolean;
  attachments?: ChatAttachment[];
  modeUsed?: AIModelMode;
  requestStatus?: ChatRequestStatus;
  requestPrompt?: string;
  requestError?: string;
  retryCount?: number;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  mode: AIModelMode;
  isTemporary: boolean;
  /** Volatile request metadata; deliberately not persisted between app launches. */
  requestState?: ChatRequestState;
  corrupted?: boolean;
  savedCopyId?: string;
  /** Stable logical conversation ID shared by saved backings and resumed copies. */
  sourceConversationId?: string;
}

/** Keep existing in-memory conversations when opening another temporary chat. */
export function appendTemporarySession(sessions: ChatSession[], session: ChatSession): ChatSession[] {
  return [...sessions, session];
}

export function updateMessageById(
  messages: ChatMessage[],
  messageId: string,
  updates: Partial<ChatMessage>,
): ChatMessage[] {
  return messages.map(message => message.id === messageId ? { ...message, ...updates } : message);
}

export function updateSessionMessageById(
  sessions: ChatSession[],
  sessionId: string,
  messageId: string,
  updates: Partial<ChatMessage>,
): ChatSession[] {
  return sessions.map(session => session.id === sessionId
    ? { ...session, messages: updateMessageById(session.messages, messageId, updates) }
    : session);
}

export function cancelledRequestUpdates(reason = 'cancelled'): Partial<ChatMessage> {
  return {
    isStreaming: false,
    requestStatus: 'cancelled',
    requestError: reason,
  };
}

export function resolveLogicalConversationId(
  activeSessions: ChatSession[],
  savedSessions: ChatSession[],
  id: string,
): string {
  const activeSession = activeSessions.find(session => session.id === id);
  if (activeSession) return activeSession.sourceConversationId ?? activeSession.id;

  const savedSession = savedSessions.find(session => session.id === id);
  if (!savedSession) return id;

  const linkedActive = activeSessions.find(session => session.savedCopyId === savedSession.id);
  return savedSession.sourceConversationId
    ?? linkedActive?.sourceConversationId
    ?? linkedActive?.id
    ?? savedSession.id;
}

export function deleteLogicalConversationState(
  activeSessions: ChatSession[],
  savedSessions: ChatSession[],
  logicalConversationId: string,
): { activeSessions: ChatSession[]; savedSessions: ChatSession[] } {
  const linkedSavedIds = new Set(
    savedSessions
      .filter(saved => saved.id === logicalConversationId
        || (saved.sourceConversationId ?? saved.id) === logicalConversationId)
      .map(saved => saved.id),
  );
  const activeIdsToDelete = new Set(
    activeSessions
      .filter(session => (
        session.id === logicalConversationId
        || session.sourceConversationId === logicalConversationId
        || (session.savedCopyId && linkedSavedIds.has(session.savedCopyId))
      ))
      .map(session => session.id),
  );

  activeSessions.forEach(session => {
    if (activeIdsToDelete.has(session.id) && session.savedCopyId) {
      linkedSavedIds.add(session.savedCopyId);
    }
  });

  return {
    activeSessions: activeSessions.filter(session => !activeIdsToDelete.has(session.id)),
    savedSessions: savedSessions.filter(saved => !linkedSavedIds.has(saved.id)),
  };
}

export function meaningfulActiveSessions(sessions: ChatSession[]): ChatSession[] {
  return sessions.filter(session => session.messages.length > 0);
}

export function saveSnapshotState(
  activeSessions: ChatSession[],
  savedSessions: ChatSession[],
  temporarySessionId: string,
  snapshot: ChatSession,
): { activeSessions: ChatSession[]; savedSessions: ChatSession[] } {
  const linkedSnapshot = {
    ...snapshot,
    sourceConversationId: snapshot.sourceConversationId ?? temporarySessionId,
  };

  return {
    activeSessions: activeSessions.map(session => session.id === temporarySessionId
      ? { ...session, savedCopyId: linkedSnapshot.id }
      : session),
    savedSessions: [linkedSnapshot, ...savedSessions],
  };
}

export function hasSavedSnapshotAssociation(session: ChatSession): boolean {
  return !!session.savedCopyId;
}

export function requestStateForStart(
  previous: ChatRequestState | undefined,
  prompt: string,
  messageId: string,
  retry = false,
): ChatRequestState {
  return {
    status: retry ? 'retrying' : 'streaming',
    prompt,
    messageId,
    retryCount: (previous?.retryCount ?? 0) + (retry ? 1 : 0),
    startedAt: Date.now(),
    error: undefined,
    finishedAt: undefined,
  };
}

interface ChatRepositoryState {
  activeSessions: ChatSession[];
  savedSessions: ChatSession[];
  savedLoaded: boolean;
  savedLoadError: boolean;
  currentSessionId: string | null;
  createSession: (mode?: AIModelMode) => string;
  continueSavedSession: (savedId: string) => string;
  deleteLogicalConversation: (id: string) => Promise<void>;
  registerRequestCancellation: (sessionId: string, cancel: () => void) => () => void;
  clearAllTemporary: () => void;
  getSession: (id: string) => ChatSession | undefined;
  addMessage: (sessionId: string, message: ChatMessage) => void;
  updateMessage: (sessionId: string, messageId: string, updates: Partial<ChatMessage>) => void;
  beginRequest: (sessionId: string, prompt: string, messageId: string, retry?: boolean) => void;
  updateRequestState: (sessionId: string, updates: Partial<ChatRequestState> & { status: ChatRequestStatus }) => void;
  deleteMessageAndAfter: (sessionId: string, messageId: string) => void;
  saveSession: (sessionId: string) => Promise<string>;
  updateSavedSession: (temporarySessionId: string, savedSessionId: string) => Promise<void>;
  corruptRandomSession: () => void;
}

const ChatRepositoryContext = createContext<ChatRepositoryState | null>(null);

export function ChatRepositoryProvider({ children }: { children: ReactNode }) {
  const [activeSessions, setActiveSessions] = useState<ChatSession[]>([]);
  const [savedSessions, setSavedSessions] = useState<ChatSession[]>([]);
  const [savedLoaded, setSavedLoaded] = useState(false);
  const [savedLoadError, setSavedLoadError] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const requestCancellationsRef = useRef(new Map<string, () => void>());
  const deletedSessionIdsRef = useRef(new Set<string>());

  useEffect(() => {
    let mounted = true;
    savedChatStore.load().then(sessions => {
      if (mounted) setSavedSessions(sessions);
    }).catch(() => {
      if (mounted) setSavedLoadError(true);
    }).finally(() => {
      if (mounted) setSavedLoaded(true);
    });
    return () => { mounted = false; };
  }, []);

  const createSession = useCallback((mode: AIModelMode = 'Auto') => {
    const id = generateId();
    const newSession: ChatSession = {
      id,
      title: 'New Chat',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      mode,
      isTemporary: true,
      requestState: { status: 'idle', retryCount: 0 },
    };
    setActiveSessions(prev => appendTemporarySession(prev, newSession));
    setCurrentSessionId(id);
    return id;
  }, []);

  const continueSavedSession = useCallback((savedId: string) => {
    const saved = savedSessions.find(s => s.id === savedId);
    if (!saved) throw new Error('Saved snapshot not found');
    const id = generateId();
    const copy = createSnapshot(saved, id);
    setActiveSessions(prev => appendTemporarySession(prev, {
      ...copy,
      isTemporary: true,
      requestState: { status: 'idle', retryCount: 0 },
      savedCopyId: savedId,
      corrupted: saved.corrupted,
    }));
    setCurrentSessionId(id);
    return id;
  }, [savedSessions]);

  const registerRequestCancellation = useCallback((sessionId: string, cancel: () => void) => {
    requestCancellationsRef.current.set(sessionId, cancel);
    return () => {
      if (requestCancellationsRef.current.get(sessionId) === cancel) {
        requestCancellationsRef.current.delete(sessionId);
      }
    };
  }, []);

  const deleteLogicalConversation = useCallback(async (logicalConversationId: string) => {
    const activeTarget = activeSessions.find(s => s.id === logicalConversationId);
    if ((!savedLoaded || savedLoadError)
      && (!activeTarget || activeTarget.savedCopyId)) {
      throw new Error('Saved chats are unavailable');
    }
    const logicalId = resolveLogicalConversationId(activeSessions, savedSessions, logicalConversationId);
    const next = deleteLogicalConversationState(activeSessions, savedSessions, logicalId);
    const removedSaved = savedSessions.filter(saved =>
      !next.savedSessions.some(remaining => remaining.id === saved.id));
    const deletedActiveIds = new Set(
      activeSessions
        .filter(session => !next.activeSessions.some(remaining => remaining.id === session.id))
        .map(session => session.id),
    );
    deletedActiveIds.forEach(sessionId => {
      deletedSessionIdsRef.current.add(sessionId);
      requestCancellationsRef.current.get(sessionId)?.();
      requestCancellationsRef.current.delete(sessionId);
    });
    // A failed persistent deletion must never appear as a successful removal.
    try {
      for (const saved of removedSaved) await savedChatStore.remove(saved.id);
    } catch (error) {
      deletedActiveIds.forEach(id => deletedSessionIdsRef.current.delete(id));
      throw error;
    }
    setActiveSessions(prev => prev.filter(session => !deletedActiveIds.has(session.id)));
    const removedIds = new Set(removedSaved.map(saved => saved.id));
    setSavedSessions(prev => prev.filter(saved => !removedIds.has(saved.id)));
    setCurrentSessionId(previous => previous && deletedActiveIds.has(previous) ? null : previous);
  }, [activeSessions, savedSessions, savedLoaded, savedLoadError]);

  const clearAllTemporary = useCallback(() => {
    setActiveSessions([]);
    setCurrentSessionId(null);
  }, []);

  const getSession = useCallback((id: string) => {
    return activeSessions.find(s => s.id === id) || savedSessions.find(s => s.id === id);
  }, [activeSessions, savedSessions]);

  const addMessage = useCallback((sessionId: string, msg: ChatMessage) => {
    setActiveSessions((prev) => {
      if (deletedSessionIdsRef.current.has(sessionId)) return prev;
      return prev.map(s => {
      if (s.id !== sessionId) return s;
      const title = s.messages.length === 0 && msg.role === 'user'
        ? msg.content.slice(0, 30) + (msg.content.length > 30 ? '...' : '')
        : s.title;
      return {
        ...s,
        title,
        updatedAt: Date.now(),
        messages: [...s.messages, msg]
      };
      });
    });
  }, []);

  const updateMessage = useCallback((sessionId: string, messageId: string, updates: Partial<ChatMessage>) => {
    setActiveSessions((prev) => deletedSessionIdsRef.current.has(sessionId)
      ? prev
      : updateSessionMessageById(prev, sessionId, messageId, updates));
  }, []);

  const beginRequest = useCallback((sessionId: string, prompt: string, messageId: string, retry = false) => {
    setActiveSessions(prev => {
      if (deletedSessionIdsRef.current.has(sessionId)) return prev;
      return prev.map(s => {
      if (s.id !== sessionId) return s;
      const previous = s.requestState;
      return { ...s, requestState: requestStateForStart(previous, prompt, messageId, retry) };
      });
    });
  }, []);

  const updateRequestState = useCallback((
    sessionId: string,
    updates: Partial<ChatRequestState> & { status: ChatRequestStatus },
  ) => {
    setActiveSessions(prev => {
      if (deletedSessionIdsRef.current.has(sessionId)) return prev;
      return prev.map(s => {
      if (s.id !== sessionId) return s;
      const current = s.requestState ?? { status: 'idle' as const, retryCount: 0 };
      const terminal = updates.status !== 'streaming' && updates.status !== 'retrying';
      return {
        ...s,
        requestState: {
          ...current,
          ...updates,
          finishedAt: terminal ? (updates.finishedAt ?? Date.now()) : updates.finishedAt,
        },
      };
      });
    });
  }, []);

  const deleteMessageAndAfter = useCallback((sessionId: string, messageId: string) => {
    setActiveSessions((prev) => {
      if (deletedSessionIdsRef.current.has(sessionId)) return prev;
      return prev.map(s => {
      if (s.id !== sessionId) return s;
      const idx = s.messages.findIndex(m => m.id === messageId);
      if (idx === -1) return s;
      // Because we display reversed in UI, the array is chronological. 
      // Wait, is it? We push to messages: [...s.messages, newMsg]. So chronological.
      // If we delete from this message onwards:
      return {
        ...s,
        messages: s.messages.slice(0, idx)
      };
      });
    });
  }, []);

  const saveSession = useCallback(async (sessionId: string) => {
    if (!savedLoaded || savedLoadError) throw new Error('Saved chats are unavailable');
    const session = activeSessions.find(s => s.id === sessionId);
    if (!session) throw new Error('Session not found');
    if (session.savedCopyId) throw new Error('Use Update saved copy for an existing snapshot');
    const snapshot = {
      ...createSnapshot(session, generateId()),
      sourceConversationId: session.sourceConversationId ?? session.id,
    };
    await savedChatStore.save(snapshot);
    if (deletedSessionIdsRef.current.has(sessionId)) {
      await savedChatStore.remove(snapshot.id);
      throw new Error('Conversation was deleted while saving');
    }
    setActiveSessions(prev => prev.map(active => active.id === sessionId
      ? { ...active, savedCopyId: snapshot.id }
      : active));
    setSavedSessions(prev => [snapshot, ...prev]);
    return snapshot.id;
  }, [activeSessions, savedSessions, savedLoaded, savedLoadError]);

  const updateSavedSession = useCallback(async (tempId: string, savedId: string) => {
    if (!savedLoaded || savedLoadError) throw new Error('Saved chats are unavailable');
    const tempSession = activeSessions.find(s => s.id === tempId);
    if (!tempSession || tempSession.savedCopyId !== savedId || !savedSessions.some(s => s.id === savedId && !s.corrupted)) throw new Error('Snapshot unavailable');
    const savedSession = savedSessions.find(s => s.id === savedId)!;
    const snapshot = createSnapshot(
      tempSession,
      savedId,
      savedSession.sourceConversationId ?? tempSession.sourceConversationId ?? tempSession.id,
    );
    await savedChatStore.save(snapshot);
    if (deletedSessionIdsRef.current.has(tempId)) {
      await savedChatStore.remove(savedId);
      throw new Error('Conversation was deleted while updating');
    }
    setSavedSessions(prev => prev.map(s => s.id === savedId ? snapshot : s));
  }, [activeSessions, savedSessions, savedLoaded, savedLoadError]);

  const corruptRandomSession = useCallback(() => {
    setSavedSessions((prev) => {
      if (prev.length === 0) return prev;
      const copy = [...prev];
      copy[0] = { ...copy[0], corrupted: true };
      return copy;
    });
  }, []);

  return (
    <ChatRepositoryContext.Provider value={{
      activeSessions,
      savedSessions,
      savedLoaded,
      savedLoadError,
      currentSessionId,
      createSession,
      continueSavedSession,
      deleteLogicalConversation,
      registerRequestCancellation,
      clearAllTemporary,
      getSession,
      addMessage,
      updateMessage,
       beginRequest,
       updateRequestState,
      deleteMessageAndAfter,
      saveSession,
      updateSavedSession,
      corruptRandomSession
    }}>
      {children}
    </ChatRepositoryContext.Provider>
  );
}

export function useChatRepository() {
  const ctx = useContext(ChatRepositoryContext);
  if (!ctx) throw new Error('useChatRepository must be used within ChatRepositoryProvider');
  return ctx;
}
