import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockExpoFetch = jest.fn<(...args: any[]) => Promise<Response>>();

jest.mock('expo/fetch', () => ({
  fetch: (...args: unknown[]) => mockExpoFetch(...args),
}));

import { KalillacChatService } from '../services/KalillacChatService';
import { StreamTimingSession } from '../services/streamTiming';

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

describe('Kalillac backend streaming service', () => {
  beforeEach(() => {
    mockExpoFetch.mockReset();
  });

  it('accumulates deltas into one progressively updated assistant response', async () => {
    mockExpoFetch.mockResolvedValue(
      responseFromChunks([
        'event: delta\ndata: {"type":"delta","request_id":"r1","text":"Hel"}\n\n',
        'event: delta\ndata: {"type":"delta","request_id":"r1","text":"lo"}\n\n',
        'event: complete\ndata: {"type":"complete","request_id":"r1"}\n\n',
      ]),
    );
    const updates: Array<{ text: string; done: boolean }> = [];
    const service = new KalillacChatService();

    await service.streamResponse((text, done) => updates.push({ text, done }));

    expect(updates).toEqual([
      { text: 'Hel', done: false },
      { text: 'Hello', done: false },
      { text: 'Hello', done: true },
    ]);
  });

  it('ignores a response that becomes stale after cancellation', async () => {
    let resolveFetch: (response: Response) => void = () => undefined;
    mockExpoFetch.mockReturnValue(
      new Promise<Response>(resolve => {
        resolveFetch = resolve;
      }),
    );
    const updates: string[] = [];
    const service = new KalillacChatService();
    const pending = service.streamResponse(text => updates.push(text));

    service.stop();
    resolveFetch(
      responseFromChunks([
        'event: delta\ndata: {"type":"delta","request_id":"old","text":"late"}\n\n',
        'event: complete\ndata: {"type":"complete","request_id":"old"}\n\n',
      ]),
    );
    await pending;

    expect(updates).toEqual([]);
  });

  it('does not append safety/reasoning/debug metadata to assistant content', async () => {
    mockExpoFetch.mockResolvedValue(
      responseFromChunks([
        'event: delta\ndata: {"type":"delta","request_id":"metadata-fixture","text":"Ordinary answer.","safety":"safe","reasoning":"not visible","debug":{"label":"User Safety: safe"}}\n\n',
        'event: complete\ndata: {"type":"complete","request_id":"metadata-fixture","safety":"safe"}\n\n',
      ]),
    );
    const updates: string[] = [];
    await new KalillacChatService().streamResponse(text => updates.push(text));
    expect(updates.at(-1)).toBe('Ordinary answer.');
    expect(updates.join('')).not.toContain('User Safety');
    expect(updates.join('')).not.toContain('not visible');
  });

  it('starts repeated generations with a fresh cancellation signal, context, and first delta', async () => {
    const started = jest.fn();
    const service = new KalillacChatService(undefined, started);
    for (let iteration = 0; iteration < 3; iteration++) {
      mockExpoFetch.mockResolvedValueOnce(responseFromChunks([
        `event: delta\ndata: {"type":"delta","request_id":"r${iteration}","text":"answer ${iteration}"}\n\n`,
        `event: complete\ndata: {"type":"complete","request_id":"r${iteration}"}\n\n`,
      ]));
      const updates: Array<[string, boolean]> = [];
      const context = [{ role: 'user' as const, content: 'original prompt' }];
      await service.streamResponse((text, done) => updates.push([text, done]), 'Auto', context);
      const options = mockExpoFetch.mock.calls[iteration][1];
      expect(options.signal.aborted).toBe(false);
      expect(JSON.parse(options.body).messages).toEqual(context);
      expect(updates).toEqual([[`answer ${iteration}`, false], [`answer ${iteration}`, true]]);
      service.stop();
    }
    expect(started).toHaveBeenCalledTimes(3);
  });

  it('does not let an older request finalizer clear the new request cancellation controller', async () => {
    let resolveOld!: (response: Response) => void;
    let resolveNew!: (response: Response) => void;
    mockExpoFetch.mockReturnValueOnce(new Promise<Response>(resolve => { resolveOld = resolve; }));
    mockExpoFetch.mockReturnValueOnce(new Promise<Response>(resolve => { resolveNew = resolve; }));
    const service = new KalillacChatService();
    const oldUpdates = jest.fn();
    const newUpdates = jest.fn();
    const old = service.streamResponse(oldUpdates);
    const current = service.streamResponse(newUpdates);
    const oldSignal = mockExpoFetch.mock.calls[0][1].signal;
    const newSignal = mockExpoFetch.mock.calls[1][1].signal;
    expect(oldSignal.aborted).toBe(true);
    expect(newSignal.aborted).toBe(false);
    resolveOld(responseFromChunks([
      'event: delta\ndata: {"type":"delta","request_id":"old","text":"late old text"}\n\n',
      'event: complete\ndata: {"type":"complete","request_id":"old"}\n\n',
    ]));
    await old;
    service.stop();
    expect(newSignal.aborted).toBe(true);
    resolveNew(responseFromChunks([
      'event: delta\ndata: {"type":"delta","request_id":"new","text":"cancelled text"}\n\n',
      'event: complete\ndata: {"type":"complete","request_id":"new"}\n\n',
    ]));
    await current;
    expect(oldUpdates).not.toHaveBeenCalled();
    expect(newUpdates).not.toHaveBeenCalled();
  });

  it('records content-free request, delta, screen, render, and completion timing', async () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    mockExpoFetch.mockResolvedValue(
      responseFromChunks([
        'event: delta\ndata: {"type":"delta","request_id":"timing","text":"one"}\n\n',
        'event: delta\ndata: {"type":"delta","request_id":"timing","text":" two"}\n\n',
        'event: complete\ndata: {"type":"complete","request_id":"timing"}\n\n',
      ]),
    );
    const timing = new StreamTimingSession(true);
    const service = new KalillacChatService(timing);

    await service.streamResponse((_text, done) => {
      if (!done) {
        timing.screenStreamingUpdate();
        timing.assistantRenderCommitted();
      }
    });

    expect(timing.snapshot()).toMatchObject({
      parsedDeltaCount: 2,
      screenUpdateCount: 2,
      assistantRenderCommitCount: 2,
    });
    expect(timing.snapshot().completionElapsedMs).not.toBeNull();
    await new Promise(resolve => setTimeout(resolve, 110));
    const loggedDiagnostics = JSON.stringify(infoSpy.mock.calls);
    expect(loggedDiagnostics).not.toContain('"one"');
    expect(loggedDiagnostics).not.toContain('" two"');
    expect(loggedDiagnostics).not.toContain('"text"');
    infoSpy.mockRestore();
  });
});