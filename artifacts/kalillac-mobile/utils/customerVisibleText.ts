/** Backward-compatible presentation for older answers saved before backend
 * normalization. Never rewrites repository text or strips labels from code.
 */
export function customerVisibleAssistantText(content: string): string {
  // The common long-code/prose path makes no extra line arrays or render copy.
  if (!/user safety|response safety/i.test(content)) return content;
  let fence: { marker: string; length: number } | undefined;
  const lines = content.split('\n').map((line, index, all) => line + (index < all.length - 1 ? '\n' : ''));
  return lines.filter(line => {
    const delimiter = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)(?:\r?\n)?$/.exec(line);
    if (delimiter) {
      const [, run, info] = delimiter;
      if (!fence) {
        if (run[0] !== '`' || !info.includes('`')) fence = { marker: run[0], length: run.length };
      } else if (run[0] === fence.marker && run.length >= fence.length && !info.trim()) {
        fence = undefined;
      }
      return true;
    }
    return !!fence || !/^ {0,3}(?:\*\*)?(?:User Safety|Response Safety)(?:\*\*)?\s*:(?:\*\*)?\s*(?:\*\*)?(?:safe|unsafe)(?:\*\*)?\s*$/i.test(line);
  }).join('');
}
