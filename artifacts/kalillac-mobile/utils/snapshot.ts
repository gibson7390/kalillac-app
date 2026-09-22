import type { ChatSession } from '../contexts/ChatRepositoryContext';

export function createSnapshot(session: ChatSession, newId: string): ChatSession {
  return {
    id: newId,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: Date.now(),
    mode: session.mode,
    isTemporary: false,
    messages: session.messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      modeUsed: m.modeUsed,
      isStreaming: false,
    }))
  };
}
