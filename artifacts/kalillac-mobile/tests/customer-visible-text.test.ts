import { describe, it, expect } from '@jest/globals';
import { customerVisibleAssistantText } from '../utils/customerVisibleText';
import { markdownForDisplay } from '../utils/streamingMarkdown';

describe('customer-visible safety metadata separation', () => {
  it('hides standalone internal classifications in older answers without changing refusals or the source', () => {
    const original = 'User Safety: unsafe\nI cannot help with that request.\nResponse Safety: safe\n';
    const visible = customerVisibleAssistantText(original);
    expect(visible).toBe('I cannot help with that request.\n');
    expect(visible).not.toMatch(/User Safety:|Response Safety:/);
    expect(original).toContain('User Safety: unsafe');
    expect(customerVisibleAssistantText('**User Safety:** safe\nAnswer.\n**Response Safety:** safe')).toBe('Answer.\n');
  });

  it('preserves code including literal labels and very large/incomplete fenced responses', () => {
    const code = '```text\nUser Safety: safe\nResponse Safety: safe\n'
      + Array.from({ length: 12000 }, (_, index) => `const row${index} = "wide value";`).join('\n');
    expect(customerVisibleAssistantText(code)).toBe(code);
    expect(markdownForDisplay(customerVisibleAssistantText(code)).startsWith(code)).toBe(true);
    expect(customerVisibleAssistantText(code + '\n```\nResponse Safety: safe')).toBe(code + '\n```\n');
  });
});
