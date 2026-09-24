export type KalillacStreamEvent =
  | { type: 'delta'; request_id: string; text: string }
  | { type: 'complete'; request_id: string; model?: string }
  | { type: 'error'; request_id: string; code: string; message: string };

export class StreamProtocolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StreamProtocolError';
  }
}

function parseEvent(eventName: string, rawData: string): KalillacStreamEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawData);
  } catch {
    throw new StreamProtocolError(
      'invalid-stream',
      'The Kalillac backend returned an invalid stream.',
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new StreamProtocolError(
      'invalid-stream',
      'The Kalillac backend returned an invalid stream.',
    );
  }

  const candidate = parsed as Record<string, unknown>;
  if (candidate.type !== eventName || typeof candidate.request_id !== 'string') {
    throw new StreamProtocolError(
      'invalid-stream',
      'The Kalillac backend returned an invalid stream.',
    );
  }

  if (eventName === 'delta' && typeof candidate.text === 'string' && candidate.text.length > 0) {
    return {
      type: 'delta',
      request_id: candidate.request_id,
      text: candidate.text,
    };
  }

  if (eventName === 'complete') {
    return {
      type: 'complete',
      request_id: candidate.request_id,
      ...(typeof candidate.model === 'string' ? { model: candidate.model } : {}),
    };
  }

  if (
    eventName === 'error'
    && typeof candidate.code === 'string'
    && typeof candidate.message === 'string'
  ) {
    return {
      type: 'error',
      request_id: candidate.request_id,
      code: candidate.code,
      message: candidate.message,
    };
  }

  throw new StreamProtocolError(
    'invalid-stream',
    'The Kalillac backend returned an invalid stream.',
  );
}

export async function consumeKalillacStream(
  response: Response,
  onEvent: (event: KalillacStreamEvent) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new StreamProtocolError(
      'missing-stream',
      'The Kalillac backend returned no stream.',
    );
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = '';
  let dataLines: string[] = [];
  let completed = false;

  const dispatch = () => {
    if (!eventName || dataLines.length === 0) return;
    const event = parseEvent(eventName, dataLines.join('\n'));
    if (event.type === 'error') {
      throw new StreamProtocolError(event.code, event.message);
    }
    onEvent(event);
    completed ||= event.type === 'complete';
    eventName = '';
    dataLines = [];
  };

  const processLine = (line: string) => {
    if (line === '') {
      dispatch();
      return;
    }
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      return;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    lines.forEach(processLine);
    if (done) break;
  }

  if (buffer) processLine(buffer);
  dispatch();
  if (!completed) {
    throw new StreamProtocolError(
      'stream-incomplete',
      'The Kalillac backend ended the response unexpectedly.',
    );
  }
}