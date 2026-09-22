import type { ChatSession } from '../contexts/ChatRepositoryContext';

export function createSnapshot(
  session: ChatSession,
  newId: string,
  sourceConversationId = session.sourceConversationId ?? session.id,
): ChatSession {
  return {
    id: newId,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: Date.now(),
    mode: session.mode,
    isTemporary: false,
    sourceConversationId,
    messages: session.messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      modeUsed: m.modeUsed,
      isStreaming: false,
    }))
  };
}
