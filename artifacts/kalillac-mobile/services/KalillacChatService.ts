import type {
  ChatMode,
  ChatTransport,
  ChatTransportMessage,
} from './chatTransport';
import type { ChatSource } from './chatSources';
import { consumeKalillacStream, StreamProtocolError } from './streamProtocol';
import { fetch as expoFetch } from 'expo/fetch';
import { randomUUID } from 'expo-crypto';
import type { StreamTimingSession } from './streamTiming';
import { aiProcessingConsent } from './aiProcessingConsent';
import { AIProcessingConsentRequiredError } from './aiProcessingConsentState';

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

// Advisory accountless limiter key, kept only for this app process. Not a user identity.
let ephemeralSessionId: string | undefined;
function getEphemeralSessionId(): string {
  return ephemeralSessionId ??= randomUUID();
}

export class KalillacChatService implements ChatTransport {
  private controller: AbortController | null = null;
  private requestGeneration = 0;

  constructor(
    private readonly timing?: StreamTimingSession,
    private readonly onRequestStarted?: (requestId: string) => void,
  ) {}

  async streamResponse(
    onChunk: (text: string, isDone: boolean) => void,
    _task = 'Auto',
    messages: ChatTransportMessage[] = [],
    mode: ChatMode = 'Auto',
    onSources?: (sources: ChatSource[]) => void,
  ): Promise<void> {
    this.stop();
    const requestGeneration = ++this.requestGeneration;
    const controller = new AbortController();
    this.controller = controller;
    let permissionChecked = false;
    let permissionWithdrawn = false;
    const unsubscribe = aiProcessingConsent.subscribe(() => {
      if (permissionChecked && !aiProcessingConsent.isAllowed()) {
        permissionWithdrawn = true;
        controller.abort();
      }
    });

    try {
      // Hard gate for EVERY inference action, including callers bypassing the UI.
      if (!aiProcessingConsent.getSnapshot().loaded) await aiProcessingConsent.ensureAllowed();
      aiProcessingConsent.assertAllowed();
      if (controller.signal.aborted || requestGeneration !== this.requestGeneration) {
        const error = new Error('Request stopped');
        error.name = 'AbortError';
        throw error;
      }
      permissionChecked = true;
      const requestId = createRequestId();
      this.timing?.requestStarted(requestId);
      this.onRequestStarted?.(requestId);
      // Recheck after callbacks; no await between this check and fetch.
      aiProcessingConsent.assertAllowed();
      const response = await expoFetch(`${resolveApiBaseUrl()}/api/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'X-Request-ID': requestId,
          'X-Kalillac-Session': getEphemeralSessionId(),
        },
        body: JSON.stringify({ messages, mode, request_id: requestId }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let payload: any = null;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }
        throw new BackendChatError(
          payload?.error?.code || ([413, 422].includes(response.status) ? 'invalid-request' : 'backend-request-failed'),
          payload?.error?.message || 'The Kalillac backend could not answer.',
        );
      }

      let content = '';
      await consumeKalillacStream(response, event => {
        if (requestGeneration !== this.requestGeneration || controller.signal.aborted || !aiProcessingConsent.isAllowed()) return;
        if (event.type === 'delta') {
          this.timing?.parsedDelta();
          content += event.text;
          onChunk(content, false);
        } else if (event.type === 'complete') {
          if (!content.trim()) {
            throw new BackendChatError(
              'empty-backend-response',
              'The Kalillac backend returned an empty response.',
            );
          }
          if (event.sources?.length) onSources?.(event.sources);
          onChunk(content, true);
          this.timing?.completed();
        }
      });
      if (permissionWithdrawn) throw new AIProcessingConsentRequiredError();
    } catch (error) {
      if (permissionWithdrawn || error instanceof AIProcessingConsentRequiredError) {
        throw new AIProcessingConsentRequiredError();
      }
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
      unsubscribe();
      if (this.controller === controller) this.controller = null;
    }
  }

  stop(): void {
    this.requestGeneration += 1;
    this.controller?.abort();
    this.controller = null;
  }
}