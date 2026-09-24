import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { MockChatService } from '../services/MockChatService';
import { consumeKalillacStream, StreamProtocolError } from '../services/streamProtocol';

function responseFromChunks(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
  });
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream' },
  });
}

afterEach(() => { jest.useRealTimers(); });

describe('memory-only mock stream', () => {
  it('emits multiple deltas then finishes with a table and example sources', async () => {
    jest.useFakeTimers();
    const service = new MockChatService();
    const events: { text: string; done: boolean }[] = [];
    const pending = service.streamResponse((text, done) => events.push({ text, done }), 'Research');
    jest.advanceTimersByTime(10000);
    await pending;
    expect(events.length).toBeGreaterThan(2);
    expect(events.at(-1)?.done).toBe(true);
    expect(events.at(-1)?.text).toContain('| Step | Goal |');
    expect(events.at(-1)?.text).toContain('https://science.nasa.gov/');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('settles cancellation immediately and never emits late content', async () => {
    jest.useFakeTimers();
    const service = new MockChatService();
    const chunks: string[] = [];
    const pending = service.streamResponse(text => chunks.push(text), 'Code');
    jest.advanceTimersByTime(90);
    service.stop();
    await pending;
    const count = chunks.length;
    jest.advanceTimersByTime(10000);
    expect(chunks).toHaveLength(count);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('Kalillac streaming protocol', () => {
  it('accumulates progressive deltas and completes once', async () => {
    const events: string[] = [];
    await consumeKalillacStream(
      responseFromChunks([
        'event: delta\ndata: {"type":"delta","request_id":"r1","text":"Hel',
        'lo"}\n\nevent: delta\ndata: {"type":"delta","request_id":"r1","text":" world"}\n\n',
        'event: complete\ndata: {"type":"complete","request_id":"r1"}\n\n',
      ]),
      event => {
        if (event.type === 'delta') events.push(event.text);
      },
    );

    expect(events).toEqual(['Hello', ' world']);
  });

  it('surfaces safe backend errors and rejects incomplete streams', async () => {
    await expect(
      consumeKalillacStream(
        responseFromChunks([
          'event: error\ndata: {"type":"error","request_id":"r2","code":"provider-failed","message":"The provider is unavailable."}\n\n',
        ]),
        () => undefined,
      ),
    ).rejects.toMatchObject({
      code: 'provider-failed',
      message: 'The provider is unavailable.',
    });

    await expect(
      consumeKalillacStream(
        responseFromChunks([
          'event: delta\ndata: {"type":"delta","request_id":"r3","text":"partial"}\n\n',
        ]),
        () => undefined,
      ),
    ).rejects.toBeInstanceOf(StreamProtocolError);
  });
});