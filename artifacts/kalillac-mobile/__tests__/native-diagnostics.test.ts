import { describe, it, expect, jest } from '@jest/globals';
import { NativeDiagnosticRecorder } from '../dev/nativeDiagnostics';

function storageFixture() {
  const values = new Map<string, string>([['existing-encrypted-record', 'unchanged']]);
  return { values, storage: {
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { values.set(key, value); }),
  } };
}

describe('development-only content-free on-device diagnostics', () => {
  it('persists the last Save stage across a simulated process restart without chat data', async () => {
    const { values, storage } = storageFixture();
    const first = new NativeDiagnosticRecorder(true);
    first.configure(storage);
    await first.record('saved', {
      stage: 'encrypt_started', operationId: 'opaque-op', snapshotId: 'opaque-snapshot', status: 'started',
      transcript: 'private transcript', plaintext: 'private text', ciphertext: 'private cipher',
      encryptionKey: 'private key', errorMessage: 'private error',
    }, true);
    const reopened = new NativeDiagnosticRecorder(true);
    reopened.configure(storage);
    const exported = await reopened.export();
    expect(exported).toContain('encrypt_started');
    expect(exported).toContain('opaque-op');
    expect(exported).not.toContain('private');
    expect(values.get('existing-encrypted-record')).toBe('unchanged');
  });

  it('bounds incremental events and retains the latest per-block/state checkpoint', async () => {
    const recorder = new NativeDiagnosticRecorder(true);
    await recorder.record('assistant', { stage: 'code-block-layout', messageId: 'a', codeBlockKey: 'fence-1', height: 100000 });
    for (let deltaNumber = 0; deltaNumber < 500; deltaNumber++) {
      await recorder.record('assistant', {
        stage: 'message-render-committed', assistantMessageId: 'a', deltaNumber,
        accumulatedChars: deltaNumber * 100, renderCopyBalancingApplied: true,
      });
    }
    const trace = JSON.parse(await recorder.export());
    expect(trace.events).toHaveLength(240);
    expect(trace.checkpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'code-block-layout', height: 100000 }),
      expect.objectContaining({ stage: 'message-render-committed', deltaNumber: 499 }),
    ]));
  });

  it('does not read, write, or export diagnostic storage in release mode', async () => {
    const { storage } = storageFixture();
    const recorder = new NativeDiagnosticRecorder(false);
    recorder.configure(storage);
    await recorder.record('saved', { stage: 'save_confirmed' }, true);
    expect(await recorder.export()).toBe('');
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
