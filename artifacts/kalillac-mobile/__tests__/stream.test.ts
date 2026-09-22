import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { MockChatService } from '../services/MockChatService';

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