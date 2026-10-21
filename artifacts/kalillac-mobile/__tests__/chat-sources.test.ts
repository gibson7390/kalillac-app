import { describe, expect, it } from '@jest/globals';
import { parseChatSources } from '../services/chatSources';
import { consumeKalillacStream } from '../services/streamProtocol';

function responseFromText(text: string): Response {
  return new Response(text, { headers: { 'content-type': 'text/event-stream' } });
}

describe('normalized chat source metadata', () => {
  it('accepts only safe normalized fields and http(s) links', () => {
    const sources = parseChatSources([
      {
        id: 'source-1',
        title: '  Official documentation  ',
        url: 'https://docs.example.org/guide',
        domain: 'docs.example.org',
        snippet: 'must not be forwarded',
        score: 0.91,
      },
      { id: 'source-2', title: 'Unsafe', url: 'javascript:alert(1)', domain: 'example.org' },
      { id: 'source-3', title: 'Wrong domain', url: 'https://other.example/', domain: 'example.org' },
      { id: 'source-1', title: 'Duplicate', url: 'https://duplicate.example/', domain: 'duplicate.example' },
      { id: 'source-4', title: '   ', url: 'https://valid.example/', domain: 'valid.example' },
    ]);
    expect(sources).toEqual([{
      id: 'source-1',
      title: 'Official documentation',
      url: 'https://docs.example.org/guide',
      domain: 'docs.example.org',
    }]);
    expect(JSON.stringify(sources)).not.toContain('snippet');
    expect(JSON.stringify(sources)).not.toContain('score');
  });

  it('accepts sources only from structured completion metadata and ignores unknown fields', async () => {
    const events: unknown[] = [];
    await consumeKalillacStream(
      responseFromText([
        'event: delta\ndata: {"type":"delta","request_id":"r1","text":"Grounded answer."}\n\n',
        'event: complete\ndata: {"type":"complete","request_id":"r1","sources":[{"id":"source-1","title":"Example","url":"https://example.org","domain":"example.org","snippet":"hidden"}],"unknown":{"anything":"ignored"}}\n\n',
      ].join('')),
      event => events.push(event),
    );
    expect(events[0]).toEqual({ type: 'delta', request_id: 'r1', text: 'Grounded answer.' });
    expect(events[1]).toEqual({
      type: 'complete',
      request_id: 'r1',
      sources: [{
        id: 'source-1',
        title: 'Example',
        url: 'https://example.org',
        domain: 'example.org',
      }],
    });
    expect(JSON.stringify(events)).not.toContain('hidden');
  });

  it('keeps legacy complete events without sources unchanged', async () => {
    const events: unknown[] = [];
    await consumeKalillacStream(
      responseFromText('event: complete\ndata: {"type":"complete","request_id":"old"}\n\n'),
      event => events.push(event),
    );
    expect(events).toEqual([{ type: 'complete', request_id: 'old' }]);
  });
});
