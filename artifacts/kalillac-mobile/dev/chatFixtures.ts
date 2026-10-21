import type { ChatTransport } from '../services/chatTransport';
import type { ChatMessage } from '../contexts/ChatRepositoryContext';

export type ChatFixtureKind = 'short' | 'long-code' | 'mixed';

/** Synthetic fixture IDs survive an explicit snapshot, so reopening a test copy
 * cannot accidentally switch follow-ups to the live provider in development.
 * No extra persistence, user-content scanning, or preference is introduced.
 */
export function fixtureForMessages(messages: ChatMessage[]): ChatFixtureKind | undefined {
  return (['short', 'long-code', 'mixed'] as const).find(kind =>
    messages.some(message => message.id === `fixture-${kind}-user`)
    && messages.some(message => message.id === `fixture-${kind}-assistant`));
}

export function resolveChatFixture(value: unknown): ChatFixtureKind | undefined {
  return value === 'short' || value === 'long-code' || value === 'mixed' ? value : undefined;
}

/** Synthetic, deterministic content only. Never load user conversations here. */
export function fixtureResponse(kind: ChatFixtureKind): string {
  if (kind === 'short') return 'Short local fixture. **Normal prose** stays readable.';
  const lineCount = kind === 'long-code' ? 1000 : 100;
  const html = Array.from({ length: lineCount }, (_, i) =>
    `<section id="row-${i + 1}" data-description="${'wide-column-'.repeat(12)}">HTML line ${i + 1}</section>`,
  ).join('\n');
  const python = Array.from({ length: lineCount }, (_, i) =>
    `print("Python line ${i + 1}: ${'wide-value-'.repeat(12)}")`,
  ).join('\n');
  const javascript = Array.from({ length: lineCount }, (_, i) =>
    `const row${i + 1} = { index: ${i + 1}, description: "${'wide-value-'.repeat(12)}" };`,
  ).join('\n');
  const blocks = [
    '```html', '<!-- HTML START -->', html, '<!-- HTML END -->', '```',
    '```python', '# PYTHON START', python, '# PYTHON END', '```',
    '```javascript', '// JAVASCRIPT START', javascript, '// JAVASCRIPT END', '```',
  ].join('\n');
  return kind === 'mixed'
    ? `## Mixed fixture start\n\nProse before code.\n\n${blocks}\n\nProse after code.\n\n**FIXTURE END**`
    : `${blocks}\n\n**FIXTURE END**`;
}

export function fixtureMessages(kind: ChatFixtureKind): ChatMessage[] {
  return [
    { id: `fixture-${kind}-user`, role: 'user', content: `LOCAL FIXTURE START — ${kind}. Earlier user message must remain reachable.` },
    { id: `fixture-${kind}-assistant`, role: 'ai', content: fixtureResponse(kind), isStreaming: false, requestStatus: 'completed' },
  ];
}

/** Dev-only dependency selected explicitly by a fixture-marked route; never uses fetch. */
export class FixtureChatService implements ChatTransport {
  private stopped = false;
  constructor(private readonly kind: ChatFixtureKind) {}

  async streamResponse(onChunk: (text: string, isDone: boolean) => void): Promise<void> {
    const response = fixtureResponse(this.kind);
    for (let end = 1024; end < response.length; end += 1024) {
      if (this.stopped) return;
      onChunk(response.slice(0, end), false);
      await new Promise<void>(resolve => setTimeout(resolve, 16));
    }
    if (!this.stopped) onChunk(response, true);
  }

  stop() { this.stopped = true; }
}
