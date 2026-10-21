import type { ChatMessage } from '../contexts/ChatRepositoryContext';
import type { ChatTransportMessage } from '../services/chatTransport';

export interface RegenerationPlan {
  assistantMessageId: string;
  sourceUserMessageId: string;
  prompt: string;
  context: ChatTransportMessage[];
  retryCount: number;
}

/** Context ends at the target's source user turn, never the old answer or later turns. */
export function regenerationPlan(messages: ChatMessage[], targetId: string): RegenerationPlan | undefined {
  const targetIndex = messages.findIndex(message => message.id === targetId && message.role === 'ai');
  if (targetIndex < 0) return;
  const userIndex = messages.findLastIndex((message, index) => index < targetIndex && message.role === 'user');
  if (userIndex < 0 || !messages[userIndex].content.trim()) return;
  const user = messages[userIndex];
  return {
    assistantMessageId: targetId,
    sourceUserMessageId: user.id,
    prompt: user.content,
    context: messages.slice(0, userIndex + 1)
      .filter(message => !!message.content.trim())
      .map<ChatTransportMessage>(message => ({ role: message.role === 'ai' ? 'assistant' : 'user', content: message.content }))
      .slice(-40),
    retryCount: (messages[targetIndex].retryCount ?? 0) + 1,
  };
}

export function startRegeneration(
  plan: RegenerationPlan,
  actions: {
    cancelPrevious: () => void;
    resetCancellation: (id: string) => void;
    activate: (id: string) => void;
    replaceAssistant: (id: string, patch: Partial<ChatMessage>) => void;
    beginRequest: (prompt: string, id: string) => void;
    run: (id: string, context: ChatTransportMessage[]) => void;
  },
): void {
  actions.cancelPrevious();
  actions.resetCancellation(plan.assistantMessageId);
  actions.activate(plan.assistantMessageId);
  actions.replaceAssistant(plan.assistantMessageId, {
    content: '', isStreaming: true, requestStatus: 'retrying', requestError: undefined,
    requestPrompt: plan.prompt, retryCount: plan.retryCount,
  });
  actions.beginRequest(plan.prompt, plan.assistantMessageId);
  actions.run(plan.assistantMessageId, plan.context);
}
