export interface StreamTimingSnapshot {
  requestId: string | null;
  parsedDeltaCount: number;
  parsedDeltaElapsedMs: number[];
  screenUpdateCount: number;
  screenUpdateElapsedMs: number[];
  assistantRenderCommitCount: number;
  assistantRenderCommitElapsedMs: number[];
  firstDeltaElapsedMs: number | null;
  completionElapsedMs: number | null;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function isDevelopmentBuild(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

export class StreamTimingSession {
  private requestId: string | null = null;
  private startedAt: number | null = null;
  private parsedDeltaElapsedMs: number[] = [];
  private screenUpdateElapsedMs: number[] = [];
  private assistantRenderCommitElapsedMs: number[] = [];
  private completionElapsedMs: number | null = null;
  private summaryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly enabled = isDevelopmentBuild()) {}

  requestStarted(requestId: string): void {
    if (!this.enabled) return;
    this.requestId = requestId;
    this.startedAt = now();
    this.log('request-started');
  }

  parsedDelta(): void {
    const elapsedMs = this.elapsed();
    if (elapsedMs === null) return;
    this.parsedDeltaElapsedMs.push(elapsedMs);
    this.log('parsed-delta', {
      delta_count: this.parsedDeltaElapsedMs.length,
      elapsed_ms: Math.round(elapsedMs),
    });
  }

  screenStreamingUpdate(): void {
    const elapsedMs = this.elapsed();
    if (elapsedMs === null) return;
    this.screenUpdateElapsedMs.push(elapsedMs);
    this.log('screen-streaming-update', {
      update_count: this.screenUpdateElapsedMs.length,
      elapsed_ms: Math.round(elapsedMs),
    });
  }

  assistantRenderCommitted(): void {
    const elapsedMs = this.elapsed();
    if (elapsedMs === null || this.completionElapsedMs !== null) return;
    this.assistantRenderCommitElapsedMs.push(elapsedMs);
    this.log('assistant-render-commit', {
      render_commit_count: this.assistantRenderCommitElapsedMs.length,
      elapsed_ms: Math.round(elapsedMs),
    });
  }

  completed(): void {
    const elapsedMs = this.elapsed();
    if (elapsedMs === null || this.completionElapsedMs !== null) return;
    this.completionElapsedMs = elapsedMs;
    this.log('completed', {
      elapsed_ms: Math.round(elapsedMs),
    });

    if (this.summaryTimer) clearTimeout(this.summaryTimer);
    this.summaryTimer = setTimeout(() => {
      this.log('summary', this.summaryFields());
      this.summaryTimer = null;
    }, 100);
  }

  snapshot(): StreamTimingSnapshot {
    return {
      requestId: this.requestId,
      parsedDeltaCount: this.parsedDeltaElapsedMs.length,
      parsedDeltaElapsedMs: [...this.parsedDeltaElapsedMs],
      screenUpdateCount: this.screenUpdateElapsedMs.length,
      screenUpdateElapsedMs: [...this.screenUpdateElapsedMs],
      assistantRenderCommitCount: this.assistantRenderCommitElapsedMs.length,
      assistantRenderCommitElapsedMs: [...this.assistantRenderCommitElapsedMs],
      firstDeltaElapsedMs: this.parsedDeltaElapsedMs[0] ?? null,
      completionElapsedMs: this.completionElapsedMs,
    };
  }

  private elapsed(): number | null {
    if (!this.enabled || this.startedAt === null) return null;
    return now() - this.startedAt;
  }

  private summaryFields(): Record<string, number | null> {
    const roundedDeltas = this.parsedDeltaElapsedMs.map(value => Math.round(value));
    const intervals = roundedDeltas.slice(1).map((value, index) => value - roundedDeltas[index]);
    return {
      parsed_delta_count: roundedDeltas.length,
      first_delta_elapsed_ms: roundedDeltas[0] ?? null,
      average_delta_interval_ms: intervals.length
        ? Math.round(intervals.reduce((total, value) => total + value, 0) / intervals.length)
        : null,
      minimum_delta_interval_ms: intervals.length ? Math.min(...intervals) : null,
      maximum_delta_interval_ms: intervals.length ? Math.max(...intervals) : null,
      burst_interval_count: intervals.filter(value => value <= 5).length,
      screen_update_count: this.screenUpdateElapsedMs.length,
      assistant_render_commit_count: this.assistantRenderCommitElapsedMs.length,
      completion_elapsed_ms: this.completionElapsedMs === null
        ? null
        : Math.round(this.completionElapsedMs),
    };
  }

  private log(label: string, fields: Record<string, number | null> = {}): void {
    if (!this.enabled) return;
    console.info('[kalillac-stream-timing]', {
      label,
      request_id: this.requestId,
      ...fields,
    });
  }
}