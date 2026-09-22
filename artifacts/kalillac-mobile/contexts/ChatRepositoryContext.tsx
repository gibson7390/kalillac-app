import { createContext, useContext, useState, useRef, ReactNode, useCallback } from 'react';
import { generateId } from '../utils/uuid';
import { createSnapshot } from '../utils/snapshot';

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

export function cancelledRequestUpdates(reason = 'cancelled'): Partial<ChatMessage> {
  return {
    isStreaming: false,
    requestStatus: 'cancelled',
    requestError: reason,
  };
}

export function removeSavedSession(sessions: ChatSession[], savedSessionId: string): ChatSession[] {
  return sessions.filter(session => session.id !== savedSessionId);
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
  currentSessionId: string | null;
  createSession: (mode?: AIModelMode) => string;
  continueSavedSession: (savedId: string) => string;
  endSession: (id: string) => void;
  clearAllTemporary: () => void;
  getSession: (id: string) => ChatSession | undefined;
  addMessage: (sessionId: string, message: ChatMessage) => void;
  updateMessage: (sessionId: string, messageId: string, updates: Partial<ChatMessage>) => void;
  beginRequest: (sessionId: string, prompt: string, messageId: string, retry?: boolean) => void;
  updateRequestState: (sessionId: string, updates: Partial<ChatRequestState> & { status: ChatRequestStatus }) => void;
  deleteMessageAndAfter: (sessionId: string, messageId: string) => void;
  saveSession: (sessionId: string) => Promise<string>;
  updateSavedSession: (temporarySessionId: string, savedSessionId: string) => Promise<void>;
  deleteSavedSession: (savedSessionId: string) => void;
  corruptRandomSession: () => void;
}

const ChatRepositoryContext = createContext<ChatRepositoryState | null>(null);

export function ChatRepositoryProvider({ children }: { children: ReactNode }) {
  const [activeSessions, setActiveSessions] = useState<ChatSession[]>([]);
  const [savedSessions, setSavedSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

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

  const endSession = useCallback((id: string) => {
    setActiveSessions((prev) => prev.filter((s) => s.id !== id));
    if (currentSessionId === id) setCurrentSessionId(null);
  }, [currentSessionId]);

  const clearAllTemporary = useCallback(() => {
    setActiveSessions([]);
    setCurrentSessionId(null);
  }, []);

  const getSession = useCallback((id: string) => {
    return activeSessions.find(s => s.id === id) || savedSessions.find(s => s.id === id);
  }, [activeSessions, savedSessions]);

  const addMessage = useCallback((sessionId: string, msg: ChatMessage) => {
    setActiveSessions((prev) => prev.map(s => {
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
    }));
  }, []);

  const updateMessage = useCallback((sessionId: string, messageId: string, updates: Partial<ChatMessage>) => {
    setActiveSessions((prev) => prev.map(s => {
      if (s.id !== sessionId) return s;
      return {
        ...s,
        messages: updateMessageById(s.messages, messageId, updates)
      };
    }));
  }, []);

  const beginRequest = useCallback((sessionId: string, prompt: string, messageId: string, retry = false) => {
    setActiveSessions(prev => prev.map(s => {
      if (s.id !== sessionId) return s;
      const previous = s.requestState;
      return { ...s, requestState: requestStateForStart(previous, prompt, messageId, retry) };
    }));
  }, []);

  const updateRequestState = useCallback((
    sessionId: string,
    updates: Partial<ChatRequestState> & { status: ChatRequestStatus },
  ) => {
    setActiveSessions(prev => prev.map(s => {
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
    }));
  }, []);

  const deleteMessageAndAfter = useCallback((sessionId: string, messageId: string) => {
    setActiveSessions((prev) => prev.map(s => {
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
    }));
  }, []);

  const saveSession = useCallback(async (sessionId: string) => {
    const session = activeSessions.find(s => s.id === sessionId);
    if (!session) throw new Error('Session not found');
    const snapshot = createSnapshot(session, generateId());
    setSavedSessions((prev) => [snapshot, ...prev]);
    setActiveSessions(prev => prev.map(s => s.id === sessionId ? { ...s, savedCopyId: snapshot.id } : s));
    return snapshot.id;
  }, [activeSessions]);

  const updateSavedSession = useCallback(async (tempId: string, savedId: string) => {
    const tempSession = activeSessions.find(s => s.id === tempId);
    if (!tempSession || !savedSessions.some(s => s.id === savedId)) throw new Error('Snapshot unavailable');
    const snapshot = createSnapshot(tempSession, savedId);
    setSavedSessions(prev => prev.map(s => s.id === savedId ? snapshot : s));
  }, [activeSessions, savedSessions]);

  const deleteSavedSession = useCallback((savedId: string) => {
    setSavedSessions((prev) => removeSavedSession(prev, savedId));
  }, []);

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
      currentSessionId,
      createSession,
      continueSavedSession,
      endSession,
      clearAllTemporary,
      getSession,
      addMessage,
      updateMessage,
       beginRequest,
       updateRequestState,
      deleteMessageAndAfter,
      saveSession,
      updateSavedSession,
      deleteSavedSession,
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
