import type {
  ChatMode,
  ChatTransport,
  ChatTransportMessage,
} from './chatTransport';

export class BackendChatError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BackendChatError';
  }
}

function resolveApiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_KALILLAC_API_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');

  const domain = process.env.EXPO_PUBLIC_DOMAIN?.trim();
  if (domain) {
    return `https://${domain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  }

  return 'http://localhost:8080';
}

function createRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class KalillacChatService implements ChatTransport {
  private controller: AbortController | null = null;

  async streamResponse(
    onChunk: (text: string, isDone: boolean) => void,
    _task = 'Auto',
    messages: ChatTransportMessage[] = [],
    mode: ChatMode = 'Auto',
  ): Promise<void> {
    this.stop();
    this.controller = new AbortController();
    const requestId = createRequestId();

    try {
      const response = await fetch(`${resolveApiBaseUrl()}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': requestId,
        },
        body: JSON.stringify({ messages, mode, request_id: requestId }),
        signal: this.controller.signal,
      });

      let payload: any = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok) {
        throw new BackendChatError(
          payload?.error?.code || 'backend-request-failed',
          payload?.error?.message || 'The Kalillac backend could not answer.',
        );
      }

      if (!payload || typeof payload.content !== 'string' || !payload.content.trim()) {
        throw new BackendChatError(
          'invalid-backend-response',
          'The Kalillac backend returned an invalid response.',
        );
      }

      onChunk(payload.content, true);
    } catch (error) {
      if (error instanceof BackendChatError) throw error;
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw new BackendChatError(
        'backend-unreachable',
        'The Kalillac backend could not be reached.',
      );
    } finally {
      this.controller = null;
    }
  }

  stop(): void {
    this.controller?.abort();
    this.controller = null;
  }
}