import type {
  ChatMode,
  ChatTransport,
  ChatTransportMessage,
} from './chatTransport';
import { consumeKalillacStream, StreamProtocolError } from './streamProtocol';
import { fetch as expoFetch } from 'expo/fetch';
import type { StreamTimingSession } from './streamTiming';

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
  private requestGeneration = 0;

  constructor(private readonly timing?: StreamTimingSession) {}

  async streamResponse(
    onChunk: (text: string, isDone: boolean) => void,
    _task = 'Auto',
    messages: ChatTransportMessage[] = [],
    mode: ChatMode = 'Auto',
  ): Promise<void> {
    this.stop();
    const requestGeneration = ++this.requestGeneration;
    this.controller = new AbortController();
    const requestId = createRequestId();
    this.timing?.requestStarted(requestId);

    try {
      const response = await expoFetch(`${resolveApiBaseUrl()}/api/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'X-Request-ID': requestId,
        },
        body: JSON.stringify({ messages, mode, request_id: requestId }),
        signal: this.controller.signal,
      });

      if (!response.ok) {
        let payload: any = null;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }
        throw new BackendChatError(
          payload?.error?.code || 'backend-request-failed',
          payload?.error?.message || 'The Kalillac backend could not answer.',
        );
      }

      let content = '';
      await consumeKalillacStream(response, event => {
        if (requestGeneration !== this.requestGeneration) return;
        if (event.type === 'delta') {
          this.timing?.parsedDelta();
          content += event.text;
          onChunk(content, false);
        } else {
          if (!content.trim()) {
            throw new BackendChatError(
              'empty-backend-response',
              'The Kalillac backend returned an empty response.',
            );
          }
          onChunk(content, true);
          this.timing?.completed();
        }
      });
    } catch (error) {
      if (error instanceof BackendChatError) throw error;
      if (error instanceof Error && error.name === 'AbortError') throw error;
      if (error instanceof StreamProtocolError) {
        throw new BackendChatError(error.code, error.message);
      }
      throw new BackendChatError(
        'backend-unreachable',
        'The Kalillac backend could not be reached.',
      );
    } finally {
      this.controller = null;
    }
  }

  stop(): void {
    this.requestGeneration += 1;
    this.controller?.abort();
    this.controller = null;
  }
}