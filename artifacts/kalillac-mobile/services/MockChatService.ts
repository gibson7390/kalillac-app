import type { ChatTransport } from './chatTransport';

// Static fixtures, not AI output. No prompts, attachments or network requests.
const fixtures: Record<string, string> = {
  Research: '## A focused research brief\n\nThis is a **sample research answer**, not live research. For a useful investigation, define the question, compare primary sources and separate evidence from interpretation.\n\n| Step | Goal |\n| --- | --- |\n| Frame | Write one answerable question |\n| Compare | Check independent sources |\n| Synthesize | Note uncertainty |\n\n### Example sources\n[1 — NASA Science](https://science.nasa.gov/)\n\n[2 — Smithsonian](https://www.si.edu/)\n\nThese are example destinations, not citations supporting a live answer.',
  Code: '## Isolate the behavior\n\nHere is a **demonstration**, not analysis of your code. Keep transformation functions small and test their outputs.\n\n```typescript\nconst double = (value: number) => {\n  return value * 2;\n};\n```\n\nTry boundary cases before connecting the function to a larger system.',
  Study: '## Learn in three passes\n\nThis is a mock study response.\n\n1. Explain the idea in your own words.\n2. Work through a small example.\n3. Test recall without looking at your notes.\n\n**Check yourself:** what would change if one assumption were false?',
  Analyze: '## Compare the trade-offs\n\nA sample analysis, not a live evaluation of your attachment.\n\n| Choice | Strength | Trade-off |\n| --- | --- | --- |\n| A | Simple to operate | Less flexibility |\n| B | Adaptable | More setup |\n\nStart with the simplest option that meets the actual requirements.',
  Create: '## Start with a clear outline\n\nA sample creative response:\n\n**Opening:** a question worth exploring.\n\n**Middle:** one concrete example, then a different perspective.\n\n**Ending:** a useful next action.\n\nChoose a specific audience before polishing the language.',
  Auto: '## A little clarity goes a long way\n\nThis is a **mock response** for the Kalillac shell. No message was sent to an AI provider.\n\nStart with your goal, add the constraints, and decide what a useful answer looks like.\n\n| Mode | Intended role |\n| --- | --- |\n| Fast | Everyday questions |\n| Smart | More involved tasks |\n| Deep | Deliberate reasoning |\n\nYou can stop this stream, edit your prompt, or explicitly save a memory-only snapshot.',
};

export class MockChatService implements ChatTransport {
  private interval: ReturnType<typeof setInterval> | null = null;
  private resolvePending: (() => void) | null = null;

  streamResponse(
    onChunk: (text: string, isDone: boolean) => void,
    task = 'Auto',
  ): Promise<void> {
    this.stop();
    const answer = fixtures[task === 'Search' ? 'Research' : task] ?? fixtures.Auto;
    let length = 0;
    return new Promise(resolve => {
      this.resolvePending = resolve;
      this.interval = setInterval(() => {
        length = Math.min(answer.length, length + 12);
        onChunk(answer.slice(0, length), length === answer.length);
        if (length === answer.length) this.stop();
      }, 30);
    });
  }

  stop(): void {
    if (this.interval !== null) clearInterval(this.interval);
    this.interval = null;
    this.resolvePending?.();
    this.resolvePending = null;
  }
}