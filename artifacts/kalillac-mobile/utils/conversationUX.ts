import type { ChatMessage, ChatSession } from '../contexts/ChatRepositoryContext';
import type { ChatTransportMessage } from '../services/chatTransport';

/** No mutation and no persistence: submitting an edit replaces the active branch only. */
export function editedConversation(messages: ChatMessage[], targetId: string, text: string): ChatMessage[] | undefined {
  const index = messages.findIndex(m => m.id === targetId && m.role === 'user');
  if (index < 0 || !text.trim()) return;
  return [...messages.slice(0, index), { ...messages[index], content: text.trim() }];
}

export function editResendPlan(messages: ChatMessage[], targetId: string, text: string) {
  const next = editedConversation(messages, targetId, text);
  if (!next) return;
  return {
    messages: next,
    context: next.filter(m => m.content.trim()).map<ChatTransportMessage>(m => ({
      role: m.role === 'ai' ? 'assistant' : 'user', content: m.content.trim(),
    })).slice(-40),
  };
}

export function replaceActiveBranch(sessions: ChatSession[], sessionId: string, targetId: string, text: string): ChatSession[] {
  return sessions.map(session => {
    if (session.id !== sessionId) return session;
    const messages = editedConversation(session.messages, targetId, text);
    return messages ? { ...session, messages, requestState: undefined, updatedAt: Date.now() } : session;
  });
}

export function canStartGeneration(text: string, generating: boolean, activeId: string | null): boolean {
  return !!text.trim() && !generating && activeId === null;
}

/** The existing list is inverted: offset zero is newest. No automatic scroll changes. */
export function shouldShowLatest(offset: number, messageCount: number): boolean {
  return messageCount > 0 && Number.isFinite(offset) && offset > 180;
}

export interface EditDraft { messageId: string; previousDraft: string }
export function cancelledEditDraft(edit: EditDraft): string { return edit.previousDraft; }

export async function copyMessage(
  text: string,
  write: (text: string) => Promise<unknown>,
  announce: (message: string) => void,
): Promise<boolean> {
  let copied = false;
  try {
    await write(text);
    copied = true;
  } catch { /* Clipboard failures stay local and non-intrusive. */ }
  try { announce(copied ? 'Message copied' : "Couldn't copy. Try again."); }
  catch { /* Accessibility feedback must not turn a successful copy into an error. */ }
  return copied;
}
