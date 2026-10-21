/**
 * Markdown parsers can treat an unfinished fenced block differently while
 * the response is still arriving. Close only unmatched fences in the render
 * copy so the accumulated code remains a valid, visible code block. The
 * original assistant content is never changed or truncated.
 */
export function markdownForDisplay(content: string): string {
  return markdownForDisplayWithInfo(content).markdown;
}

export function markdownForDisplayWithInfo(content: string): {
  markdown: string;
  fenceCount: number;
  renderCopyFenceBalanced: boolean;
  renderCopyChars: number;
  renderCopyBalancingApplied: boolean;
} {
  const analysis = inspectMarkdownFences(content);
  const markdown = analysis.unmatchedFence
    ? `${content}${content.endsWith('\n') ? '' : '\n'}${analysis.unmatchedFence.marker.repeat(analysis.unmatchedFence.length)}`
    : content;
  return {
    markdown,
    fenceCount: analysis.fenceCount,
    renderCopyFenceBalanced: analysis.renderCopyFenceBalanced,
    renderCopyChars: analysis.renderCopyChars,
    renderCopyBalancingApplied: !!analysis.unmatchedFence,
  };
}

export function inspectMarkdownFences(content: string): {
  fenceCount: number;
  renderCopyFenceBalanced: boolean;
  renderCopyChars: number;
  unmatchedFence?: { marker: '`' | '~'; length: number };
} {
  let openFence: { marker: '`' | '~'; length: number } | undefined;
  let fenceCount = 0;

  for (const match of content.matchAll(/^ {0,3}(`{3,}|~{3,})(.*)$/gm)) {
    fenceCount += 1;

    const markerRun = match[1];
    const marker = markerRun[0] as '`' | '~';
    if (!openFence) {
      // A backtick fence's info string cannot itself contain backticks.
      if (marker === '`' && match[2].includes('`')) continue;
      openFence = { marker, length: markerRun.length };
      continue;
    }

    if (marker !== openFence.marker || markerRun.length < openFence.length) continue;
    if (match[2].trim() !== '') continue;
    openFence = undefined;
  }

  const renderCopyChars = openFence
    ? content.length + (content.endsWith('\n') ? 0 : 1) + openFence.length
    : content.length;
  return {
    fenceCount,
    // Any unmatched fence found here is closed in the render-only copy.
    renderCopyFenceBalanced: true,
    renderCopyChars,
    ...(openFence ? { unmatchedFence: openFence } : {}),
  };
}
