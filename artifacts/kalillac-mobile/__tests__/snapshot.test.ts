import { describe, it, expect } from '@jest/globals';
import { createSnapshot } from '../utils/snapshot';

describe('createSnapshot', () => {
  it('should strip attachments and mark as non-temporary', () => {
    const mockSession = {
      id: 'temp-1',
      title: 'Test',
      createdAt: 123,
      updatedAt: 123,
      mode: 'Auto' as const,
      isTemporary: true,
      messages: [
        {
          id: 'msg-1',
          role: 'user' as const,
          content: 'Hello',
          attachments: [{ id: 'a1', name: 'test.pdf', type: 'pdf' as const, size: 100 }]
        }
      ]
    };

    const snapshot = createSnapshot(mockSession, 'saved-1');

    expect(snapshot.id).toBe('saved-1');
    expect(snapshot.isTemporary).toBe(false);
    expect(snapshot.messages[0].attachments).toBeUndefined();
  });

  it('allowlists snapshot fields and detaches the original messages', () => {
    const session = {
      id: 'temporary', title: 'Hello', createdAt: 1, updatedAt: 1,
      mode: 'Auto' as const, isTemporary: true,
      attachmentMetadata: { filename: 'private.pdf' },
      messages: [{ id: 'm', role: 'user' as const, content: 'Hello',
        extractedText: 'PRIVATE DOCUMENT CONTENT',
        attachmentDescription: 'PRIVATE DESCRIPTION',
        filename: 'private.pdf',
        attachments: [{ id: 'a', name: 'private.pdf', type: 'pdf' as const, size: 10 }],
      }],
    };
    const saved = createSnapshot(session, 'saved');
    session.messages[0].content = 'Edited later';
    session.messages.push({ ...session.messages[0], id: 'm2' });
    expect(saved.messages).toHaveLength(1);
    expect(saved.messages[0].content).toBe('Hello');
    expect(JSON.stringify(saved)).not.toMatch(/private.pdf|PRIVATE DOCUMENT|PRIVATE DESCRIPTION|attachmentMetadata/);
    const updated = createSnapshot(session, 'saved');
    expect(updated.messages[0].content).toBe('Edited later');
    expect(saved.messages[0].content).toBe('Hello');
  });
});
