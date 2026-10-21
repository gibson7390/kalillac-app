import {
  inspectMarkdownFences,
  type markdownForDisplayWithInfo,
} from './streamingMarkdown';
import { nativeDiagnostics } from '../dev/nativeDiagnostics';

export type AssistantRenderState = 'streaming' | 'finalized' | 'stopped' | 'failed';

export interface AssistantRenderStats {
  accumulatedChars: number;
  renderCopyChars: number;
  deltaNumber: number;
  state: AssistantRenderState;
  markdownFenceCount: number;
  renderCopyFenceBalanced: boolean;
  renderCopyBalancingApplied: boolean;
  renderedCodeBlockCount: number;
}

export function assistantRenderStats(
  content: string,
  deltaNumber: number,
  state: AssistantRenderState,
  renderedCodeBlockCount = 0,
  displayInfo?: ReturnType<typeof markdownForDisplayWithInfo>,
): AssistantRenderStats {
  const fences = displayInfo ?? inspectMarkdownFences(content);
  return {
    accumulatedChars: content.length,
    renderCopyChars: fences.renderCopyChars,
    deltaNumber,
    state,
    markdownFenceCount: fences.fenceCount,
    renderCopyFenceBalanced: fences.renderCopyFenceBalanced,
    renderCopyBalancingApplied: 'renderCopyBalancingApplied' in fences
      ? fences.renderCopyBalancingApplied : !!fences.unmatchedFence,
    renderedCodeBlockCount,
  };
}

export function logAssistantDiagnostic(
  stage: string,
  fields: Record<string, string | number | boolean | null | undefined>,
): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  console.info('[kalillac-assistant]', { stage, ...fields });
  void nativeDiagnostics.record('assistant', { stage, ...fields });
}
