import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import type { ReactElement } from 'react';
import {
  fixtureMessages, fixtureResponse, FixtureChatService, resolveChatFixture,
  fixtureForMessages,
} from '../dev/chatFixtures';
import { renderMarkdownCodeBlock } from '../components/MarkdownCodeBlock';
import { markdownForDisplay } from '../utils/streamingMarkdown';
import { assistantRenderStats } from '../utils/assistantRenderDiagnostics';
import {
  cancelledRequestUpdates,
  updateMessageById,
  type ChatMessage,
} from '../contexts/ChatRepositoryContext';

// Element/prop tests, NOT Yoga/UIKit layout or native gesture simulation.
jest.mock('react-native', () => ({
  View: 'View',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles },
}));
jest.mock('../components/ThemedText', () => ({ ThemedText: 'ThemedText' }));
jest.mock('../services/savedChatAdapter', () => ({ savedChatStore: {} }));

const rendererRoot = dirname(require.resolve('@ronradtke/react-native-markdown-display/package.json'));
const parser = require(join(rendererRoot, 'dist/lib/view/createMarkdownIt.js')).createMarkdownIt();
const chatSource = readFileSync(resolve(__dirname, '../app/(app)/chat/[id].tsx'), 'utf8');
const codeBlockSource = readFileSync(resolve(__dirname, '../components/MarkdownCodeBlock.tsx'), 'utf8');

describe('local response / code viewport regression contracts', () => {
  afterEach(() => { jest.useRealTimers(); });

  it.each(['short', 'long-code', 'mixed'] as const)('keeps %s transcript, message order and IDs intact', kind => {
    const messages = fixtureMessages(kind);
    const original = JSON.stringify(messages);
    const reversed = [...messages].reverse();
    expect(messages[0].role).toBe('user');
    expect(reversed[0].role).toBe('ai');
    expect(JSON.stringify(messages)).toBe(original);
    expect(new Set(messages.map(message => message.id)).size).toBe(messages.length);
    expect(messages[1].content).toBe(fixtureResponse(kind));
    const tokens = parser.parse(messages[1].content, {}) as Array<{ type: string; content: string; info?: string }>;
    const fences = tokens.filter(token => token.type === 'fence');
    expect(fences).toHaveLength(kind === 'short' ? 0 : 3);
    if (kind !== 'short') {
      expect(fences.map(fence => fence.info)).toEqual(['html', 'python', 'javascript']);
      fences.forEach(fence => {
        expect(fence.content.split('\n').length).toBeGreaterThan(100);
        expect(Math.max(...fence.content.split('\n').map(line => line.length))).toBeGreaterThan(140);
      });
      expect(messages[1].content).toContain('FIXTURE END');
    }
    if (kind === 'mixed') {
      expect(messages[1].content).toContain('Prose before code.');
      expect(messages[1].content).toContain('Prose after code.');
    }
  });

  it('uses an intrinsic-height horizontal viewport and preserves every code character', () => {
    const code = parser.parse(fixtureResponse('long-code'), {}).find((token: { type: string }) => token.type === 'fence').content;
    const block = renderMarkdownCodeBlock({ content: code, color: '#fff', backgroundColor: '#111' });
    const scroll = block.props.children as ReactElement<Record<string, any>>;
    const text = scroll.props.children as ReactElement<Record<string, any>>;
    expect(text.props.children).toBe(code);
    expect(scroll.props).toMatchObject({
      horizontal: true, scrollEnabled: true, directionalLockEnabled: true,
      alwaysBounceVertical: false, bounces: false,
      contentInsetAdjustmentBehavior: 'never',
    });
    expect(scroll.props.style).toMatchObject({ flexGrow: 0, flexShrink: 0, width: '100%' });
    expect(scroll.props.style).not.toHaveProperty('height');
    expect(scroll.props.style).not.toHaveProperty('maxHeight');
    expect(text.props).not.toHaveProperty('numberOfLines');
    expect(block.props.style[0]).toMatchObject({ width: '100%', minWidth: 0 });
  });

  it('keeps partial and incrementally streamed fences renderable without changing saved content', () => {
    const chunks = [
      '```html\n',
      '```html\n<!doctype html>\n',
      '```html\n<!doctype html>\n<html>\n',
      '```html\n<!doctype html>\n<html>\n<body>\n' + 'x'.repeat(1200),
    ];
    for (const accumulated of chunks) {
      const display = markdownForDisplay(accumulated);
      const tokens = parser.parse(display, {}) as Array<{ type: string; content: string }>;
      const fence = tokens.find(token => token.type === 'fence');
      expect(fence?.content).toContain(accumulated.split('\n').slice(1).join('\n').slice(0, 30));
      expect(display).toContain(accumulated);
    }

    const complete = '```html\n<div>complete</div>\n```';
    expect(markdownForDisplay(complete)).toBe(complete);
    const completedFence = (parser.parse(markdownForDisplay(complete), {}) as Array<{ type: string; content: string }>)
      .find(token => token.type === 'fence');
    expect(completedFence?.content).toContain('<div>complete</div>');

    const stopped = '```python\nprint("received before stop")';
    const stoppedDisplay = markdownForDisplay(stopped);
    const stoppedFence = (parser.parse(stoppedDisplay, {}) as Array<{ type: string; content: string }>)
      .find(token => token.type === 'fence');
    expect(stoppedFence?.content).toContain('received before stop');
    expect(stoppedDisplay).toBe(`${stopped}\n\`\`\``);
    expect(chatSource.includes('markdownForDisplayWithInfo(isUser ? item.content : customerVisibleAssistantText(item.content))')).toBe(true);
  });

  it('retains every long-code delta in message state through finalization and stop', () => {
    const response = [
      '```html',
      ...Array.from({ length: 12_000 }, (_, index) =>
        `<section data-index="${index}" class="long-column-${'x'.repeat(24)}">row ${index}</section>`),
    ].join('\n');
    let messages: ChatMessage[] = [{ id: 'assistant-long', role: 'ai', content: '', isStreaming: true }];
    let deltaNumber = 0;
    for (let end = 4096; end < response.length; end += 4096) {
      const chunk = response.slice(0, end);
      deltaNumber += 1;
      messages = updateMessageById(messages, 'assistant-long', { content: chunk, isStreaming: true });
      expect(messages[0].content).toBe(chunk);
      const stats = assistantRenderStats(chunk, deltaNumber, 'streaming');
      expect(stats.accumulatedChars).toBe(chunk.length);
      expect(stats.markdownFenceCount).toBe(1);
      expect(stats.renderCopyFenceBalanced).toBe(true);
      expect(markdownForDisplay(chunk)).toContain(chunk);
    }

    messages = updateMessageById(messages, 'assistant-long', {
      content: response,
      isStreaming: false,
      requestStatus: 'completed',
    });
    expect(messages[0].content).toBe(response);
    expect(assistantRenderStats(messages[0].content, deltaNumber + 1, 'finalized').accumulatedChars)
      .toBe(response.length);

    messages = updateMessageById(messages, 'assistant-long', cancelledRequestUpdates());
    expect(messages[0].content).toBe(response);
    expect(messages[0].isStreaming).toBe(false);
    expect(assistantRenderStats(messages[0].content, deltaNumber + 1, 'stopped').accumulatedChars)
      .toBe(response.length);
  });

  it('logs only privacy-safe render metadata and has a development-only iOS candidate marker', () => {
    expect(chatSource).toContain('message-state-update-requested');
    expect(chatSource).toContain('message-render-committed');
    expect(codeBlockSource).toContain('code-block-layout');
    expect(chatSource).toContain('candidate-loaded');
    expect(chatSource).toContain('{__DEV__ && Platform.OS === \'ios\'');
    expect(chatSource).toContain('testID="dev-ios-candidate-marker"');
    expect(chatSource).toContain('keyExtractor={item => item.id}');
  });

  it('keeps the chronological source and stable keys for an unclipped inverted list, without forced auto-scroll', () => {
    expect(chatSource).toContain('data={[...session.messages].reverse()}');
    expect(chatSource).toContain('keyExtractor={item => item.id}');
    expect(chatSource).toContain('removeClippedSubviews={false}');
    expect(chatSource).toMatch(/<FlatList[\s\S]*?\binverted\b/);
    expect(chatSource).not.toMatch(/scrollToEnd|getItemLayout/);
    // 4A allows only an explicit Latest tap, not content/layout-driven scrolling.
    expect(chatSource.match(/scrollToOffset/g)).toHaveLength(1);
    expect(chatSource).toContain('messageListRef.current?.scrollToOffset({ offset: 0, animated: false })');
    expect(chatSource).toContain('accessibilityLabel="Scroll to latest message"');
    expect(chatSource).not.toContain('onContentSizeChange');
    expect(chatSource.match(/<MarkdownCodeBlock\b/g)).toHaveLength(2);
  });

  it('streams deterministically with no fetch or provider calls', async () => {
    jest.useFakeTimers();
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('Live requests are forbidden in fixture tests');
    });
    try {
      const chunks: string[] = [];
      const done: boolean[] = [];
      const run = new FixtureChatService('mixed').streamResponse((text, finished) => {
        chunks.push(text); done.push(finished);
      });
      await jest.runAllTimersAsync();
      await run;
      expect(chunks.at(-1)).toBe(fixtureResponse('mixed'));
      expect(done.at(-1)).toBe(true);
      expect(chunks.length).toBeGreaterThan(10);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('stops fixture updates on cancellation', async () => {
    jest.useFakeTimers();
    const service = new FixtureChatService('long-code');
    const updates = jest.fn();
    const run = service.streamResponse(updates);
    service.stop();
    const count = updates.mock.calls.length;
    await jest.runAllTimersAsync();
    await run;
    expect(updates).toHaveBeenCalledTimes(count);
    expect(updates.mock.calls.some(call => call[1] === true)).toBe(false);
  });

  it('recognizes synthetic fixture message IDs after reopening, without persisting a development preference', () => {
    expect(fixtureForMessages(fixtureMessages('long-code'))).toBe('long-code');
    expect(resolveChatFixture('long-code')).toBe('long-code');
    expect(resolveChatFixture('arbitrary-input')).toBeUndefined();
    expect(fixtureForMessages([{ id: 'unrelated-session', role: 'user', content: 'long-code' }])).toBeUndefined();
    expect(chatSource).toContain('fixtures?.fixtureForMessages(session.messages)');
    expect(chatSource).toContain('const fixtures = __DEV__');
  });

  it('makes Saved-start temporary without adding persistence or router fallback labels', () => {
    const saved = readFileSync(resolve(__dirname, '../app/(app)/(tabs)/saved.tsx'), 'utf8');
    const layout = readFileSync(resolve(__dirname, '../app/(app)/_layout.tsx'), 'utf8');
    expect(saved).toContain('Start a temporary chat');
    expect(saved).toContain('Chats stay temporary until you choose Save.');
    const start = saved.slice(saved.indexOf('const handleStart'), saved.indexOf('const renderItem'));
    expect(start).toContain('createSession()');
    expect(start).not.toMatch(/saveSession|updateSavedSession/);
    expect(layout).toContain("headerBackButtonDisplayMode: 'minimal'");
    expect(layout).toContain("headerBackTitle: 'Back'");
    expect(layout).toContain("title: 'Chat'");
  });
});
