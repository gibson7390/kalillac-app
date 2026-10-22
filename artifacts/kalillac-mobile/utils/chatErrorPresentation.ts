import type { ChatRequestStatus } from '../contexts/ChatRepositoryContext';

export interface ChatErrorPresentation { title: string; message: string; retry: boolean }

/** Never display the supplied error string. Only allowlisted customer copy leaves this boundary. */
export function chatErrorPresentation(status: ChatRequestStatus | undefined, code?: string): ChatErrorPresentation {
  if (status === 'cancelled') return { title: 'Response stopped', message: 'Your prompt is still here. Try again when you’re ready.', retry: true };
  if (code === 'backend-unreachable') {
    return { title: 'Can’t reach Kalillac', message: 'Check your connection and try again.', retry: true };
  }
  if (status === 'offline' || code === 'network-error' || code === 'network-unavailable') {
    return { title: 'Check your connection', message: 'Reconnect, then try again.', retry: true };
  }
  switch (code) {
    case 'ai-processing-consent-required':
      return { title: 'AI processing permission needed', message: 'Review and allow external AI processing to request a response.', retry: false };
    case 'rate-limited':
    case 'provider-rate-limited':
      return { title: 'A short pause', message: 'Too many requests right now. Wait a moment, then try again.', retry: true };
    case 'server-busy':
      return { title: 'Kalillac is busy', message: 'Try again shortly.', retry: true };
    case 'provider-timeout':
      return { title: 'That took too long', message: 'Kalillac couldn’t finish that response. Try again.', retry: true };
    case 'current-information-unavailable':
      return { title: 'Current web information unavailable', message: 'Try again shortly for up-to-date information.', retry: true };
    case 'invalid-request':
    case 'budget-exceeded':
    case 'input-too-large':
      return { title: 'Message couldn’t be sent', message: 'Shorten your message or start a new chat, then try again.', retry: false };
    case 'policy-refusal':
      return { title: 'Try a different question', message: 'Kalillac couldn’t help with that request. Edit your message to continue.', retry: false };
    default:
      return { title: 'Response interrupted', message: 'Kalillac couldn’t finish that response. Try again shortly.', retry: true };
  }
}
