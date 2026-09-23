export type ChatMode = 'Auto' | 'Fast' | 'Smart' | 'Deep';

export interface ChatTransportMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatTransport {
  streamResponse(
    onChunk: (text: string, isDone: boolean) => void,
    task?: string,
    messages?: ChatTransportMessage[],
    mode?: ChatMode,
  ): Promise<void>;
  stop(): void;
}